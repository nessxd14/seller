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
