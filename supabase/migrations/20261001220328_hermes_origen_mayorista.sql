-- Primera etapa: procedencia verificable de cotización, pedido y salida de almacén.
-- No registra cargos, pagos, recepciones ni fechas de vencimiento.
alter table hermes.hito
  add column origen_sistema text,
  add column origen_estado text,
  add column origen_datos jsonb not null default '{}'::jsonb,
  add constraint hito_origen_valido check (
    (origen_sistema is null and origen_estado is null) or
    (origen_sistema is not null and origen_estado is not null and origen_sistema in ('SELLER','ALMACEN') and
     origen_estado in ('COMPLETO','PENDIENTE','PARCIAL','NO_APLICA','ANULADO','REVISION'))
  ),
  add constraint hito_origen_datos_objeto check(jsonb_typeof(origen_datos)='object');

create function hermes.resumen_origen_pedido(p_pedido_id bigint) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
declare p public.pedido%rowtype; c public.cotizacion%rowtype; s record;
  cot_estado text; ped_estado text; salida_estado text;
begin
  select * into p from public.pedido where id=p_pedido_id;
  if not found then return null; end if;
  if p.cotizacion_origen_id is not null then
    select * into c from public.cotizacion where id=p.cotizacion_origen_id;
  end if;
  -- Los eventos permiten descontar reversiones. El contador cubre despachos antiguos
  -- sin eventos. Nunca se deduce una salida solo del estado COMPLETADO del pedido.
  with lineas as (
    select l.*,
      l.estado::text in ('COMPRADO_DIRECTO','ESPECIAL') fuera_almacen,
      case when exists(select 1 from public.pedido_despacho_evento e where e.pedido_linea_id=l.id)
        then coalesce((select sum(case when e.revertido then 0 else
          case when exists(select 1 from public.pedido_despacho_movimiento m where m.evento_id=e.id)
            then least(e.cantidad_base,coalesce((select sum(greatest(m.cantidad_base-m.cantidad_revertida,0))
              from public.pedido_despacho_movimiento m where m.evento_id=e.id),0))
            else e.cantidad_base end end)
          from public.pedido_despacho_evento e where e.pedido_linea_id=l.id),0)
        else coalesce(l.cantidad_despachada,0) end despachado
    from public.pedido_linea l where l.pedido_id=p.id
      and l.estado::text not in ('CAMBIADA','RECHAZADO','RETIRADA')
  )
  select count(*)::int activas,
    count(*) filter(where not fuera_almacen)::int almacen,
    count(*) filter(where fuera_almacen)::int directas,
    count(*) filter(where not fuera_almacen and cantidad_base>0 and despachado>=cantidad_base)::int completas,
    count(*) filter(where not fuera_almacen and despachado>0 and despachado<cantidad_base)::int parciales,
    count(*) filter(where cantidad_base is null or cantidad_base<=0 or despachado<0)::int invalidas,
    count(*) filter(where precio_unitario is null or subtotal is null)::int importes_ausentes,
    coalesce(jsonb_agg(jsonb_build_object('id',id,'cantidad_despachada',despachado) order by id),'[]'::jsonb) detalle_lineas
    into s from lineas;

  cot_estado:=case when p.estado::text='CANCELADO' then 'ANULADO'
    when p.cotizacion_origen_id is null then 'NO_APLICA'
    when c.id is null or c.cliente_id is distinct from p.cliente_id then 'REVISION'
    when c.estado::text in ('APROBADA','CONVERTIDA') then 'COMPLETO'
    when c.estado::text='ANULADA' then 'ANULADO' else 'PENDIENTE' end;
  ped_estado:=case when p.estado::text='CANCELADO' then 'ANULADO'
    when p.cliente_id is null or p.total is null or p.total<=0 or s.activas=0 or s.invalidas>0 then 'REVISION'
    else 'COMPLETO' end;
  salida_estado:=case when p.estado::text='CANCELADO' then 'ANULADO'
    when s.activas=0 or s.invalidas>0 then 'REVISION'
    when s.almacen=0 then 'NO_APLICA'
    when s.completas=s.almacen then 'COMPLETO'
    when s.completas>0 or s.parciales>0 then 'PARCIAL' else 'PENDIENTE' end;
  return jsonb_build_object(
    'pedido',jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado::text,
      'creado_en',p.creado_en,'creado_por',p.creado_por,'total',p.total,'origen_estado',ped_estado),
    'cotizacion',case when c.id is not null and c.cliente_id=p.cliente_id then
      jsonb_build_object('id',c.id,'numero',c.numero,'estado',c.estado::text,'fecha',c.fecha,
        'total',c.total,'aprobado_por',c.aprobado_por,'aprobado_en',c.aprobado_en) else null end,
    'cotizacion_estado',cot_estado,
    'recepcion',jsonb_build_object('fecha',p.recibido_en,'responsable',p.recibido_por),
    'salida',jsonb_build_object('origen_estado',salida_estado,'lineas_activas',s.activas,
      'lineas_almacen',s.almacen,'lineas_despachadas',s.completas,'lineas_parciales',s.parciales,
      'lineas_fuera_almacen',s.directas,'importes_ausentes',s.importes_ausentes,'lineas',s.detalle_lineas));
end $$;
revoke all on function hermes.resumen_origen_pedido(bigint) from public,anon,authenticated,service_role;

-- El registro del POS sustituye estos dos requisitos estándar del mayorista.
-- Los documentos existentes se conservan, al igual que los habilitantes adicionales.
update hermes.documento_plantilla d set tipo='ANEXO'
from hermes.hito_plantilla h where h.id=d.hito_plantilla_id and h.categoria='MAYORISTA'
  and ((h.nombre='Pedido' and d.etiqueta='Orden de pedido') or
       (h.nombre='Salida de almacén' and d.etiqueta='Foto de salida de almacén'));

create function hermes.actualizar_origen_mayorista(p_pedido_id bigint) returns void
language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
declare datos jsonb; h record; sistema text; estado_fuente text; completo boolean;
begin
  if not exists(select 1 from hermes.partida_abierta where pedido_id=p_pedido_id
    and cliente_categoria='MAYORISTA' and estado='ABIERTA' and parent_partida_id is null) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('hermes-origen:'||p_pedido_id,0));
  datos:=hermes.resumen_origen_pedido(p_pedido_id);
  if datos is null then return; end if;
  update hermes.documento d set tipo='ANEXO'
  from hermes.hito hi,hermes.partida_abierta pa,hermes.documento_plantilla dp
  where d.hito_id=hi.id and hi.partida_abierta_id=pa.id and pa.pedido_id=p_pedido_id
    and pa.cliente_categoria='MAYORISTA' and pa.estado='ABIERTA' and pa.parent_partida_id is null
    and d.documento_plantilla_id=dp.id and dp.tipo='ANEXO' and d.tipo='HABILITANTE'
    and ((hi.nombre='Pedido' and dp.etiqueta='Orden de pedido') or
      (hi.nombre='Salida de almacén' and dp.etiqueta='Foto de salida de almacén'));
  for h in select hi.* from hermes.hito hi join hermes.partida_abierta pa on pa.id=hi.partida_abierta_id
    where pa.pedido_id=p_pedido_id and pa.cliente_categoria='MAYORISTA' and pa.estado='ABIERTA'
      and pa.parent_partida_id is null and hi.nombre in ('Cotización','Pedido','Salida de almacén')
    order by hi.id
  loop
    sistema:=case when h.nombre='Salida de almacén' then 'ALMACEN' else 'SELLER' end;
    estado_fuente:=case h.nombre when 'Cotización' then datos->>'cotizacion_estado'
      when 'Pedido' then datos->'pedido'->>'origen_estado' else datos->'salida'->>'origen_estado' end;
    completo:=estado_fuente in ('COMPLETO','NO_APLICA') and not exists(
      select 1 from hermes.documento d where d.hito_id=h.id and d.tipo='HABILITANTE' and d.estado<>'APROBADO');
    update hermes.hito set origen_sistema=sistema,origen_estado=estado_fuente,origen_datos=datos,
      estado=case when completo then 'COMPLETO'::hermes.estado_hito else 'PENDIENTE'::hermes.estado_hito end,
      completado_en=case when completo then coalesce(h.completado_en,now()) else null end,
      completado_por=case when completo then lower(sistema)||':automatico' else null end
    where id=h.id and (origen_sistema,origen_estado,origen_datos,estado) is distinct from
      (sistema,estado_fuente,datos,case when completo then 'COMPLETO'::hermes.estado_hito else 'PENDIENTE'::hermes.estado_hito end);
  end loop;
  update hermes.partida_abierta pa set documentado=not exists(
    select 1 from hermes.documento d join hermes.hito hi on hi.id=d.hito_id
    where hi.partida_abierta_id=pa.id and d.tipo='HABILITANTE' and d.estado<>'APROBADO')
  where pa.pedido_id=p_pedido_id and pa.cliente_categoria='MAYORISTA' and pa.estado='ABIERTA'
    and pa.parent_partida_id is null;
end $$;
revoke all on function hermes.actualizar_origen_mayorista(bigint) from public,anon,authenticated,service_role;

-- Las columnas de procedencia solo las escribe el proceso interno.
create function hermes.proteger_origen_hito() returns trigger
language plpgsql set search_path=pg_catalog,hermes as $$
begin
  if tg_op='INSERT' then
    if current_user<>'postgres' and (new.origen_sistema is not null or new.origen_estado is not null
      or new.origen_datos<>'{}'::jsonb) then
      raise exception 'Esta etapa se actualiza desde Seller o almacén' using errcode='42501';
    end if;
    return new;
  end if;
  if current_user<>'postgres' and (
    (new.origen_sistema,new.origen_estado,new.origen_datos) is distinct from
      (old.origen_sistema,old.origen_estado,old.origen_datos) or
    (old.origen_sistema is not null and new.estado is distinct from old.estado)) then
    raise exception 'Esta etapa se actualiza desde Seller o almacén' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function hermes.proteger_origen_hito() from public,anon,authenticated,service_role;
create trigger proteger_origen_hito before insert or update on hermes.hito
for each row execute function hermes.proteger_origen_hito();

create function hermes.al_cambiar_origen_mayorista() returns trigger
language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
declare p_id bigint; otro_id bigint; r record;
begin
  if tg_table_name='partida_abierta' then p_id:=new.pedido_id;
  elsif tg_table_name='pedido' then p_id:=new.id;
  elsif tg_table_name='pedido_linea' then
    if tg_op='DELETE' then p_id:=old.pedido_id; else p_id:=new.pedido_id; end if;
    if tg_op='UPDATE' and old.pedido_id is distinct from new.pedido_id then otro_id:=old.pedido_id; end if;
  elsif tg_table_name='cotizacion' then
    for r in select id from public.pedido where cotizacion_origen_id=new.id order by id loop
      perform hermes.actualizar_origen_mayorista(r.id);
    end loop;
  elsif tg_table_name='documento' then
    -- Una conversión interna de habilitante a anexo ya será evaluada por su llamador.
    if pg_trigger_depth()>1 then return null; end if;
    if tg_op='DELETE' then otro_id:=old.hito_id; else otro_id:=new.hito_id; end if;
    select pa.pedido_id into p_id from hermes.hito h join hermes.partida_abierta pa on pa.id=h.partida_abierta_id
      where h.id=otro_id and h.origen_sistema is not null;
    otro_id:=null;
  elsif tg_table_name='pedido_despacho_evento' then
    if tg_op='DELETE' then otro_id:=old.pedido_linea_id; else otro_id:=new.pedido_linea_id; end if;
    select pedido_id into p_id from public.pedido_linea where id=otro_id; otro_id:=null;
  elsif tg_table_name='pedido_despacho_movimiento' then
    if tg_op='DELETE' then otro_id:=old.evento_id; else otro_id:=new.evento_id; end if;
    select l.pedido_id into p_id from public.pedido_linea l join public.pedido_despacho_evento e on e.pedido_linea_id=l.id
      where e.id=otro_id; otro_id:=null;
  end if;
  if p_id is not null then perform hermes.actualizar_origen_mayorista(p_id); end if;
  if otro_id is not null then perform hermes.actualizar_origen_mayorista(otro_id); end if;
  return null;
end $$;
revoke all on function hermes.al_cambiar_origen_mayorista() from public,anon,authenticated,service_role;
-- El expediente estándar se genera antes (los AFTER triggers se ordenan por nombre).
create trigger trg_zz_origen_mayorista after insert on hermes.partida_abierta
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_pedido after update of estado,cotizacion_origen_id,total,cliente_id on public.pedido
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_linea after insert or update or delete on public.pedido_linea
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_cotizacion after update of estado,cliente_id,total,aprobado_en on public.cotizacion
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_despacho after insert or update or delete on public.pedido_despacho_evento
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_movimiento after insert or update or delete on public.pedido_despacho_movimiento
for each row execute function hermes.al_cambiar_origen_mayorista();
create trigger hermes_origen_documento after insert or update of estado,tipo or delete on hermes.documento
for each row execute function hermes.al_cambiar_origen_mayorista();

create function hermes.obtener_origen_expediente(p_partida_id bigint) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
declare pa hermes.partida_abierta%rowtype; datos jsonb; lineas jsonb; pago jsonb;
begin
  if not public.hermes_tiene_acceso() then raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  select * into pa from hermes.partida_abierta where id=p_partida_id;
  if not found then raise exception 'Partida no existe' using errcode='P0002'; end if;
  if pa.cliente_categoria<>'MAYORISTA' or pa.pedido_id is null or pa.parent_partida_id is not null then return null; end if;
  datos:=hermes.resumen_origen_pedido(pa.pedido_id);
  if datos is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'descripcion',coalesce(nullif(l.descripcion,''),pr.nombre,'Sin descripción'),
    'cantidad_base',l.cantidad_base,'cantidad_presentacion',l.cantidad_presentacion,
    'precio_unitario',l.precio_unitario,'descuento_pct',l.descuento_pct,'subtotal',l.subtotal) order by l.id),'[]'::jsonb)
    into lineas from public.cotizacion_linea l left join public.producto pr on pr.id=l.producto_id
    where l.cotizacion_id=(datos->'cotizacion'->>'id')::bigint;
  select jsonb_build_object('imputado',imputado,'pendiente',pendiente,'en_revision',en_revision)
    into pago from hermes.v_partida_estado where partida_id=pa.id;
  return datos||jsonb_build_object('lineas_cotizacion',lineas,'pago',pago);
end $$;
revoke all on function hermes.obtener_origen_expediente(bigint) from public,anon,service_role;
grant execute on function hermes.obtener_origen_expediente(bigint) to authenticated;

-- Recuperación de procedencia: solo partidas raíz abiertas de mayoristas.
do $$ declare r record; begin
  for r in select distinct pedido_id from hermes.partida_abierta
    where cliente_categoria='MAYORISTA' and estado='ABIERTA' and parent_partida_id is null
      and pedido_id is not null order by pedido_id loop
    perform hermes.actualizar_origen_mayorista(r.pedido_id);
  end loop;
end $$;
