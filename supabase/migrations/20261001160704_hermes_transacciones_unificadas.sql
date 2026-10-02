-- Caja y cartera comparten una transacción. No confirma pagos automáticamente.
CREATE OR REPLACE FUNCTION hermes.imputar_pago_pos_interno(p_pago_id bigint, p_aplicaciones jsonb, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pago      record;
  v_a         record;
  v_suma      numeric := 0;
  v_pendiente numeric;
  v_n         int := 0;
begin
  select * into v_pago from pago where id = p_pago_id for update;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;
  if v_pago.estado <> 'PROPUESTO' then
    raise exception 'El pago % está en estado % — solo se puede imputar un PROPUESTO',
      p_pago_id, v_pago.estado;
  end if;
  if v_pago.no_imputar and jsonb_array_length(coalesce(p_aplicaciones,'[]'::jsonb)) > 0 then
    raise exception 'El pago % está marcado como anticipo (no imputar). '
                    'Quitá esa marca antes de repartirlo entre partidas.', p_pago_id;
  end if;

  delete from pago_aplicacion where pago_id = p_pago_id;

  for v_a in
    select (x->>'partida_id')::bigint as partida_id,
           (x->>'monto')::numeric     as monto
      from jsonb_array_elements(coalesce(p_aplicaciones,'[]'::jsonb)) x
  loop
    if v_a.monto is null or v_a.monto <= 0 then
      raise exception 'Monto inválido (%) para la partida %', v_a.monto, v_a.partida_id;
    end if;

    select ve.pendiente into v_pendiente
      from v_partida_estado ve
     where ve.partida_id = v_a.partida_id and ve.cliente_id = v_pago.cliente_id;

    if v_pendiente is null then
      raise exception 'La partida % no existe o no pertenece al cliente del pago', v_a.partida_id;
    end if;
    if v_a.monto > v_pendiente then
      raise exception 'No se puede imputar % a la partida %: solo quedan pendientes %',
        v_a.monto, v_a.partida_id, v_pendiente;
    end if;

    insert into pago_aplicacion (pago_id, partida_id, monto)
    values (p_pago_id, v_a.partida_id, v_a.monto);

    v_suma := v_suma + v_a.monto;
    v_n := v_n + 1;
  end loop;

  if v_suma > v_pago.monto then
    raise exception 'La suma imputada (%) supera el monto del pago (%)', v_suma, v_pago.monto;
  end if;

  return jsonb_build_object(
    'pago_id', p_pago_id, 'aplicaciones', v_n,
    'imputado', v_suma, 'excedente', v_pago.monto - v_suma);
end;
$function$

;
alter table public.movimiento_caja add column if not exists hermes_intencion jsonb;

create or replace function hermes.exigir_operador_pos() returns void
language plpgsql stable security definer set search_path = pg_catalog, public, hermes as $$
begin
 if hermes.contexto_confiable() then return; end if;
 if auth.uid() is null or not exists(select 1 from public.perfil
   where id=auth.uid() and activo and rol in ('admin','gerente','cajero')) then
   raise exception 'No autorizado para operar caja' using errcode='42501';
 end if;
end $$;

create or replace function hermes.asegurar_cliente_pos(p_pos_id bigint) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
declare v public.cliente%rowtype; h_id bigint; cat hermes.categoria_cliente;
begin
 select * into v from public.cliente where id=p_pos_id;
 if not found then raise exception 'Cliente POS inexistente'; end if;
 cat := hermes.categoria_desde_tipo_precio(v.tipo_precio::text);
 if cat is null then raise exception 'Categoría del cliente sin equivalencia en Hermes'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hermes-clientes',0));
 select id into h_id from hermes.cliente where pos_cliente_id=p_pos_id;
 if h_id is null then
   h_id:=p_pos_id;
   if exists(select 1 from hermes.cliente where id=h_id) then
     select coalesce(max(id),0)+1 into h_id from hermes.cliente;
   end if;
   insert into hermes.cliente(id,pos_cliente_id,nombre,nit,categoria,activo,importado_en)
   values(h_id,p_pos_id,v.nombre,nullif(btrim(v.documento),''),cat,v.activo,now());
 else
   update hermes.cliente set nombre=v.nombre,nit=nullif(btrim(v.documento),''),
     categoria=cat,activo=v.activo,sincronizado_en=now() where id=h_id;
 end if;
 insert into hermes.cliente_credito(cliente_id,sector,plazo_dias,inicio_computo,actualizado_por)
 values(h_id,case when cat='INSTITUCIONAL' then 'PUBLICO'::hermes.sector_cliente else 'PRIVADO'::hermes.sector_cliente end,
   case when cat='RETAIL' then 0 else 30 end,
   case when cat='RETAIL' then 'CONTADO'::hermes.inicio_computo when cat='MAYORISTA' then 'ENTREGA'::hermes.inicio_computo else 'FACTURA'::hermes.inicio_computo end,'pos:automatico')
 on conflict(cliente_id) do nothing;
 return h_id;
end $$;

create or replace function hermes.registrar_movimiento_pos(p_mov_id bigint) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
declare m public.movimiento_caja%rowtype; p_id bigint; c_id bigint; pos_id bigint; a record;
 rest numeric; intent jsonb; apps jsonb; pedido_cliente bigint;
begin
 select * into m from public.movimiento_caja where id=p_mov_id;
 if not found or m.tipo::text<>'ANTICIPO' then raise exception 'Movimiento no es un cobro de cliente'; end if;
 pos_id:=m.cliente_id;
 if m.pedido_id is not null then
   select cliente_id into pedido_cliente from public.pedido where id=m.pedido_id;
   if pos_id is not null and pos_id is distinct from pedido_cliente then raise exception 'Pedido y cliente no coinciden'; end if;
   pos_id:=pedido_cliente;
 end if;
 if pos_id is null then raise exception 'Cobro sin cliente'; end if;
 c_id:=hermes.asegurar_cliente_pos(pos_id);
 perform 1 from hermes.cliente where id=c_id for update;
 select id into p_id from hermes.pago where idempotencia_clave='pos-pago-mov-'||m.id;
 if p_id is not null then
   if not exists(select 1 from hermes.pago where id=p_id and cliente_id=c_id and monto=m.monto and medio::text=m.metodo::text) then
     raise exception 'El movimiento ya tiene un pago con datos diferentes';
   end if;
   return p_id;
 end if;
 intent:=coalesce(m.hermes_intencion,'{}'::jsonb);
 insert into hermes.pago(cliente_id,medio,monto,estado,fecha_recepcion,referencia,idempotencia_clave,creado_por,no_imputar)
 values(c_id,m.metodo::text::hermes.medio_pago,m.monto,'PROPUESTO',
   (m.creado_en at time zone 'America/La_Paz')::date,
   coalesce(nullif(intent->>'referencia',''),m.nota,'Cobro POS'),
   'pos-pago-mov-'||m.id,coalesce(m.creado_por,'pos'),coalesce((intent->>'no_imputar')::boolean,false))
 returning id into p_id;
 apps:=nullif(intent->'aplicaciones','null'::jsonb);
 if coalesce((intent->>'no_imputar')::boolean,false) then
   if apps is not null and jsonb_array_length(apps)>0 then raise exception 'Un anticipo sin imputación no admite reparto'; end if;
 elsif apps is not null then
   perform hermes.imputar_pago_pos_interno(p_id,apps,m.creado_por);
 elsif m.pedido_id is not null then
   rest:=m.monto;
   for a in select ve.partida_id,ve.pendiente from hermes.v_partida_estado ve
      where ve.cliente_id=c_id and ve.pedido_id=m.pedido_id and ve.estado='ABIERTA' and ve.pendiente>0
      order by ve.creado_en,ve.partida_id loop
     exit when rest<=0;
     insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values(p_id,a.partida_id,least(rest,a.pendiente));
     rest:=rest-least(rest,a.pendiente);
   end loop;
 end if;
 return p_id;
end $$;

create or replace function hermes.al_cobrar_pos() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
begin
 if new.tipo::text='ANTICIPO' then
   perform hermes.exigir_operador_pos();
   perform 1 from public.sesion_caja where id=new.sesion_caja_id and estado::text='ABIERTA' for update;
   if not found then raise exception 'La caja está cerrada'; end if;
   perform hermes.registrar_movimiento_pos(new.id);
 end if;
 return new;
end $$;
create trigger hermes_cobro_atomico after insert on public.movimiento_caja
for each row execute function hermes.al_cobrar_pos();

create or replace function public.registrar_cobro_hermes(
 p_pedido_id bigint default null,p_cliente_id bigint default null,p_monto numeric default null,
 p_metodo public.metodo_pago default null,p_sesion_id bigint default null,
 p_idempotencia text default null,p_no_imputar boolean default false,
 p_aplicaciones jsonb default null,p_referencia text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
declare m public.movimiento_caja%rowtype; c_id bigint; p_id bigint; pos_id bigint; intent jsonb; actor text;
begin
 perform hermes.exigir_operador_pos();
 if p_idempotencia is null or length(btrim(p_idempotencia))<8 then raise exception 'Falta clave estable del cobro'; end if;
 if p_monto is null or p_monto<=0 or p_monto<>round(p_monto,2) or p_metodo is null then raise exception 'Monto o método inválido'; end if;
 if p_no_imputar is null or (p_aplicaciones is not null and jsonb_typeof(p_aplicaciones)<>'array') then raise exception 'Intención del cobro inválida'; end if;
 if p_pedido_id is null and p_cliente_id is null then raise exception 'Falta cliente o pedido'; end if;
 pos_id:=p_cliente_id;
 if p_pedido_id is not null then
   select cliente_id into pos_id from public.pedido where id=p_pedido_id;
   if not found or pos_id is null then raise exception 'Pedido inexistente o sin cliente'; end if;
   if p_cliente_id is not null and p_cliente_id is distinct from pos_id then raise exception 'Pedido pertenece a otro cliente'; end if;
 end if;
 actor:=coalesce(auth.uid()::text,'sistema');
 intent:=jsonb_build_object('no_imputar',p_no_imputar,'aplicaciones',p_aplicaciones,'referencia',p_referencia,'cliente_pos',pos_id,'actor',actor);
 -- Serializa reintentos, incluyendo dos llamadas simultáneas con la misma clave.
 perform pg_advisory_xact_lock(hashtextextended('hermes-cobro:'||p_idempotencia,0));
 select * into m from public.movimiento_caja where idempotencia_clave=p_idempotencia;
 if found then
   if m.tipo::text<>'ANTICIPO' or m.monto<>p_monto or m.metodo<>p_metodo
      or m.pedido_id is distinct from p_pedido_id or m.sesion_caja_id is distinct from p_sesion_id
      or m.hermes_intencion is distinct from intent then
     raise exception 'Clave de reintento usada con datos diferentes';
   end if;
 else
   perform 1 from public.sesion_caja where id=p_sesion_id and estado::text='ABIERTA' for update;
   if not found then raise exception 'La caja está cerrada'; end if;
   if not exists(select 1 from public.cliente where id=pos_id and activo) then raise exception 'Cliente inactivo o inexistente'; end if;
   insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,pedido_id,cliente_id,creado_por,nota,idempotencia_clave,hermes_intencion)
   values(p_sesion_id,'ANTICIPO',p_metodo,p_monto,p_pedido_id,case when p_pedido_id is null then pos_id else null end,
     actor,coalesce(p_referencia,case when p_pedido_id is null then 'Pago sobre saldo total' else 'Anticipo pedido #'||p_pedido_id end),
     p_idempotencia,intent) returning * into m;
 end if;
 p_id:=hermes.registrar_movimiento_pos(m.id);
 select id into c_id from hermes.cliente where pos_cliente_id=pos_id;
 return jsonb_build_object('movementId',m.id,'pagoId',p_id,'saldoProvisional',
   (select saldo_provisional from hermes.v_saldo_cliente where cliente_id=c_id));
end $$;

-- Mantiene el contrato del POS existente; ambos registros ya se hacen juntos.
create or replace function public.registrar_anticipo(
 p_pedido_id bigint default null,p_cliente_id bigint default null,p_monto numeric default null,
 p_metodo public.metodo_pago default null,p_sesion_id bigint default null,p_usuario text default null,
 p_idempotencia text default null)
returns bigint language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
begin
 return (public.registrar_cobro_hermes(p_pedido_id,p_cliente_id,p_monto,p_metodo,p_sesion_id,
   coalesce(p_idempotencia,'legacy-'||gen_random_uuid()::text))->>'movementId')::bigint;
end $$;

create or replace function hermes.sincronizar_entrega_pedido(p_pedido_id bigint,p_fecha date,p_usuario text default 'pos:entrega')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
declare n integer;
begin
 if p_fecha is null or p_fecha>(now() at time zone 'America/La_Paz')::date then raise exception 'Fecha de entrega inválida'; end if;
 update hermes.partida_abierta pa set fecha_entrega=p_fecha,
   documentado=not exists(select 1 from hermes.documento d join hermes.hito h on h.id=d.hito_id
      where h.partida_abierta_id=pa.id and d.tipo='HABILITANTE' and d.estado<>'APROBADO')
 where pa.pedido_id=p_pedido_id and pa.estado='ABIERTA' and pa.fecha_entrega is null;
 get diagnostics n=row_count;
 return jsonb_build_object('aplicado',n>0 or exists(select 1 from hermes.partida_abierta where pedido_id=p_pedido_id and fecha_entrega is not null),
   'actualizadas',n,'motivo',case when exists(select 1 from hermes.partida_abierta where pedido_id=p_pedido_id) then 'ya_registrada' else 'sin_partida_abierta' end);
end $$;

create or replace function hermes.sincronizar_pedido_pos(p_id bigint,p_fecha date default null) returns void
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
declare p public.pedido%rowtype; c_id bigint; f date;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes-pedido:'||p_id,0));
 select * into p from public.pedido where id=p_id;
 if not found or p.cliente_id is null or p.total is null or p.total<=0 or p.estado::text not in ('ABIERTO','COMPLETADO') then return; end if;
 c_id:=hermes.asegurar_cliente_pos(p.cliente_id);
 if not exists(select 1 from hermes.cliente where id=c_id and categoria<>'RETAIL') then return; end if;
 if not exists(select 1 from hermes.partida_abierta where pedido_id=p_id) then perform hermes.abrir_partida(p_id,'pos:automatico'); end if;
 if p.estado::text='COMPLETADO' then
   select coalesce(p_fecha,q.fecha_completado,(p.recibido_en at time zone 'America/La_Paz')::date) into f
     from (select 1) x left join public.pendiente_sync_hermes_despacho q on q.pedido_id=p_id;
   if f is not null then
     perform hermes.sincronizar_entrega_pedido(p_id,f,'pos:automatico');
     update public.pendiente_sync_hermes_despacho set sincronizado_en=now(),ultimo_error=null
       where pedido_id=p_id and sincronizado_en is null;
   end if;
 end if;
end $$;
create or replace function public.comision_trigger_sync_partida_pedido() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
begin
 if new.estado::text='COMPLETADO' and old.estado is distinct from new.estado then
   perform hermes.sincronizar_pedido_pos(new.id,coalesce((new.recibido_en at time zone 'America/La_Paz')::date,(now() at time zone 'America/La_Paz')::date));
 end if;
 return new;
end $$;
create or replace function hermes.al_registrar_despacho_pos() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
begin
 perform hermes.sincronizar_pedido_pos(new.pedido_id,new.fecha_completado);
 return new;
end $$;
create trigger hermes_entrega_atomica after insert or update of fecha_completado on public.pendiente_sync_hermes_despacho
 for each row execute function hermes.al_registrar_despacho_pos();
create or replace function hermes.al_actualizar_cliente_pos() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, hermes as $$
begin
 if new.activo and hermes.categoria_desde_tipo_precio(new.tipo_precio::text) is not null
   or exists(select 1 from hermes.cliente where pos_cliente_id=new.id) then
   perform hermes.asegurar_cliente_pos(new.id);
 end if;
 return new;
end $$;
create trigger hermes_cliente_automatico after insert or update of nombre,documento,tipo_precio,activo on public.cliente
 for each row execute function hermes.al_actualizar_cliente_pos();

-- Lecturas del POS con sesión propia: elimina la dependencia de otra URL y de secretos en Vercel.
create or replace function public.consultar_hermes_pos(p_operacion text,p_cliente_ids bigint[],p_monto numeric default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, hermes as $$
declare cid bigint; r jsonb;
begin
 perform hermes.exigir_operador_pos();
 if p_cliente_ids is null or cardinality(p_cliente_ids)>200 or cardinality(p_cliente_ids)<1 then raise exception 'Clientes inválidos'; end if;
 if p_operacion='saldos' then
   select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into r from hermes.consultar_saldos(p_cliente_ids) s;
 elsif p_operacion='similares' then
   select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into r from hermes.consultar_saldos_por_pos_ids(p_cliente_ids) s;
 elsif p_operacion='existe' then
   select jsonb_build_object('existe',exists(select 1 from hermes.cliente where pos_cliente_id=p_cliente_ids[1])) into r;
 elsif p_operacion='saldo' then
   select to_jsonb(s) into r from hermes.consultar_saldo(p_cliente_ids[1]) s;
 elsif p_operacion='credito' then
   select to_jsonb(s) into r from hermes.evaluar_credito_pos(p_cliente_ids[1],p_monto) s;
 elsif p_operacion='reparto' then
   select coalesce(jsonb_agg(jsonb_build_object('partidaId',o_partida_id,'referencia',o_referencia,'total',o_total,
     'pendiente',o_pendiente,'aplica',o_aplica,'restante',o_restante)),'[]'::jsonb) into r
     from hermes.calcular_imputacion_fifo_pos(p_cliente_ids[1],p_monto);
 else raise exception 'Operación desconocida'; end if;
 return r;
end $$;

revoke all on function public.registrar_cobro_hermes(bigint,bigint,numeric,public.metodo_pago,bigint,text,boolean,jsonb,text) from public,anon;
revoke all on function public.consultar_hermes_pos(text,bigint[],numeric) from public,anon;
revoke all on function public.registrar_anticipo(bigint,bigint,numeric,public.metodo_pago,bigint,text,text) from public,anon;
grant execute on function public.registrar_cobro_hermes(bigint,bigint,numeric,public.metodo_pago,bigint,text,boolean,jsonb,text),
 public.consultar_hermes_pos(text,bigint[],numeric),
 public.registrar_anticipo(bigint,bigint,numeric,public.metodo_pago,bigint,text,text) to authenticated,service_role;

CREATE OR REPLACE FUNCTION hermes.confirmar_pago(p_pago_id bigint, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pago      record;
  v_rol       text;
  v_actor     text;
  v_n         int;
  v_a         record;
  v_imputado  numeric := 0;
  v_excedente numeric;
  v_fecha     date;
begin
  v_rol := hermes.rol_actual();
  if v_rol not in ('gerente','admin') then
    raise exception 'Solo el rol gerente puede confirmar pagos (rol actual: %)',
                    coalesce(nullif(v_rol,''), 'sin rol');
  end if;
  v_actor := coalesce(auth.jwt() ->> 'email', current_user);
  v_fecha := (now() at time zone 'America/La_Paz')::date;

  select * into v_pago from pago where id = p_pago_id;
  if not found then raise exception 'Pago % no existe', p_pago_id; end if;
  perform 1 from cliente where id=v_pago.cliente_id for update;
  perform 1 from partida_abierta where cliente_id=v_pago.cliente_id order by id for update;
  select * into v_pago from pago where id=p_pago_id for update;
  if not found then raise exception 'Pago % no existe', p_pago_id; end if;
  if v_pago.estado <> 'PROPUESTO' then
    raise exception 'El pago % está en estado % y no se puede confirmar', p_pago_id, v_pago.estado;
  end if;

  -- FIFO automático SOLO si el vendedor no lo marcó como anticipo.
  select count(*) into v_n from pago_aplicacion where pago_id = p_pago_id;
  if v_n = 0 and not v_pago.no_imputar then
    insert into pago_aplicacion (pago_id, partida_id, monto)
    select p_pago_id, f.o_partida_id, f.o_aplica
      from calcular_imputacion_fifo(v_pago.cliente_id, v_pago.monto) f;
  end if;

  -- Valida el saldo vigente después de adquirir los bloqueos: dos propuestas no pueden cancelar la misma deuda.
  if exists(select 1 from pago_aplicacion ap join v_partida_estado ve on ve.partida_id=ap.partida_id
     where ap.pago_id=p_pago_id and (ve.cliente_id<>v_pago.cliente_id or ve.estado<>'ABIERTA' or ap.monto>ve.pendiente))
     or (select coalesce(sum(monto),0) from pago_aplicacion where pago_id=p_pago_id)>v_pago.monto
     or (v_pago.no_imputar and exists(select 1 from pago_aplicacion where pago_id=p_pago_id)) then
    raise exception 'El reparto ya no coincide con la deuda vigente. Revisar antes de confirmar.';
  end if;
  update pago set estado = 'CONFIRMADO', confirmado_por = v_actor, confirmado_en = now()
   where id = p_pago_id;

  for v_a in
    select ap.partida_id, ap.monto, pa.documento_interno
      from pago_aplicacion ap
      join partida_abierta pa on pa.id = ap.partida_id
     where ap.pago_id = p_pago_id
     order by ap.partida_id
  loop
    insert into movimiento_cuenta (cliente_id, partida_id, pago_id, tipo, monto,
                                   idempotencia_clave, fecha_efectiva, referencia,
                                   motivo, creado_por)
    values (v_pago.cliente_id, v_a.partida_id, p_pago_id, 'PAGO', -v_a.monto,
            'pago-confirmado-' || p_pago_id || '-' || v_a.partida_id,
            v_fecha, coalesce(v_pago.referencia, v_a.documento_interno),
            'Pago confirmado', v_actor);
    v_imputado := v_imputado + v_a.monto;
  end loop;

  v_excedente := v_pago.monto - v_imputado;
  if v_excedente > 0 then
    insert into movimiento_cuenta (cliente_id, partida_id, pago_id, tipo, monto,
                                   idempotencia_clave, fecha_efectiva, referencia,
                                   motivo, creado_por)
    values (v_pago.cliente_id, null, p_pago_id, 'ANTICIPO', -v_excedente,
            'pago-anticipo-' || p_pago_id, v_fecha, v_pago.referencia,
            case when v_pago.no_imputar then 'Anticipo a favor del cliente'
                 else 'Excedente sin imputar' end,
            v_actor);
  end if;

  update partida_abierta pa
     set estado = 'PAGADA'
    from v_partida_estado ve
   where ve.partida_id = pa.id
     and pa.id in (select ap.partida_id from pago_aplicacion ap where ap.pago_id = p_pago_id)
     and pa.estado = 'ABIERTA'
     and ve.pendiente <= 0;
end;
$function$
;

-- Ninguna RPC de Hermes hereda ejecución pública. Las funciones internas quedan para el servidor.
revoke execute on all functions in schema hermes from public,anon,authenticated;
grant execute on all functions in schema hermes to service_role;
grant usage on schema hermes to authenticated,service_role;
revoke usage on schema hermes from anon;
CREATE OR REPLACE FUNCTION hermes.subir_documento(p_documento_id bigint, p_storage_path text, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  if rol_actual() = '' and not contexto_confiable() then
    raise exception 'Requiere sesión autenticada';
  end if;

  update documento
     set estado = 'SUBIDO', storage_path = p_storage_path,
         subido_por = p_usuario, subido_en = now(),
         revisado_por = null, revisado_en = null, notas = null
   where id = p_documento_id
     and estado in ('PENDIENTE', 'RECHAZADO');

  if not found then
    raise exception 'Documento % no existe o no admite subida en su estado actual', p_documento_id;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.cargar_saldo_apertura(p_cliente_id bigint, p_saldo numeric, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_corte date; v_actor text; v_rol text; v_id bigint;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  v_actor := coalesce(auth.jwt() ->> 'email', current_user);
  v_rol   := hermes.rol_actual();

  if v_rol <> 'admin' then
    raise exception 'Solo el rol admin puede cargar saldos de apertura (rol actual: %)',
                    coalesce(nullif(v_rol,''), 'sin rol');
  end if;

  select valor::date into v_corte from parametro where clave = 'fecha_corte_apertura';

  insert into movimiento_cuenta
    (cliente_id, tipo, monto, idempotencia_clave, fecha_efectiva, motivo, creado_por)
  values
    (p_cliente_id, 'SALDO_APERTURA', p_saldo, 'apertura-' || p_cliente_id, v_corte, p_motivo, v_actor)
  returning id into v_id;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.registrar_nota_credito(p_cliente_id bigint, p_monto numeric, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_actor text; v_rol text; v_id bigint;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  v_actor := coalesce(auth.jwt() ->> 'email', current_user);
  v_rol   := hermes.rol_actual();

  if v_rol <> 'admin' then
    raise exception 'Solo el rol admin puede registrar notas de crédito (rol actual: %)',
                    coalesce(nullif(v_rol,''), 'sin rol');
  end if;

  if p_monto <= 0 then
    raise exception 'El monto debe ser positivo (%) -- se registra en contra del cliente automáticamente', p_monto;
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'La nota de crédito requiere un motivo';
  end if;

  insert into movimiento_cuenta (cliente_id, tipo, monto, idempotencia_clave, fecha_efectiva, motivo, creado_por)
  values (p_cliente_id, 'NOTA_CREDITO', -p_monto, 'nota-credito-' || gen_random_uuid(),
          (now() at time zone 'America/La_Paz')::date, p_motivo, v_actor)
  returning id into v_id;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.sincronizar_clientes_cation()
 RETURNS TABLE(actualizados integer, sin_mapeo integer, no_importados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  return query
  with mapa as (
    select c.id,
           c.nombre,
           nullif(btrim(coalesce(c.documento, '')), '') as nit,
           c.activo,
           hermes.categoria_desde_tipo_precio(c.tipo_precio) as categoria
      from hermes.cation_cliente c
  ), upd as (
    update cliente h
       set nombre          = m.nombre,
           nit             = m.nit,
           categoria       = coalesce(m.categoria, h.categoria),
           activo          = m.activo,
           sincronizado_en = now()
      from mapa m
     where h.pos_cliente_id = m.id
       and (h.nombre IS DISTINCT FROM m.nombre
         or h.nit    IS DISTINCT FROM m.nit
         or h.activo IS DISTINCT FROM m.activo
         or (m.categoria is not null and h.categoria IS DISTINCT FROM m.categoria))
    returning h.id
  )
  select (select count(*)::int from upd),
         (select count(*)::int from mapa m
            join cliente h on h.pos_cliente_id = m.id
           where m.categoria is null),
         (select count(*)::int from mapa m
           where m.activo
             and not exists (select 1 from cliente h where h.pos_cliente_id = m.id));
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.sincronizar_pedidos_cation()
 RETURNS TABLE(abiertas integer, omitidas integer, con_error integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  r          record;
  v_abiertas int := 0;
  v_error    int := 0;
  v_omitidas int;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  -- Se toma ANTES del loop a propósito: después, los pedidos recién abiertos
  -- ya figuran como YA_TIENE_PARTIDA y se contarían dos veces.
  select count(*)::int into v_omitidas from v_pedidos_cation_pendientes where motivo <> 'ABRE';

  for r in select pedido_id from v_pedidos_cation_pendientes where motivo = 'ABRE' order by pedido_id
  loop
    begin
      perform abrir_partida(r.pedido_id, 'sync-cation');
      v_abiertas := v_abiertas + 1;
    exception when others then
      v_error := v_error + 1;
      raise warning 'Pedido %: %', r.pedido_id, sqlerrm;
    end;
  end loop;

  return query select v_abiertas, v_omitidas, v_error;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.actualizar_credito_cliente(p_cliente_id bigint, p_sector hermes.sector_cliente, p_limite_credito numeric, p_plazo_dias integer, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_actor          text;
  v_rol            text;
  v_limite_previo  numeric;
  v_plazo_previo   integer;
  v_limite_cambio  boolean;
  v_plazo_cambio   boolean;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  v_actor := coalesce(auth.jwt() ->> 'email', current_user);
  v_rol   := rol_actual();   -- FIX: antes leía user_metadata directo

  select limite_credito, plazo_dias into v_limite_previo, v_plazo_previo
  from cliente_credito where cliente_id = p_cliente_id
  for update;

  if not found then
    raise exception 'Cliente % no tiene registro de crédito', p_cliente_id;
  end if;

  v_limite_cambio := v_limite_previo is distinct from p_limite_credito;
  v_plazo_cambio  := v_plazo_previo is distinct from p_plazo_dias;

  if v_limite_cambio or v_plazo_cambio then
    if v_rol <> 'gerente' then
      raise exception 'Solo el rol gerente puede modificar límite de crédito o plazo '
                      '(rol actual: %)', coalesce(nullif(v_rol,''), 'sin rol');
    end if;
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'El cambio de límite de crédito o plazo requiere un motivo';
    end if;
  end if;

  update cliente_credito
  set sector          = p_sector,
      limite_credito  = p_limite_credito,
      plazo_dias      = p_plazo_dias,
      actualizado_en  = now(),
      actualizado_por = v_actor
  where cliente_id = p_cliente_id;

  if v_limite_cambio then
    insert into cliente_credito_evento
      (cliente_id, campo, valor_previo, valor_nuevo, motivo, creado_por)
    values
      (p_cliente_id, 'limite_credito', v_limite_previo::text, p_limite_credito::text, p_motivo, v_actor);
  end if;

  if v_plazo_cambio then
    insert into cliente_credito_evento
      (cliente_id, campo, valor_previo, valor_nuevo, motivo, creado_por)
    values
      (p_cliente_id, 'plazo_dias', v_plazo_previo::text, p_plazo_dias::text, p_motivo, v_actor);
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.obtener_detalle_pedido_cation(p_pedido_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_cotizacion_id bigint;
  v_lineas jsonb;
  v_cotizacion jsonb;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  if rol_actual() = '' then
    raise exception 'No autenticado';
  end if;

  select cotizacion_origen_id into v_cotizacion_id
    from hermes.cation_pedido where id = p_pedido_id;

  select coalesce(jsonb_agg(l order by l.id), '[]'::jsonb) into v_lineas
    from public.v_pedido_linea_hermes l where l.pedido_id = p_pedido_id;

  if v_cotizacion_id is not null then
    select to_jsonb(c) into v_cotizacion
      from public.v_cotizacion_hermes c where c.id = v_cotizacion_id;
  end if;

  return jsonb_build_object(
    'cotizacion_origen_id', v_cotizacion_id,
    'lineas', v_lineas,
    'cotizacion', v_cotizacion
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.revisar_documento(p_documento_id bigint, p_aprobado boolean, p_usuario text, p_notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  -- T0-4: antes exigía 'gerente' estricto. Ahora admin también, y
  -- contexto_confiable() para el editor SQL / service_role, igual que
  -- anular_partida y partir_partida.
  if not contexto_confiable() and rol_actual() not in ('gerente', 'admin') then
    raise exception 'Tu rol (%) no puede revisar documentos: hace falta gerente o admin',
                    coalesce(nullif(rol_actual(), ''), 'sin rol');
  end if;

  update documento
     set estado       = case when p_aprobado then 'APROBADO' else 'RECHAZADO' end::estado_documento,
         revisado_por = p_usuario,
         revisado_en  = now(),
         notas        = p_notas
   where id = p_documento_id
     and estado = 'SUBIDO';

  if not found then
    raise exception 'Documento % no existe o no está en estado SUBIDO', p_documento_id;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.completar_hito(p_hito_id bigint, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pendientes int;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  -- T0-4: mismo criterio que revisar_documento.
  if not contexto_confiable() and rol_actual() not in ('gerente', 'admin') then
    raise exception 'Tu rol (%) no puede completar hitos: hace falta gerente o admin',
                    coalesce(nullif(rol_actual(), ''), 'sin rol');
  end if;

  select count(*) into v_pendientes
    from documento
   where hito_id = p_hito_id
     and tipo = 'HABILITANTE'
     and estado <> 'APROBADO';

  if v_pendientes > 0 then
    raise exception 'El hito % todavía tiene % documento(s) habilitante(s) sin aprobar',
                    p_hito_id, v_pendientes;
  end if;

  update hito
     set estado         = 'COMPLETO',
         completado_en  = now(),
         completado_por = p_usuario
   where id = p_hito_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.registrar_fechas_partida(p_partida_id bigint, p_fecha_entrega date, p_fecha_factura date, p_cuf text, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pa record;
  v_habilitantes_pendientes int;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  if not contexto_confiable()
     and rol_actual() not in ('gerente', 'admin', 'supervisor', 'comercial') then
    raise exception 'Tu rol no puede registrar fechas de la partida';
  end if;

  select * into v_pa from partida_abierta where id = p_partida_id for update;
  if not found then raise exception 'La partida % no existe', p_partida_id; end if;
  if v_pa.estado <> 'ABIERTA' then
    raise exception 'La partida % está en estado %', p_partida_id, v_pa.estado;
  end if;

  if p_fecha_entrega is not null and p_fecha_entrega > current_date then
    raise exception 'La fecha de entrega no puede ser futura';
  end if;
  if p_fecha_factura is not null and p_fecha_factura > current_date then
    raise exception 'La fecha de factura no puede ser futura';
  end if;
  if p_fecha_factura is not null and coalesce(p_fecha_entrega, v_pa.fecha_entrega) is null then
    raise exception 'No se puede registrar la factura sin fecha de entrega';
  end if;
  if p_fecha_factura is not null
     and p_fecha_factura < coalesce(p_fecha_entrega, v_pa.fecha_entrega) then
    raise exception 'La factura no puede ser anterior a la entrega';
  end if;

  select count(*) into v_habilitantes_pendientes
    from documento d
    join hito h on h.id = d.hito_id
   where h.partida_abierta_id = p_partida_id
     and d.tipo = 'HABILITANTE'
     and d.estado <> 'APROBADO';

  update partida_abierta
     set fecha_entrega = coalesce(p_fecha_entrega, fecha_entrega),
         fecha_factura = coalesce(p_fecha_factura, fecha_factura),
         cuf           = coalesce(nullif(btrim(coalesce(p_cuf, '')), ''), cuf),
         documentado   = (v_habilitantes_pendientes = 0)
   where id = p_partida_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.anular_partida(p_partida_id bigint, p_motivo text, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pa       record;
  v_aplicado numeric;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  if not contexto_confiable() and rol_actual() <> 'gerente' then
    raise exception 'Solo el rol gerente puede anular una partida';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select * into v_pa from partida_abierta where id = p_partida_id for update;
  if not found then raise exception 'La partida % no existe', p_partida_id; end if;
  if v_pa.estado <> 'ABIERTA' then
    raise exception 'La partida % está en estado % y no se puede anular', p_partida_id, v_pa.estado;
  end if;

  select coalesce(sum(pap.monto), 0) into v_aplicado
    from pago_aplicacion pap
    join pago pg on pg.id = pap.pago_id
   where pap.partida_id = p_partida_id
     and pg.estado in ('CONFIRMADO', 'ACREDITADO');
  if v_aplicado > 0 then
    raise exception 'La partida % tiene Bs % aplicados: no se puede anular', p_partida_id, v_aplicado;
  end if;

  update partida_abierta
     set estado = 'ANULADA', anulada_en = now(), anulada_por = p_usuario,
         motivo_anulacion = btrim(p_motivo)
   where id = p_partida_id;

  insert into movimiento_cuenta (
    cliente_id, partida_id, tipo, monto, idempotencia_clave,
    fecha_efectiva, referencia, motivo, creado_por
  ) values (
    v_pa.cliente_id, p_partida_id, 'NOTA_CREDITO', -v_pa.total,
    'anulacion-partida-' || p_partida_id, current_date,
    v_pa.documento_interno, 'Anulación: ' || btrim(p_motivo), p_usuario
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.partir_partida(p_partida_id bigint, p_monto numeric, p_usuario text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pa       record;
  v_aplicado numeric;
  v_num      bigint;
  v_serie    text;
  v_doc      text;
  v_nueva    bigint;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  if not contexto_confiable() and rol_actual() <> 'gerente' then
    raise exception 'Solo el rol gerente puede partir una partida';
  end if;

  select * into v_pa from partida_abierta where id = p_partida_id for update;
  if not found then raise exception 'La partida % no existe', p_partida_id; end if;
  if v_pa.estado <> 'ABIERTA' then
    raise exception 'La partida % está en estado % y no se puede partir', p_partida_id, v_pa.estado;
  end if;
  if p_monto is null or p_monto <= 0 or p_monto >= v_pa.total then
    raise exception 'El monto a separar debe ser mayor que 0 y menor que el total (%)', v_pa.total;
  end if;

  select coalesce(sum(pap.monto), 0) into v_aplicado
    from pago_aplicacion pap
    join pago pg on pg.id = pap.pago_id
   where pap.partida_id = p_partida_id
     and pg.estado in ('CONFIRMADO', 'ACREDITADO');
  if v_pa.total - p_monto < v_aplicado then
    raise exception 'No se puede: quedarían Bs % en la partida original con Bs % ya aplicados',
      v_pa.total - p_monto, v_aplicado;
  end if;

  select serie into v_serie from contador_documento where tipo = 'PARTIDA';
  v_num := siguiente_numero('PARTIDA');
  v_doc := 'PART-' || v_serie || '-' || lpad(v_num::text, 5, '0');

  insert into partida_abierta (
    cliente_id, cliente_nombre, cliente_nit, cliente_categoria,
    pedido_id, venta_id, documento_interno, total,
    inicio_computo, plazo_dias, referencia, creado_por
  ) values (
    v_pa.cliente_id, v_pa.cliente_nombre, v_pa.cliente_nit, v_pa.cliente_categoria,
    v_pa.pedido_id, v_pa.venta_id, v_doc, p_monto,
    v_pa.inicio_computo, v_pa.plazo_dias,
    coalesce(v_pa.referencia, '') || ' (parcial de ' || v_pa.documento_interno || ')',
    p_usuario
  )
  returning id into v_nueva;

  update partida_abierta set total = total - p_monto where id = p_partida_id;

  insert into movimiento_cuenta (cliente_id, partida_id, tipo, monto, idempotencia_clave,
                                 fecha_efectiva, referencia, motivo, creado_por)
  values (v_pa.cliente_id, p_partida_id, 'NOTA_CREDITO', -p_monto,
          'particion-origen-' || v_nueva, current_date, v_pa.documento_interno,
          'Traspaso a ' || v_doc, p_usuario);

  insert into movimiento_cuenta (cliente_id, partida_id, tipo, monto, idempotencia_clave,
                                 fecha_efectiva, referencia, motivo, creado_por)
  values (v_pa.cliente_id, v_nueva, 'CARGO', p_monto,
          'particion-destino-' || v_nueva, current_date, v_doc,
          'Traspaso desde ' || v_pa.documento_interno, p_usuario);

  return v_nueva;
end;
$function$
;
CREATE OR REPLACE FUNCTION hermes.imputar_pago(p_pago_id bigint, p_aplicaciones jsonb, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pago      record;
  v_a         record;
  v_suma      numeric := 0;
  v_pendiente numeric;
  v_n         int := 0;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  select * into v_pago from pago where id = p_pago_id for update;
  if not found then
    raise exception 'Pago % no existe', p_pago_id;
  end if;
  if v_pago.estado <> 'PROPUESTO' then
    raise exception 'El pago % está en estado % — solo se puede imputar un PROPUESTO',
      p_pago_id, v_pago.estado;
  end if;
  if v_pago.no_imputar and jsonb_array_length(coalesce(p_aplicaciones,'[]'::jsonb)) > 0 then
    raise exception 'El pago % está marcado como anticipo (no imputar). '
                    'Quitá esa marca antes de repartirlo entre partidas.', p_pago_id;
  end if;

  delete from pago_aplicacion where pago_id = p_pago_id;

  for v_a in
    select (x->>'partida_id')::bigint as partida_id,
           (x->>'monto')::numeric     as monto
      from jsonb_array_elements(coalesce(p_aplicaciones,'[]'::jsonb)) x
  loop
    if v_a.monto is null or v_a.monto <= 0 then
      raise exception 'Monto inválido (%) para la partida %', v_a.monto, v_a.partida_id;
    end if;

    select ve.pendiente into v_pendiente
      from v_partida_estado ve
     where ve.partida_id = v_a.partida_id and ve.cliente_id = v_pago.cliente_id;

    if v_pendiente is null then
      raise exception 'La partida % no existe o no pertenece al cliente del pago', v_a.partida_id;
    end if;
    if v_a.monto > v_pendiente then
      raise exception 'No se puede imputar % a la partida %: solo quedan pendientes %',
        v_a.monto, v_a.partida_id, v_pendiente;
    end if;

    insert into pago_aplicacion (pago_id, partida_id, monto)
    values (p_pago_id, v_a.partida_id, v_a.monto);

    v_suma := v_suma + v_a.monto;
    v_n := v_n + 1;
  end loop;

  if v_suma > v_pago.monto then
    raise exception 'La suma imputada (%) supera el monto del pago (%)', v_suma, v_pago.monto;
  end if;

  return jsonb_build_object(
    'pago_id', p_pago_id, 'aplicaciones', v_n,
    'imputado', v_suma, 'excedente', v_pago.monto - v_suma);
end;
$function$
;
do $$ declare f record; begin for f in
 select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='hermes' and p.proname=any(array['rol_actual','subir_documento','confirmar_pago','cargar_saldo_apertura','registrar_nota_credito','sincronizar_clientes_cation','sincronizar_pedidos_cation','actualizar_credito_cliente','obtener_detalle_pedido_cation','revisar_documento','completar_hito','registrar_fechas_partida','anular_partida','partir_partida','imputar_pago'])
 loop execute format('grant execute on function %s to authenticated',f.signature); end loop; end $$;
alter default privileges in schema hermes revoke execute on functions from public;
alter default privileges for role hermes_app in schema hermes revoke execute on functions from public;
notify pgrst, 'reload schema';
