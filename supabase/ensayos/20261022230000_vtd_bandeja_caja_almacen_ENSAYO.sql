-- ENSAYO de 20261022230000_vtd_bandeja_caja_almacen.sql: BEGIN … ROLLBACK, no deja nada. Correr con la caja cerrada.
begin;
-- Ventas Directas: los botones de la bandeja funcionan con las VTD de Caja–Almacén (2026-10-22).
--
-- Desde el 2026-10-19 toda VTD nace dentro de una operación Caja–Almacén y el disparador
-- caja_almacen.guardar_integridad bloquea cualquier cambio que no venga de esa operación.
-- La bandeja seguía llamando a cobrar_vtd / ajustar_venta_abierta / marcar_vtd_pago_posterior /
-- anular_venta / completar_venta → todas fallaban. Esta migración agrega RPC por VTD que buscan
-- su operación y hacen lo correcto:
--   vtd_info(ids)            estado de Caja–Almacén de cada VTD (para pintar la bandeja)
--   vtd_cobrar(...)          cobra SOLO esa VTD (la separa en su propia operación; lo de mostrador
--                            queda en la operación original/carrito)
--   vtd_ajustar(...)         reduce cantidades (acción `ajustar` de la operación)
--   vtd_rechazar(...)        rechaza (acción `rechazar`); en efectivo ya no pide referencia
--   vtd_pago_posterior(...)  pago posterior también para VTD de Caja–Almacén (decisión de Ness)
-- Y ajusta caja_almacen.operar / cerrar_si_resuelta para que una VTD con pago posterior se entregue
-- sin cobro (como en el flujo viejo).
--
-- Requisitos: 20261022170000, 20261022200000 y 20261022210000 ya aplicadas (lo están).
-- Antes de aplicar: correr el ENSAYO (BEGIN…ROLLBACK) y revisar «ENSAYO OK».

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ¿La operación está "resuelta en plata" por pago posterior?
--    Sí cuando tiene VTD vigentes, TODAS con pago posterior, y no tiene productos de mostrador.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION caja_almacen.solo_pago_posterior(p_op uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.caja_operacion_vtd d where d.operacion_id = p_op and d.estado in ('SOLICITADO','EN_CAJA','ENTREGADO'))
     and not exists (select 1 from public.caja_operacion_vtd d join public.venta v on v.id = d.venta_id
                      where d.operacion_id = p_op and d.estado in ('SOLICITADO','EN_CAJA','ENTREGADO') and not v.pago_posterior)
     and coalesce((select jsonb_array_length(coalesce(o.borrador->'cart','[]'::jsonb)) from public.caja_operacion_almacen o where o.id = p_op), 0) = 0
$function$;
revoke all on function caja_almacen.solo_pago_posterior(uuid) from public, anon, authenticated;
grant execute on function caja_almacen.solo_pago_posterior(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cerrar_si_resuelta: + pago posterior, + operación vacía (todas sus VTD se separaron).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION caja_almacen.cerrar_si_resuelta(p_op uuid, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare op public.caja_operacion_almacen%rowtype; v_estado text;
begin
  select * into op from public.caja_operacion_almacen where id=p_op for update;
  if not found or op.cerrado_en is not null then return null; end if;
  if not exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id) then
    -- Operación que se quedó sin VTD (se separaron todas): se cierra si tampoco tiene mostrador.
    if op.comprobante is null and jsonb_array_length(coalesce(op.borrador->'cart','[]'::jsonb))=0 then
      update public.caja_operacion_almacen set estado='RECHAZADA',cerrado_en=now(),revision=revision+1 where id=op.id;
      insert into public.caja_operacion_evento(operacion_id,accion,actor_id,detalle)
        values(op.id,'CERRADA_AUTO',p_actor,jsonb_build_object('estado','RECHAZADA','motivo','sin VTD'));
      return 'RECHAZADA';
    end if;
    return null;
  end if;
  if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO') then return null; end if;
  if op.comprobante is null and not caja_almacen.solo_pago_posterior(op.id) then
    if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado in ('EN_CAJA','ENTREGADO'))
       or jsonb_array_length(coalesce(op.borrador->'cart','[]'::jsonb))>0 then return null; end if;
    v_estado:='RECHAZADA';
  else
    if op.comprobante is not null and exists(select 1 from public.venta_pago vp
               where vp.venta_id in (select value::bigint from jsonb_array_elements_text(op.comprobante->'ventas'))
                 and vp.estado_verificacion::text='RECHAZADO'
                 and exists(select 1 from public.venta vs where vs.id=vp.venta_id and vs.estado<>'ANULADA')) then return null; end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
    update public.venta set estado='COMPLETADA',completado_en=now()
     where id in (select venta_id from public.caja_operacion_vtd where operacion_id=op.id and estado='EN_CAJA');
    update public.caja_operacion_vtd set estado='ENTREGADO',version=version+1 where operacion_id=op.id and estado='EN_CAJA';
    delete from caja_almacen.contexto where transaccion=txid_current();
    v_estado:=case when exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='ENTREGADO')
                   then 'COMPLETADA' else 'RECHAZADA' end;
  end if;
  update public.caja_operacion_almacen set estado=v_estado,cerrado_en=now(),revision=revision+1 where id=op.id;
  insert into public.caja_operacion_evento(operacion_id,accion,actor_id,detalle)
    values(op.id,'CERRADA_AUTO',p_actor,jsonb_build_object('estado',v_estado));
  return v_estado;
end;
$function$;
revoke all on function caja_almacen.cerrar_si_resuelta(uuid,uuid) from public, anon, authenticated;
grant execute on function caja_almacen.cerrar_si_resuelta(uuid,uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Aparcar temporalmente la operación "actual" del actor dentro de esta transacción.
--    guardar_integridad rechaza tocar otra operación mientras el actor tiene una actual sin aparcar;
--    las RPC de la bandeja la aparcan, trabajan y la restauran (todo en la misma transacción).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION caja_almacen.aparcar_actual(p_actor uuid, p_salvo uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v uuid;
begin
  update public.caja_operacion_almacen set en_espera=true
   where cajero_id=p_actor and cerrado_en is null and not en_espera and id is distinct from p_salvo
  returning id into v;
  return v;
end;
$function$;
revoke all on function caja_almacen.aparcar_actual(uuid,uuid) from public, anon, authenticated;
grant execute on function caja_almacen.aparcar_actual(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION caja_almacen.restaurar_actual(p_op uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  update public.caja_operacion_almacen set en_espera=false where id=p_op and cerrado_en is null
$function$;
revoke all on function caja_almacen.restaurar_actual(uuid) from public, anon, authenticated;
grant execute on function caja_almacen.restaurar_actual(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. caja_almacen.operar: tres ajustes puntuales sobre la versión viva (20261022200000).
--    a) Rechazo cobrado en EFECTIVO: basta confirmar la devolución; la referencia sólo para QR/transferencia.
--    b) `enviar` completa sola también una operación de pago posterior.
--    c) `completar` acepta una operación de pago posterior sin comprobante.
-- ─────────────────────────────────────────────────────────────────────────────
do $mig$
declare d text; viejo text; nuevo text;
begin
  -- La versión viva se guardó con saltos CRLF (pegada desde Windows): se normaliza antes de reemplazar.
  d := replace(pg_get_functiondef('caja_almacen.operar(text,uuid,bigint,jsonb)'::regprocedure), E'\r\n', E'\n');

  viejo := $q$      if p_datos->>'devolucion_realizada' is distinct from 'true' or length(btrim(coalesce(p_datos->>'referencia','')))<3 then raise exception 'Confirma la devolución realizada e indica su referencia antes de resolver el rechazo.'; end if;$q$;
  nuevo := $q$      -- [BANDEJA] efectivo: basta confirmar; la referencia sólo para QR/transferencia.
      if p_datos->>'devolucion_realizada' is distinct from 'true' then raise exception 'Confirma que devolviste el importe al cliente antes de rechazar.'; end if;
      if length(btrim(coalesce(p_datos->>'referencia','')))<3 and exists(select 1 from public.venta_pago where venta_id=vid and metodo::text<>'EFECTIVO' and coalesce(estado_verificacion::text,'')<>'RECHAZADO') then raise exception 'Indica la referencia de la devolución por QR o transferencia.'; end if;$q$;
  viejo := replace(viejo, E'\r\n', E'\n'); nuevo := replace(nuevo, E'\r\n', E'\n');
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (a) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$      if op.comprobante is not null
         and not exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO')$q$;
  nuevo := $q$      if (op.comprobante is not null or caja_almacen.solo_pago_posterior(op.id))  -- [BANDEJA] pago posterior
         and not exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO')$q$;
  viejo := replace(viejo, E'\r\n', E'\n'); nuevo := replace(nuevo, E'\r\n', E'\n');
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (b) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$      if op.comprobante is null then raise exception 'Primero registra el cobro conjunto de esta operación.'; end if;$q$;
  nuevo := $q$      if op.comprobante is null and not caja_almacen.solo_pago_posterior(op.id) then raise exception 'Primero registra el cobro conjunto de esta operación.'; end if;  -- [BANDEJA]$q$;
  viejo := replace(viejo, E'\r\n', E'\n'); nuevo := replace(nuevo, E'\r\n', E'\n');
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (c) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  execute d;
end
$mig$;
revoke all on function caja_almacen.operar(text,uuid,bigint,jsonb) from public, anon;
grant execute on function caja_almacen.operar(text,uuid,bigint,jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC de la bandeja de Ventas Directas.
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.0 Estado Caja–Almacén de varias VTD (para la bandeja). VTD sin operación → caja_almacen=false.
CREATE OR REPLACE FUNCTION public.vtd_info(p_venta_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  if not exists(select 1 from public.perfil where id=auth.uid() and activo and rol in ('cajero','admin','gerente','almacenero','operario')) then
    raise exception 'No autorizado' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'venta_id', x.id,
      'caja_almacen', d.venta_id is not null,
      'operacion_id', d.operacion_id,
      'operacion_estado', o.estado,
      'operacion_cerrada', o.cerrado_en is not null,
      'cajero_id', o.cajero_id,
      'turno_abierto', s.estado::text = 'ABIERTA',
      'entrega', d.estado,
      'version', d.version,
      'faltante', d.faltante,
      'lineas', d.lineas) order by x.id)
    from unnest(p_venta_ids) x(id)
    left join public.caja_operacion_vtd d on d.venta_id = x.id
    left join public.caja_operacion_almacen o on o.id = d.operacion_id
    left join public.sesion_caja s on s.id = o.sesion_id), '[]'::jsonb);
end;
$function$;
revoke all on function public.vtd_info(bigint[]) from public, anon;
grant execute on function public.vtd_info(bigint[]) to authenticated, service_role;

-- 5.1 Rechazar desde la bandeja.
CREATE OR REPLACE FUNCTION public.vtd_rechazar(p_venta_id bigint, p_motivo text, p_devolucion_realizada boolean DEFAULT false, p_referencia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare d public.caja_operacion_vtd%rowtype; o public.caja_operacion_almacen%rowtype; actor public.perfil%rowtype; aparcada uuid; r jsonb;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('cajero','admin','gerente') then raise exception 'No autorizado' using errcode='42501'; end if;
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id;
  if not found then raise exception 'Esta venta no pasó por Caja–Almacén: usa Anular.'; end if;
  select * into o from public.caja_operacion_almacen where id=d.operacion_id;
  if actor.rol='cajero' and o.cajero_id<>actor.id and exists(select 1 from public.sesion_caja where id=o.sesion_id and estado='ABIERTA') then
    raise exception 'Esta VTD es de la operación de otro cajero con turno abierto: que la resuelva él o un gerente.' using errcode='42501';
  end if;
  aparcada := caja_almacen.aparcar_actual(actor.id, o.id);
  r := caja_almacen.operar('rechazar', o.id, o.sesion_id, jsonb_build_object(
         'venta_id', p_venta_id, 'motivo', coalesce(p_motivo,''),
         'devolucion_realizada', coalesce(p_devolucion_realizada,false), 'referencia', coalesce(p_referencia,'')));
  if aparcada is not null then perform caja_almacen.restaurar_actual(aparcada); end if;
  return r;
end;
$function$;
revoke all on function public.vtd_rechazar(bigint,text,boolean,text) from public, anon;
grant execute on function public.vtd_rechazar(bigint,text,boolean,text) to authenticated, service_role;

-- 5.2 Ajustar desde la bandeja (sólo baja cantidades; misma regla que `ajustar` de la operación).
CREATE OR REPLACE FUNCTION public.vtd_ajustar(p_venta_id bigint, p_lineas jsonb, p_motivo text, p_devolucion jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare d public.caja_operacion_vtd%rowtype; o public.caja_operacion_almacen%rowtype; actor public.perfil%rowtype; aparcada uuid; r jsonb; datos jsonb;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('cajero','admin','gerente') then raise exception 'No autorizado' using errcode='42501'; end if;
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id;
  if not found then raise exception 'Esta venta no pasó por Caja–Almacén.'; end if;
  select * into o from public.caja_operacion_almacen where id=d.operacion_id;
  if actor.rol='cajero' and o.cajero_id<>actor.id and exists(select 1 from public.sesion_caja where id=o.sesion_id and estado='ABIERTA') then
    raise exception 'Esta VTD es de la operación de otro cajero con turno abierto: que la ajuste él o un gerente.' using errcode='42501';
  end if;
  datos := jsonb_build_object('venta_id', p_venta_id, 'version', d.version, 'motivo', coalesce(p_motivo,''), 'lineas', p_lineas);
  if p_devolucion is not null and jsonb_typeof(p_devolucion)='object' then datos := datos || jsonb_build_object('devolucion', p_devolucion); end if;
  aparcada := caja_almacen.aparcar_actual(actor.id, o.id);
  r := caja_almacen.operar('ajustar', o.id, o.sesion_id, datos);
  if aparcada is not null then perform caja_almacen.restaurar_actual(aparcada); end if;
  return r;
end;
$function$;
revoke all on function public.vtd_ajustar(bigint,jsonb,text,jsonb) from public, anon;
grant execute on function public.vtd_ajustar(bigint,jsonb,text,jsonb) to authenticated, service_role;

-- 5.3 Separar una VTD de su operación en una operación propia (misma persona y turno que la original).
CREATE OR REPLACE FUNCTION caja_almacen.separar_vtd(p_venta_id bigint, p_cajero uuid, p_sesion bigint, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare d public.caja_operacion_vtd%rowtype; nueva uuid := gen_random_uuid();
begin
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id for update;
  insert into public.caja_operacion_almacen(id,cajero_id,sesion_id,en_espera) values(nueva,p_cajero,p_sesion,true);
  update public.caja_operacion_vtd set operacion_id=nueva,version=version+1 where venta_id=p_venta_id;
  insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle)
    values(d.operacion_id,p_venta_id,'SEPARADA',p_actor,jsonb_build_object('nueva_operacion',nueva));
  insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle)
    values(nueva,p_venta_id,'VINCULADO',p_actor,jsonb_build_object('separada_de',d.operacion_id));
  perform caja_almacen.cerrar_si_resuelta(d.operacion_id, p_actor);  -- si la original quedó vacía
  return nueva;
end;
$function$;
revoke all on function caja_almacen.separar_vtd(bigint,uuid,bigint,uuid) from public, anon, authenticated;
grant execute on function caja_almacen.separar_vtd(bigint,uuid,bigint,uuid) to service_role;

-- 5.4 Cobrar SOLO esta VTD desde la bandeja, en el turno abierto de quien cobra.
--     Si la VTD sigue en su operación, se separa en una operación propia y esa se cobra; lo de mostrador
--     (si lo hubiera) queda en la operación original. Si ya se entregó con pago posterior, se cobra directo.
CREATE OR REPLACE FUNCTION public.vtd_cobrar(p_venta_id bigint, p_pagos jsonb, p_sesion_id bigint, p_idempotencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare d public.caja_operacion_vtd%rowtype; o public.caja_operacion_almacen%rowtype; v public.venta%rowtype;
        actor public.perfil%rowtype; previo public.cobro_caja%rowtype; aparcada uuid; destino uuid; r jsonb;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('cajero','admin','gerente') then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_idempotencia is null or length(p_idempotencia)<8 then raise exception 'Clave de cobro inválida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vtd-cobrar:'||p_idempotencia,0));
  select * into previo from public.cobro_caja where idempotencia=p_idempotencia;
  if found then
    if previo.actor_id is distinct from actor.id then raise exception 'Este cobro pertenece a otro usuario.' using errcode='42501'; end if;
    return previo.documento||jsonb_build_object('reintento',true);
  end if;
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id for update;
  if not found then raise exception 'Esta venta no pasó por Caja–Almacén.'; end if;
  select * into v from public.venta where id=p_venta_id for update;
  if v.estado not in ('ABIERTA','COMPLETADA') or exists(select 1 from public.venta_pago where venta_id=p_venta_id) then
    raise exception '% ya está cobrada o anulada.', v.numero;
  end if;
  if not exists(select 1 from public.sesion_caja where id=p_sesion_id and estado='ABIERTA'
                 and (cajero_id=actor.id or actor.rol in ('admin','gerente'))) then
    raise exception 'Abre tu turno de caja para cobrar.' using errcode='42501';
  end if;
  select * into o from public.caja_operacion_almacen where id=d.operacion_id for update;

  if v.estado='COMPLETADA' or o.cerrado_en is not null then
    -- Entregada con pago posterior: se cobra en el contexto de su operación (ya cerrada).
    destino := o.id;
  else
    if d.estado not in ('SOLICITADO','EN_CAJA') then raise exception '% no está pendiente de cobro.', v.numero; end if;
    destino := caja_almacen.separar_vtd(p_venta_id, actor.id, p_sesion_id, actor.id);
  end if;

  aparcada := caja_almacen.aparcar_actual(actor.id, destino);
  insert into caja_almacen.contexto values(txid_current(), destino);
  r := caja_almacen.checkout_base('[]'::jsonb, p_pagos, p_sesion_id, p_idempotencia, v.cliente_id, 0, 0, null, '{}'::bigint[], '[]'::jsonb, array[p_venta_id]);
  delete from caja_almacen.contexto where transaccion=txid_current();

  if destino is distinct from o.id or o.cerrado_en is null then
    update public.caja_operacion_almacen set comprobante=r, estado='COBRADA', en_espera=true, revision=revision+1 where id=destino;
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(destino,p_venta_id,'COBRADA_BANDEJA',actor.id);
    perform caja_almacen.cerrar_si_resuelta(destino, actor.id);  -- si Almacén ya lo había enviado, se entrega
  end if;
  if aparcada is not null then perform caja_almacen.restaurar_actual(aparcada); end if;
  return r;
end;
$function$;
revoke all on function public.vtd_cobrar(bigint,jsonb,bigint,text) from public, anon;
grant execute on function public.vtd_cobrar(bigint,jsonb,bigint,text) to authenticated, service_role;

-- 5.5 Pago posterior para una VTD de Caja–Almacén: se separa en su propia operación y, cuando
--     Almacén la envía (o si ya la envió), se entrega sin cobro y queda por cobrar.
CREATE OR REPLACE FUNCTION public.vtd_pago_posterior(p_venta_id bigint, p_motivo text, p_contacto text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare d public.caja_operacion_vtd%rowtype; o public.caja_operacion_almacen%rowtype; v public.venta%rowtype;
        actor public.perfil%rowtype; aparcada uuid; destino uuid;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('cajero','admin','gerente') then raise exception 'No autorizado' using errcode='42501'; end if;
  if p_motivo is null or length(btrim(p_motivo))<5 then raise exception 'El motivo es obligatorio (mínimo 5 caracteres)'; end if;
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id for update;
  if not found then raise exception 'Esta venta no pasó por Caja–Almacén: usa el pago posterior normal.'; end if;
  select * into v from public.venta where id=p_venta_id for update;
  if v.estado<>'ABIERTA' then raise exception '% está en estado %: el pago posterior solo se marca antes de entregar.', v.numero, v.estado; end if;
  if v.pago_posterior then return jsonb_build_object('venta_id',p_venta_id,'numero',v.numero,'pago_posterior',true,'reintento',true); end if;
  if exists(select 1 from public.venta_pago where venta_id=p_venta_id) then raise exception '% ya tiene un cobro registrado.', v.numero; end if;
  if v.cliente_id is null and (p_contacto is null or length(btrim(p_contacto))<3) then
    raise exception 'Indica quién se lleva la mercadería (nombre y teléfono) para poder cobrarle después';
  end if;
  if d.estado not in ('SOLICITADO','EN_CAJA') then raise exception '% no está pendiente de entrega.', v.numero; end if;
  select * into o from public.caja_operacion_almacen where id=d.operacion_id for update;
  if o.cerrado_en is not null or o.comprobante is not null then raise exception 'La operación de % ya se cobró o se cerró.', v.numero; end if;
  if actor.rol='cajero' and o.cajero_id<>actor.id and exists(select 1 from public.sesion_caja where id=o.sesion_id and estado='ABIERTA') then
    raise exception 'Esta VTD es de la operación de otro cajero con turno abierto.' using errcode='42501';
  end if;

  -- Sola en su operación y sin mostrador: se queda; si no, se separa.
  if (select count(*) from public.caja_operacion_vtd where operacion_id=o.id)=1 and jsonb_array_length(coalesce(o.borrador->'cart','[]'::jsonb))=0 then
    destino := o.id;
    update public.caja_operacion_almacen set en_espera=true, revision=revision+1 where id=o.id;
  else
    destino := caja_almacen.separar_vtd(p_venta_id, o.cajero_id, o.sesion_id, actor.id);
  end if;

  aparcada := caja_almacen.aparcar_actual(actor.id, destino);
  insert into caja_almacen.contexto values(txid_current(), destino);
  update public.venta
     set pago_posterior=true, pago_posterior_motivo=btrim(p_motivo),
         pago_posterior_contacto=nullif(btrim(coalesce(p_contacto,'')),''),
         pago_posterior_por=coalesce(actor.email,'sistema'), pago_posterior_en=now()
   where id=p_venta_id;
  insert into public.venta_evento(venta_id,accion,motivo,usuario) values(p_venta_id,'PAGO_POSTERIOR',btrim(p_motivo),coalesce(actor.email,'sistema'));
  delete from caja_almacen.contexto where transaccion=txid_current();
  insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle)
    values(destino,p_venta_id,'PAGO_POSTERIOR',actor.id,jsonb_build_object('motivo',btrim(p_motivo),'contacto',p_contacto));
  perform caja_almacen.cerrar_si_resuelta(destino, actor.id);  -- si ya estaba EN_CAJA, se entrega ahora
  if aparcada is not null then perform caja_almacen.restaurar_actual(aparcada); end if;
  return jsonb_build_object('venta_id',p_venta_id,'numero',v.numero,'pago_posterior',true);
end;
$function$;
revoke all on function public.vtd_pago_posterior(bigint,text,text) from public, anon;
grant execute on function public.vtd_pago_posterior(bigint,text,text) to authenticated, service_role;

-- ===== ENSAYO (todo se revierte) =====
create function pg_temp.como(uid uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end $fn$;
create function pg_temp.vtd(cajero uuid, ses bigint, opid uuid, prod bigint, pres bigint, ubi bigint) returns bigint language plpgsql as $fn$
declare r jsonb;
begin
  perform pg_temp.como(cajero);
  r := public.operar_caja_almacen('crear_vtd', opid, ses, jsonb_build_object('borrador','{}'::jsonb,'solicitud',jsonb_build_object(
    'lineas', jsonb_build_array(jsonb_build_object('producto_id',prod,'presentacion_id',pres,'cantidad_presentacion',2,'precio_unitario',45)),
    'ubicacion_id',ubi,'descuento',0,'cliente_id',null)));
  return (r->'vtds'->0->>'venta_id')::bigint;
end $fn$;
create function pg_temp.enviar(alm uuid, vid bigint) returns jsonb language plpgsql as $fn$
declare cur jsonb;
begin
  perform pg_temp.como(alm);
  cur := public.operar_caja_almacen('escanear', null, null, jsonb_build_object('venta_id', vid))->'vtds'->0;
  return public.operar_caja_almacen('enviar', null, null, jsonb_build_object('venta_id', vid, 'version', (cur->>'version')::int,
    'cantidades', (select jsonb_agg(jsonb_build_object('linea_id', x->'linea_id', 'cantidad_base', x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(cur->'lineas') x)));
end $fn$;

do $t$
declare
  cajero uuid; alm uuid; ses bigint; prod bigint; pres bigint; ubi bigint; opid uuid; vid bigint; lid bigint; r jsonb; res text := '';
  op_orig uuid; op_nueva uuid; x record;
begin
  update evidencia_vtd.configuracion set activo = false where id;
  if position('[BANDEJA]' in pg_get_functiondef('caja_almacen.operar(text,uuid,bigint,jsonb)'::regprocedure)) = 0 then raise exception 'ENSAYO FALLÓ [0]: operar sin cambios'; end if;
  select id into cajero from public.perfil where email = 'ivar1230@gmail.com';
  select id into alm from public.perfil where email = 'nessxd14@gmail.com';
  select pr.id, pr.producto_id, s.ubicacion_id into pres, prod, ubi from public.presentacion pr
    join public.stock_actual s on s.producto_id = pr.producto_id join public.producto pp on pp.id = pr.producto_id
   where pr.factor_unidad_base = 1 and coalesce(pr.activo, true) and pr.vende_tienda and coalesce(pp.activo, true) and s.cantidad_base >= 50
   order by s.cantidad_base desc limit 1;
  select id into ses from public.sesion_caja where estado::text = 'ABIERTA' and cajero_id = cajero;
  if ses is null then
    if exists (select 1 from public.sesion_caja where estado::text = 'ABIERTA') then raise exception 'ENSAYO: hay un turno real abierto de otro cajero; correr con la caja cerrada'; end if;
    perform pg_temp.como(cajero); ses := (public.abrir_turno(1, '{}'::jsonb)->>'sesion_id')::bigint;
  end if;
  res := res || E'\n0 base: ok';

  -- 1) Cobrar desde la bandeja una VTD aparcada (sin mostrador) → se separa, se cobra; la original se cierra vacía.
  op_orig := gen_random_uuid(); vid := pg_temp.vtd(cajero, ses, op_orig, prod, pres, ubi);
  perform public.operar_caja_almacen('aparcar', op_orig, ses, '{}'::jsonb);
  perform pg_temp.como(cajero);
  r := public.vtd_cobrar(vid, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-bandeja-1-' || vid);
  if not exists (select 1 from public.venta_pago where venta_id = vid and monto = 90) then raise exception 'ENSAYO FALLÓ [1]: sin pago'; end if;
  select operacion_id into op_nueva from public.caja_operacion_vtd where venta_id = vid;
  if op_nueva = op_orig then raise exception 'ENSAYO FALLÓ [1]: no se separó'; end if;
  if (select estado from public.caja_operacion_almacen where id = op_nueva) <> 'COBRADA' then raise exception 'ENSAYO FALLÓ [1]: nueva no COBRADA'; end if;
  if (select cerrado_en from public.caja_operacion_almacen where id = op_orig) is null then raise exception 'ENSAYO FALLÓ [1]: original vacía quedó abierta'; end if;
  -- reintento idempotente
  perform pg_temp.como(cajero);
  r := public.vtd_cobrar(vid, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-bandeja-1-' || vid);
  if (r->>'reintento')::boolean is distinct from true then raise exception 'ENSAYO FALLÓ [1]: reintento no idempotente'; end if;
  r := pg_temp.enviar(alm, vid);
  if r->'operacion'->>'estado' <> 'COMPLETADA' or (select estado::text from public.venta where id = vid) <> 'COMPLETADA' then raise exception 'ENSAYO FALLÓ [1]: envío no completó %', r; end if;
  res := res || E'\n1 COBRAR en bandeja (aparcada): ok, cobra 90, separa, Almacén envía y se entrega';

  -- 2) Cobrar desde la bandeja con productos de mostrador en la operación actual → solo la VTD; el carrito queda.
  op_orig := gen_random_uuid(); vid := pg_temp.vtd(cajero, ses, op_orig, prod, pres, ubi);
  perform pg_temp.como(cajero);
  perform public.operar_caja_almacen('guardar', op_orig, ses, jsonb_build_object('revision', (select revision from public.caja_operacion_almacen where id = op_orig),
    'borrador', jsonb_build_object('cart', jsonb_build_array(jsonb_build_object('id','ensayo','qty',1)))));
  perform pg_temp.como(cajero);
  r := public.vtd_cobrar(vid, '[{"metodo":"QR","monto":90}]'::jsonb, ses, 'ensayo-bandeja-2-' || vid);
  select * into x from public.caja_operacion_almacen where id = op_orig;
  if x.cerrado_en is not null or x.en_espera or x.comprobante is not null then raise exception 'ENSAYO FALLÓ [2]: la operación con mostrador cambió: %', to_jsonb(x); end if;
  if (select operacion_id from public.caja_operacion_vtd where venta_id = vid) = op_orig then raise exception 'ENSAYO FALLÓ [2]: no se separó'; end if;
  -- dejar limpia la operación del cajero para lo que sigue
  perform pg_temp.como(cajero);
  perform public.operar_caja_almacen('guardar', op_orig, ses, jsonb_build_object('revision', x.revision, 'borrador', jsonb_build_object('cart','[]'::jsonb)));
  perform public.operar_caja_almacen('cerrar_rechazo', op_orig, ses, '{}'::jsonb);
  r := pg_temp.enviar(alm, vid);
  if (select estado::text from public.venta where id = vid) <> 'COMPLETADA' then raise exception 'ENSAYO FALLÓ [2]: envío no completó %', r; end if;
  res := res || E'\n2 COBRAR con mostrador en la operación: ok, cobra solo la VTD, el carrito sigue en la operación del cajero';

  -- 3) Ajustar desde la bandeja (sin cobrar): 2 → 1, total 45.
  op_orig := gen_random_uuid(); vid := pg_temp.vtd(cajero, ses, op_orig, prod, pres, ubi);
  select id into lid from public.venta_linea where venta_id = vid;
  perform pg_temp.como(cajero);
  r := public.vtd_ajustar(vid, jsonb_build_array(jsonb_build_object('linea_id', lid, 'cantidad_presentacion', 1)), 'Ensayo: Almacén tiene 1');
  if (select total from public.venta where id = vid) <> 45 then raise exception 'ENSAYO FALLÓ [3]: total %', (select total from public.venta where id = vid); end if;
  res := res || E'\n3 AJUSTAR en bandeja: ok (90 → 45)';

  -- 4) Rechazar cobrada en EFECTIVO sin referencia.
  perform pg_temp.como(cajero);
  r := public.vtd_cobrar(vid, '[{"metodo":"EFECTIVO","monto":45}]'::jsonb, ses, 'ensayo-bandeja-4-' || vid);
  perform pg_temp.como(cajero);
  begin
    perform public.vtd_rechazar(vid, 'Ensayo cliente se fue', false, null);
    raise exception 'ENSAYO FALLÓ [4]: rechazó sin confirmar devolución';
  exception when others then if sqlerrm not like '%Confirma que devolviste%' then raise exception 'ENSAYO FALLÓ [4]: %', sqlerrm; end if; end;
  perform pg_temp.como(cajero);
  r := public.vtd_rechazar(vid, 'Ensayo cliente se fue', true, null);
  if (select estado::text from public.venta where id = vid) <> 'ANULADA' then raise exception 'ENSAYO FALLÓ [4]: no anuló'; end if;
  if not exists (select 1 from public.movimiento_caja where venta_id = vid and tipo::text = 'ANULACION' and metodo::text = 'EFECTIVO' and monto = 45) then raise exception 'ENSAYO FALLÓ [4]: sin ANULACION efectivo'; end if;
  if (select cerrado_en from public.caja_operacion_almacen o join public.caja_operacion_vtd d on d.operacion_id = o.id where d.venta_id = vid) is null then raise exception 'ENSAYO FALLÓ [4]: operación abierta'; end if;
  res := res || E'\n4 RECHAZAR efectivo sin referencia: ok, ANULACION 45, operación cerrada';

  -- 5) Pago posterior: se entrega sin cobro al enviar y después se cobra desde la bandeja.
  op_orig := gen_random_uuid(); vid := pg_temp.vtd(cajero, ses, op_orig, prod, pres, ubi);
  perform pg_temp.como(cajero);
  r := public.vtd_pago_posterior(vid, 'Ensayo: paga mañana', 'Juan 70000000');
  if not (select pago_posterior from public.venta where id = vid) then raise exception 'ENSAYO FALLÓ [5]: no marcó'; end if;
  r := pg_temp.enviar(alm, vid);
  if (select estado::text from public.venta where id = vid) <> 'COMPLETADA' then raise exception 'ENSAYO FALLÓ [5]: no se entregó (%)', r; end if;
  if exists (select 1 from public.venta_pago where venta_id = vid) then raise exception 'ENSAYO FALLÓ [5]: tenía pago'; end if;
  perform pg_temp.como(cajero);
  r := public.vtd_cobrar(vid, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-bandeja-5-' || vid);
  if not exists (select 1 from public.venta_pago where venta_id = vid and monto = 90) then raise exception 'ENSAYO FALLÓ [5]: cobro posterior'; end if;
  res := res || E'\n5 PAGO POSTERIOR: ok, Almacén entrega sin cobro y luego se cobra desde la bandeja';

  -- 6) vtd_info
  perform pg_temp.como(cajero);
  r := public.vtd_info(array[vid, (select id from public.venta where numero not like 'VTD-%' order by id desc limit 1)]);
  if (select (e->>'caja_almacen')::boolean from jsonb_array_elements(r) e where (e->>'venta_id')::bigint = vid) is distinct from true
     or (select bool_or((e->>'caja_almacen')::boolean) from jsonb_array_elements(r) e where (e->>'venta_id')::bigint <> vid) is distinct from false then raise exception 'ENSAYO FALLÓ [6]: %', r; end if;
  res := res || E'\n6 VTD_INFO: ok';

  -- 7) Cierre de turno sin pendientes
  perform pg_temp.como(cajero);
  r := public.cerrar_turno(ses, '{}'::jsonb, true);
  res := res || E'\n7 CIERRE DE TURNO: ok (' || (r->>'estado') || ')';

  raise exception E'ENSAYO OK (revertido):%', res;
end $t$;

rollback;
