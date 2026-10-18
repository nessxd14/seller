-- Un único criterio financiero para Seller y comisiones. VOLATILE permite
-- observar las escrituras del comando actual desde sus AFTER triggers.
create function hermes.resumen_cobro_pedidos(p_pedido_ids bigint[])
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,hermes as $$
declare resultado jsonb;
begin
  if p_pedido_ids is null or cardinality(p_pedido_ids) < 1 or cardinality(p_pedido_ids) > 200
    or exists (select 1 from unnest(p_pedido_ids) id where id is null or id <= 0) then
    raise exception 'Pedidos inválidos';
  end if;

  with pedidos as (
    select p.id, p.estado, p.categoria, p.cliente_id, p.total pedido_total from public.pedido p where p.id = any(p_pedido_ids)
  ), resumen as (
    select p.id, p.estado, p.categoria, p.pedido_total,
      count(ve.partida_id) filter (where ve.estado::text <> 'ANULADA') as partidas,
      count(ve.partida_id) filter (where ve.estado::text <> 'ANULADA' and ve.pendiente=0 and ve.en_revision=0) as partidas_saldadas,
      coalesce(sum(ve.total) filter (where ve.estado::text <> 'ANULADA'), 0) as total,
      coalesce(sum(greatest(ve.imputado, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as aplicado,
      coalesce(sum(greatest(ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as en_revision,
      -- Sumar pendientes por partida: el excedente de una no paga automáticamente otra.
      coalesce(sum(greatest(ve.pendiente, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as pendiente,
      coalesce(sum(greatest(ve.pendiente - ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as por_cobrar,
      coalesce(bool_or(ve.pendiente < 0 or ve.en_revision > greatest(ve.pendiente, 0)
        or ve.total is null or ve.pendiente is null or hc.pos_cliente_id is distinct from p.cliente_id)
        filter (where ve.estado::text <> 'ANULADA'), false) as inconsistente
    from pedidos p left join hermes.v_partida_estado ve on ve.pedido_id = p.id
      left join hermes.cliente hc on hc.id = ve.cliente_id
    group by p.id, p.estado, p.categoria, p.pedido_total
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pedido_id', id, 'partidas', partidas, 'partidas_saldadas', partidas_saldadas, 'total', total, 'aplicado', aplicado,
    'en_revision', en_revision, 'pendiente', pendiente, 'por_cobrar', por_cobrar,
    'estado', case
      when categoria::text = 'TIENDA' then 'no_aplica'
      when estado::text = 'CANCELADO' and partidas > 0 then 'revisar'
      when estado::text = 'CANCELADO' then 'cancelado'
      when partidas = 0 then 'sin_partida'
      when pedido_total is null or total <> pedido_total then 'revisar'
      when inconsistente then 'revisar'
      when en_revision > 0 then 'por_verificar'
      when pendiente = 0 and total = 0 then 'sin_pendiente'
      when pendiente = 0 then 'pagado'
      when aplicado > 0 then 'parcial'
      else 'pendiente'
    end
  ) order by id), '[]'::jsonb) into resultado from resumen;
  return resultado;
end $$;
revoke all on function hermes.resumen_cobro_pedidos(bigint[]) from public,anon,authenticated,service_role;

create or replace function public.consultar_cobros_pedidos(p_pedido_ids bigint[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
begin
 if auth.uid() is null or not exists(select 1 from public.perfil where id=auth.uid() and activo and rol::text in ('admin','gerente','cajero','vendedor','vendedor_mayoreo')) then
  raise exception 'No autorizado para consultar cobros' using errcode='42501'; end if;
 return hermes.resumen_cobro_pedidos(p_pedido_ids);
end $$;
revoke all on function public.consultar_cobros_pedidos(bigint[]) from public,anon,service_role;
grant execute on function public.consultar_cobros_pedidos(bigint[]) to authenticated;

alter table public.comision_devengo
 add column cobro_estado text,
 add column partidas_vigentes integer,
 add column partidas_saldadas integer,
 add column revision_motivo text;

create table hermes.comision_evento (
 id bigint generated always as identity primary key,
 devengo_id bigint not null references public.comision_devengo(id),
 actor jsonb not null, antes jsonb, despues jsonb not null,
 creado_en timestamptz not null default clock_timestamp()
);
create index comision_evento_devengo on hermes.comision_evento(devengo_id,id desc);
alter table hermes.comision_evento enable row level security;
create policy comision_evento_solo_rpc on hermes.comision_evento for all to authenticated using(false) with check(false);
revoke all on hermes.comision_evento from public,anon,authenticated,service_role;
revoke all on sequence hermes.comision_evento_id_seq from public,anon,authenticated,service_role;
create trigger comision_evento_inmutable before update or delete on hermes.comision_evento for each row execute function hermes.cobro_evento_inmutable();
create trigger comision_evento_no_truncar before truncate on hermes.comision_evento for each statement execute function hermes.cobro_evento_inmutable();

create function hermes.auditar_comision() returns trigger language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare previo jsonb; siguiente jsonb;
begin
 if tg_op='UPDATE' then previo:=to_jsonb(old); end if;
 if previo is not distinct from to_jsonb(new) then return new; end if;
 siguiente:=to_jsonb(new);
 if tg_op='UPDATE' and old.liquidacion_id is not null and new.liquidacion_id is null then
  siguiente:=siguiente||jsonb_build_object('motivo_anulacion_liquidacion',(select motivo_anulacion from public.comision_liquidacion where id=old.liquidacion_id));
 end if;
 insert into hermes.comision_evento(devengo_id,actor,antes,despues)
 values(new.id,hermes.cobro_actor_sesion(),previo,siguiente);
 return new;
end $$;
revoke all on function hermes.auditar_comision() from public,anon,authenticated,service_role;
create trigger zz_comision_auditoria after insert or update on public.comision_devengo for each row execute function hermes.auditar_comision();

create function hermes.sincronizar_comision_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare d public.comision_devengo%rowtype; r jsonb; objetivo text; motivo text;
begin
 select * into d from public.comision_devengo where pedido_id=p_pedido for update;
 if not found then return; end if;
 r:=hermes.resumen_cobro_pedidos(array[p_pedido])->0;
 if r is null then return; end if;
 objetivo:=d.estado;
 if d.total_documento is distinct from (select total from public.pedido where id=p_pedido) then
  motivo:='El importe del pedido cambió. Revisa la base y el monto de la comisión antes de liquidar.';
 end if;
 if d.estado='LIQUIDADA' then
  if r->>'estado'<>'pagado' then motivo:='Comisión ya liquidada: el pedido dejó de estar saldado. Requiere revisión de gerencia.'; end if;
 elsif r->>'estado'='cancelado' then objetivo:='ANULADA';
 elsif d.estado<>'ANULADA' or d.cobro_estado='cancelado' then
  objetivo:=case when r->>'estado'='pagado' and motivo is null then 'DEVENGADA' else 'POTENCIAL' end;
 end if;
 update public.comision_devengo set estado=objetivo,
  devengado_en=case when objetivo='DEVENGADA' then coalesce(d.devengado_en,clock_timestamp()) when objetivo='LIQUIDADA' then d.devengado_en else null end,
  cobro_estado=r->>'estado',partidas_vigentes=(r->>'partidas')::integer,partidas_saldadas=(r->>'partidas_saldadas')::integer,revision_motivo=motivo
 where id=d.id and (estado,cobro_estado,partidas_vigentes,partidas_saldadas,revision_motivo)
  is distinct from (objetivo,r->>'estado',(r->>'partidas')::integer,(r->>'partidas_saldadas')::integer,motivo);
end $$;
revoke all on function hermes.sincronizar_comision_pedido(bigint) from public,anon,authenticated,service_role;

create or replace function public.comision_sincronizar_partida(p_partida_id bigint) returns void
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin perform hermes.sincronizar_comision_pedido((select pedido_id from hermes.partida_abierta where id=p_partida_id)); end $$;
revoke all on function public.comision_sincronizar_partida(bigint) from public,anon,authenticated,service_role;

-- Los triggers anteriores sólo observaban INSERT/UPDATE del reparto y estado del pago.
-- Se sustituyen para cubrir retirada, origen/destino, saldo y creación de partidas hijas.
drop trigger if exists comision_pago_aplicacion_sync on hermes.pago_aplicacion;
drop trigger if exists comision_pago_estado_sync on hermes.pago;
create function hermes.actualizar_comision_desde_cobro() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare a jsonb; n jsonb; ids bigint[]; i bigint;
begin
 if tg_op<>'INSERT' then a:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then n:=to_jsonb(new); end if;
 if tg_table_name in ('pago_aplicacion','saldo_uso_partida') then
  select array_agg(distinct pedido_id order by pedido_id) into ids from hermes.partida_abierta
   where id in ((a->>'partida_id')::bigint,(n->>'partida_id')::bigint) and pedido_id is not null;
 elsif tg_table_name='pago' then
  select array_agg(distinct pa.pedido_id order by pa.pedido_id) into ids from hermes.pago_aplicacion ap join hermes.partida_abierta pa on pa.id=ap.partida_id
   where ap.pago_id=(n->>'id')::bigint and pa.pedido_id is not null;
 elsif tg_table_name='pedido' then ids:=array[(n->>'id')::bigint];
 elsif tg_table_name='comision_devengo' then ids:=array[(n->>'pedido_id')::bigint];
 else ids:=array[(a->>'pedido_id')::bigint,(n->>'pedido_id')::bigint]; end if;
 for i in select distinct x from unnest(ids) x where x is not null order by x loop
  perform hermes.sincronizar_comision_pedido(i);
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function hermes.actualizar_comision_desde_cobro() from public,anon,authenticated,service_role;
create trigger zzz_comision_aplicacion after insert or update or delete on hermes.pago_aplicacion for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_pago after update of estado,monto on hermes.pago for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_saldo_partida after insert or update or delete on hermes.saldo_uso_partida for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_saldo after insert or update on public.saldo_cliente_uso for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_partida after insert or update or delete on hermes.partida_abierta for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_pedido after insert or update on public.pedido for each row execute function hermes.actualizar_comision_desde_cobro();
create trigger zzz_comision_nueva after insert on public.comision_devengo for each row execute function hermes.actualizar_comision_desde_cobro();

create or replace function public.comision_crear_liquidacion(p_vendedor_email text,p_devengo_ids bigint[],p_medio_pago text default null,p_referencia text default null,p_comprobante_url text default null,p_nota text default null)
returns bigint language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare d public.comision_devengo%rowtype; monto numeric:=0; cantidad integer:=0; lote bigint; r jsonb; actor text;
begin
 if auth.uid() is null or not public.comision_es_gerente() then raise exception 'Solo el gerente puede armar liquidaciones' using errcode='42501'; end if;
 if p_devengo_ids is null or cardinality(p_devengo_ids)<1 or cardinality(p_devengo_ids)>500 or exists(select 1 from unnest(p_devengo_ids) x where x is null or x<=0)
  or (select count(distinct x) from unnest(p_devengo_ids) x)<>cardinality(p_devengo_ids) then raise exception 'Selecciona entre una y 500 comisiones sin repetir'; end if;
 -- Un lote concurrente espera y vuelve a comprobar el estado después del bloqueo.
 for d in select * from public.comision_devengo where id=any(p_devengo_ids) order by id for update loop
  if d.vendedor_email is distinct from p_vendedor_email or d.estado<>'DEVENGADA' or d.liquidacion_id is not null then raise exception 'La comisión cambió o ya fue liquidada. Actualiza la lista'; end if;
  if d.origen='PEDIDO' then
   r:=hermes.resumen_cobro_pedidos(array[d.pedido_id])->0;
   if r is null or r->>'estado'<>'pagado' or d.total_documento is distinct from (select total from public.pedido where id=d.pedido_id) or d.revision_motivo is not null then
    raise exception 'El pedido no cumple las condiciones de cobro. Actualiza y revisa sus partidas'; end if;
  end if;
  cantidad:=cantidad+1; monto:=monto+d.monto;
 end loop;
 if cantidad<>cardinality(p_devengo_ids) then raise exception 'Falta una comisión seleccionada'; end if;
 select coalesce(nullif(nombre,''),email,id::text) into actor from public.perfil where id=auth.uid() and activo;
 insert into public.comision_liquidacion(vendedor_email,monto_total,medio_pago,referencia,comprobante_url,nota,creado_por)
 values(p_vendedor_email,monto,p_medio_pago,p_referencia,p_comprobante_url,p_nota,actor) returning id into lote;
 update public.comision_devengo set estado='LIQUIDADA',liquidacion_id=lote where id=any(p_devengo_ids);
 return lote;
end $$;
revoke all on function public.comision_crear_liquidacion(text,bigint[],text,text,text,text) from public,anon,service_role;
grant execute on function public.comision_crear_liquidacion(text,bigint[],text,text,text,text) to authenticated;

create or replace function public.comision_anular_liquidacion(p_liquidacion_id bigint,p_motivo text)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare l public.comision_liquidacion%rowtype; d public.comision_devengo%rowtype; actor text;
begin
 if auth.uid() is null or not public.comision_es_gerente() then raise exception 'Solo el gerente puede anular liquidaciones' using errcode='42501'; end if;
 if p_motivo is null or btrim(p_motivo)='' or length(p_motivo)>2000 then raise exception 'Indica un motivo de hasta 2000 caracteres'; end if;
 select * into l from public.comision_liquidacion where id=p_liquidacion_id for update;
 if not found or l.anulado_en is not null then raise exception 'La liquidación no existe o ya está anulada'; end if;
 select coalesce(nullif(nombre,''),email,id::text) into actor from public.perfil where id=auth.uid() and activo;
 update public.comision_liquidacion set anulado_en=clock_timestamp(),anulado_por=actor,motivo_anulacion=btrim(p_motivo) where id=l.id;
 for d in select * from public.comision_devengo where liquidacion_id=l.id and estado='LIQUIDADA' order by id for update loop
  update public.comision_devengo set estado=case when d.origen='PEDIDO' then 'POTENCIAL' else 'DEVENGADA' end,liquidacion_id=null,revision_motivo=null where id=d.id;
  if d.origen='PEDIDO' then perform hermes.sincronizar_comision_pedido(d.pedido_id); end if;
 end loop;
end $$;
revoke all on function public.comision_anular_liquidacion(bigint,text) from public,anon,service_role;
grant execute on function public.comision_anular_liquidacion(bigint,text) to authenticated;

create function public.comision_historial(p_devengo_id bigint,p_antes_id bigint default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
declare d public.comision_devengo%rowtype; salida jsonb;
begin
 select * into d from public.comision_devengo where id=p_devengo_id;
 if not found or auth.uid() is null or not exists(select 1 from public.perfil where id=auth.uid() and activo) or not coalesce(public.comision_puede_ver(d.vendedor_email),false) then raise exception 'No autorizado para consultar esta comisión' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by id desc),'[]') into salida from (
  select id,actor,antes,despues,creado_en from hermes.comision_evento where devengo_id=d.id and (p_antes_id is null or id<p_antes_id) order by id desc limit 50
 ) e;
 return salida;
end $$;
revoke all on function public.comision_historial(bigint,bigint) from public,anon,service_role;
grant execute on function public.comision_historial(bigint,bigint) to authenticated;

create function public.comision_revisar_base(p_devengo_id bigint,p_total_revisado numeric,p_base numeric,p_monto numeric,p_motivo text)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare d public.comision_devengo%rowtype; total_actual numeric; subtotal_actual numeric; actualizado jsonb;
begin
 if auth.uid() is null or not public.comision_es_gerente() then raise exception 'Solo gerencia puede revisar la base de una comisión' using errcode='42501'; end if;
 if p_motivo is null or btrim(p_motivo)='' or length(p_motivo)>2000 then raise exception 'Indica el motivo de la revisión'; end if;
 select * into d from public.comision_devengo where id=p_devengo_id for update;
 if not found or d.origen<>'PEDIDO' or d.estado not in ('POTENCIAL','DEVENGADA') or d.liquidacion_id is not null then raise exception 'La comisión no admite revisión de base'; end if;
 select total,subtotal into total_actual,subtotal_actual from public.pedido where id=d.pedido_id and estado<>'CANCELADO';
 if total_actual is null or p_total_revisado is distinct from total_actual then raise exception 'El pedido cambió. Actualiza antes de revisar la comisión'; end if;
 if p_base is null or p_monto is null or p_base::text in ('NaN','Infinity','-Infinity') or p_monto::text in ('NaN','Infinity','-Infinity')
  or p_base<=0 or p_base>greatest(total_actual,subtotal_actual) or p_monto<0 or p_monto>p_base or round(p_base,2)<>p_base or round(p_monto,2)<>p_monto then raise exception 'Revisa la base y el monto de la comisión'; end if;
 update public.comision_devengo set total_documento=total_actual,base_comisionable=p_base,monto=p_monto,porcentaje=round(p_monto/p_base,4) where id=d.id;
 perform hermes.sincronizar_comision_pedido(d.pedido_id);
 select to_jsonb(c) into actualizado from public.comision_devengo c where id=d.id;
 insert into hermes.comision_evento(devengo_id,actor,antes,despues) values(d.id,hermes.cobro_actor_sesion(),to_jsonb(d),actualizado||jsonb_build_object('motivo_revision_base',btrim(p_motivo)));
end $$;
revoke all on function public.comision_revisar_base(bigint,numeric,numeric,numeric,text) from public,anon,service_role;
grant execute on function public.comision_revisar_base(bigint,numeric,numeric,numeric,text) to authenticated;

-- Actualización de elegibilidad, sin cambiar vendedor, base, tasa, monto ni liquidaciones.
-- El primer evento es una evaluación actual, no una fecha histórica de cobro.
do $$ declare p bigint; begin
 for p in select pedido_id from public.comision_devengo where origen='PEDIDO' and pedido_id is not null order by pedido_id loop
  perform hermes.sincronizar_comision_pedido(p);
 end loop;
end $$;
notify pgrst,'reload schema';
