-- ENSAYO de 20261105210000_caja_almacen_reintegro_turno_cerrado.sql: BEGIN … ROLLBACK, no deja nada. Correr con la caja cerrada.
begin;
-- Reintegro de VTD con turno cerrado y cobro de VTD ajena (2026-11-05).
--
-- Decisión del 26 oct: si el turno del cobro ya cerró, la devolución queda fuera de arqueo y la
-- registra el gerente. Eso solo se cumplía en ventas sin operación. En Caja–Almacén la devolución
-- salía del turno abierto de quien rechazaba, y sin turno abierto fallaba.
--
-- 1. caja_almacen.operar, `rechazar` con turno cerrado:
--    - cobrada: solo quien puede anular; no crea movimiento de caja ni revisa efectivo.
--    - sin cobrar: cualquier cajero o gerente, sin pedir turno abierto.
-- 2. _anular_venta_nucleo informa fuera_de_arqueo y el importe en ese caso.
-- 3. vtd_cobrar: un cajero no cobra una VTD de otro cajero con turno abierto.
--
-- `ajustar` con turno cerrado sigue igual: la devolución sale del turno de quien ajusta.
-- Antes de aplicar: correr supabase/ensayos/20261105210000_caja_almacen_reintegro_turno_cerrado_ENSAYO.sql
-- con la caja cerrada.

do $mig$
declare d text; viejo text; nuevo text;
begin
  d := replace(pg_get_functiondef('caja_almacen.operar(text,uuid,bigint,jsonb)'::regprocedure), E'\r\n', E'\n');

  viejo := $q$antes jsonb; despues jsonb; hcli bigint; unidades numeric;$q$;
  nuevo := $q$antes jsonb; despues jsonb; hcli bigint; unidades numeric;
  fuera boolean:=false;  -- [REINTEGRO]$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (a) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$    -- [AJUSTE] + 'ajustar'
    if p_accion in ('rechazar','ajustar') then
      -- La devolución sale del turno abierto de quien rechaza/ajusta, no del turno cerrado.
      select * into ses from public.sesion_caja where cajero_id=actor.id and estado='ABIERTA' order by id desc limit 1 for update;
      if not found then raise exception 'Abre tu turno para registrar la devolución de esta VTD.'; end if;
    end if;$q$;
  nuevo := $q$    -- [REINTEGRO] Turno cerrado y VTD cobrada: fuera de arqueo y solo quien puede anular.
    if p_accion='rechazar' then
      if exists(select 1 from public.venta_pago where venta_id=(p_datos->>'venta_id')::bigint and coalesce(estado_verificacion::text,'')<>'RECHAZADO') then
        if not public.app_puede_anular() then raise exception 'El turno de esta VTD ya cerró y está cobrada: la devolución la registra el gerente. Solicita la anulación.' using errcode='42501'; end if;
        fuera:=true;
      end if;
    elsif p_accion='ajustar' then
      -- La devolución sale del turno abierto de quien ajusta, no del turno cerrado.
      select * into ses from public.sesion_caja where cajero_id=actor.id and estado='ABIERTA' order by id desc limit 1 for update;
      if not found then raise exception 'Abre tu turno para registrar la devolución de esta VTD.'; end if;
    end if;$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (b) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$if efectivo<(select coalesce(sum(monto),0) from public.venta_pago where venta_id=vid and metodo='EFECTIVO' and coalesce(estado_verificacion::text,'')<>'RECHAZADO') then$q$;
  nuevo := $q$if not fuera and efectivo<(select coalesce(sum(monto),0) from public.venta_pago where venta_id=vid and metodo='EFECTIVO' and coalesce(estado_verificacion::text,'')<>'RECHAZADO') then$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (c) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$for pago in select * from public.venta_pago where venta_id=vid loop$q$;
  nuevo := $q$for pago in select * from public.venta_pago where venta_id=vid and ses.estado::text='ABIERTA' loop  -- [REINTEGRO]$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (d) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$values(op.id,vid,'RECHAZADO',actor.id,p_datos);$q$;
  nuevo := $q$values(op.id,vid,'RECHAZADO',actor.id,p_datos||jsonb_build_object('fuera_de_arqueo',fuera));$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (e) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);
  execute d;

  d := replace(pg_get_functiondef('public._anular_venta_nucleo(bigint,text,text,bigint,text)'::regprocedure), E'\r\n', E'\n');
  viejo := $q$      from movimiento_caja where venta_id = p_venta_id and tipo = 'ANULACION';
    perform _anulacion_registrar(p_venta_id, v_motivo, p_solicitud_id, p_nota,
      jsonb_build_object('monto', v_pagos, 'sesion_id', v_ses, 'fuera_de_arqueo', false, 'pagos', v_detalle));$q$;
  nuevo := $q$      from movimiento_caja where venta_id = p_venta_id and tipo = 'ANULACION';
    -- [REINTEGRO] Sin movimiento de caja y con pago válido: el turno ya cerró, va fuera de arqueo.
    if v_pagos = 0 and exists (select 1 from venta_pago where venta_id = p_venta_id and coalesce(estado_verificacion::text, '') <> 'RECHAZADO') then
      v_fuera := true;
      v_ses := null;
      select coalesce(sum(monto), 0), coalesce(jsonb_agg(jsonb_build_object('metodo', metodo, 'monto', monto)), '[]'::jsonb)
        into v_pagos, v_detalle
        from venta_pago where venta_id = p_venta_id and coalesce(estado_verificacion::text, '') <> 'RECHAZADO';
    end if;
    perform _anulacion_registrar(p_venta_id, v_motivo, p_solicitud_id, p_nota,
      jsonb_build_object('monto', v_pagos, 'sesion_id', v_ses, 'fuera_de_arqueo', v_fuera, 'pagos', v_detalle));$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (f) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);
  viejo := $q$'devuelto', v_pagos, 'reintegro_sesion_id', v_ses, 'fuera_de_arqueo', false);$q$;
  nuevo := $q$'devuelto', v_pagos, 'reintegro_sesion_id', v_ses, 'fuera_de_arqueo', v_fuera);$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (g) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);
  execute d;

  d := replace(pg_get_functiondef('public.vtd_cobrar(bigint,jsonb,bigint,text)'::regprocedure), E'\r\n', E'\n');
  viejo := $q$  select * into o from public.caja_operacion_almacen where id=d.operacion_id for update;

  if v.estado='COMPLETADA' or o.cerrado_en is not null then$q$;
  nuevo := $q$  select * into o from public.caja_operacion_almacen where id=d.operacion_id for update;
  -- [REINTEGRO] Igual que vtd_rechazar, vtd_ajustar y vtd_pago_posterior.
  if actor.rol='cajero' and o.cerrado_en is null and o.cajero_id<>actor.id and exists(select 1 from public.sesion_caja where id=o.sesion_id and estado='ABIERTA') then
    raise exception 'Esta VTD es de la operación de otro cajero con turno abierto.' using errcode='42501';
  end if;

  if v.estado='COMPLETADA' or o.cerrado_en is not null then$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (h) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);
  execute d;
end
$mig$;

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
  cajero uuid; ness uuid; otro uuid; ses bigint; prod bigint; pres bigint; ubi bigint; opid uuid; vid1 bigint; vid2 bigint; vid3 bigint; vid4 bigint; r jsonb; res text := ''; fallo text;
begin
  update evidencia_vtd.configuracion set activo = false where id;
  select id into cajero from public.perfil where email = 'ivar1230@gmail.com';
  select id into ness from public.perfil where email = 'nessxd14@gmail.com';
  select pr.id, pr.producto_id, s.ubicacion_id into pres, prod, ubi from public.presentacion pr
    join public.stock_actual s on s.producto_id = pr.producto_id join public.producto pp on pp.id = pr.producto_id
   where pr.factor_unidad_base = 1 and coalesce(pr.activo, true) and pr.vende_tienda and coalesce(pp.activo, true) and s.cantidad_base >= 50
   order by s.cantidad_base desc limit 1;
  select id into ses from public.sesion_caja where estado::text = 'ABIERTA' and cajero_id = cajero;
  if ses is null then
    if exists (select 1 from public.sesion_caja where estado::text = 'ABIERTA') then raise exception 'ENSAYO: hay un turno real abierto de otro cajero; correr con la caja cerrada.'; end if;
    perform pg_temp.como(cajero); ses := (public.abrir_turno(1, '{}'::jsonb)->>'sesion_id')::bigint;
  end if;
  select id into otro from public.perfil where rol = 'cajero' and activo and id <> cajero limit 1;

  -- 1) Turno abierto: el rechazo cobrado sigue creando la devolución en el turno.
  opid := gen_random_uuid(); vid4 := pg_temp.vtd(cajero, ses, opid, prod, pres, ubi);
  perform pg_temp.como(cajero);
  perform public.vtd_cobrar(vid4, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-reintegro-4-' || vid4);
  perform public.vtd_rechazar(vid4, 'Ensayo turno abierto', true, null);
  if (select count(*) from public.movimiento_caja where venta_id = vid4 and tipo = 'ANULACION' and sesion_caja_id = ses) <> 1 then raise exception 'ENSAYO FALLÓ [1]: sin devolución en turno abierto'; end if;
  res := res || E'\n1 TURNO ABIERTO devuelve en su caja: ok';

  -- 2) Cobro de VTD ajena con turno abierto.
  opid := gen_random_uuid(); vid3 := pg_temp.vtd(cajero, ses, opid, prod, pres, ubi);
  perform public.operar_caja_almacen('aparcar', opid, ses, '{}'::jsonb);
  if otro is not null then
    update public.sesion_caja set cajero_id = otro where id = ses;
    perform pg_temp.como(otro);
    fallo := null;
    begin
      perform public.vtd_cobrar(vid3, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-reintegro-3-' || vid3);
    exception when others then fallo := sqlerrm; end;
    update public.sesion_caja set cajero_id = cajero where id = ses;
    if coalesce(fallo,'') not like '%otro cajero%' then raise exception 'ENSAYO FALLÓ [2]: debía rechazar el cobro ajeno: %', fallo; end if;
    res := res || E'\n2 COBRO de VTD ajena rechazado: ok';
  else
    res := res || E'\n2 COBRO de VTD ajena: omitido, no hay otro cajero';
  end if;

  -- 3) Preparar: una VTD cobrada y otra sin cobrar, ambas en espera; el gerente cierra el turno.
  perform pg_temp.como(cajero);
  opid := gen_random_uuid(); vid1 := pg_temp.vtd(cajero, ses, opid, prod, pres, ubi);
  perform public.operar_caja_almacen('aparcar', opid, ses, '{}'::jsonb);
  perform pg_temp.como(cajero);
  perform public.vtd_cobrar(vid1, '[{"metodo":"EFECTIVO","monto":90}]'::jsonb, ses, 'ensayo-reintegro-1-' || vid1);
  opid := gen_random_uuid(); vid2 := pg_temp.vtd(cajero, ses, opid, prod, pres, ubi);
  perform public.operar_caja_almacen('aparcar', opid, ses, '{}'::jsonb);
  perform pg_temp.como(ness);
  perform public.cerrar_turno_gerente(ses, '{}'::jsonb, 'Ensayo de turno cerrado con pendientes', true);
  res := res || E'\n3 CIERRE del gerente con pendientes: ok';

  -- 4) Cajero, turno cerrado, VTD cobrada: no puede; debe solicitarla.
  perform pg_temp.como(cajero);
  fallo := null;
  begin
    perform public.vtd_rechazar(vid1, 'Ensayo cajero sin permiso', true, null);
  exception when others then fallo := sqlerrm; end;
  if coalesce(fallo,'') not like 'El turno de esta VTD ya cerró%' then raise exception 'ENSAYO FALLÓ [4]: %', fallo; end if;
  res := res || E'\n4 CAJERO no reintegra con turno cerrado: ok';

  -- 5) Cajero, sin turno abierto, VTD sin cobrar: sí puede y no toca caja.
  perform public.vtd_rechazar(vid2, 'Ensayo sin cobro', false, null);
  if (select estado from public.caja_operacion_vtd where venta_id = vid2) <> 'CANCELADO' then raise exception 'ENSAYO FALLÓ [5]: no quedó cancelada'; end if;
  if exists (select 1 from public.movimiento_caja where venta_id = vid2) then raise exception 'ENSAYO FALLÓ [5]: creó movimiento'; end if;
  res := res || E'\n5 SIN COBRO se rechaza sin turno: ok';

  -- 6) Gerente sin turno propio: anula la cobrada, fuera de arqueo y sin movimiento.
  perform pg_temp.como(ness);
  r := public.anular_venta(vid1, null, null, 'Ensayo reintegro turno cerrado');
  if (r->>'fuera_de_arqueo')::boolean is not true or (r->>'devuelto')::numeric <> 90 then raise exception 'ENSAYO FALLÓ [6]: %', r; end if;
  if exists (select 1 from public.movimiento_caja where venta_id = vid1 and tipo = 'ANULACION') then raise exception 'ENSAYO FALLÓ [6]: creó movimiento de caja'; end if;
  if not exists (select 1 from public.venta_anulacion where venta_id = vid1 and estado = 'APROBADA' and reintegro_fuera_de_arqueo and reintegro_monto = 90) then raise exception 'ENSAYO FALLÓ [6]: venta_anulacion sin fuera de arqueo'; end if;
  if (select estado::text from public.venta where id = vid1) <> 'ANULADA' then raise exception 'ENSAYO FALLÓ [6]: no quedó anulada'; end if;
  res := res || E'\n6 GERENTE anula fuera de arqueo: ok';

  raise exception E'ENSAYO OK (revertido):%', res;
end $t$;

rollback;
