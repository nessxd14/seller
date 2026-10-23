-- Fix 2026-10-22: anular_venta es SECURITY INVOKER y `authenticated` no puede leer caja_operacion_vtd
-- («permission denied for table caja_operacion_vtd»). La consulta pasa a un helper SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.app_vtd_en_caja_almacen(p_venta_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.caja_operacion_vtd where venta_id = p_venta_id)
$function$;

revoke all on function public.app_vtd_en_caja_almacen(bigint) from public, anon;
grant execute on function public.app_vtd_en_caja_almacen(bigint) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_venta(p_venta_id bigint, p_usuario text DEFAULT NULL::text, p_sesion_caja_id bigint DEFAULT NULL::bigint, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_venta    venta%rowtype;
  v_k        record;
  v_p        record;
  v_rechazo  text;
  v_pagos    numeric;
  v_revert   int := 0;
begin
  select * into v_venta from venta where id = p_venta_id for update;
  if not found then
    raise exception 'Venta % no existe', p_venta_id;
  end if;

  if v_venta.estado not in ('COMPLETADA', 'ABIERTA') then
    raise exception 'La venta % está en estado % y no se puede anular',
      p_venta_id, v_venta.estado;
  end if;

  -- [CIERRE] VTD vinculada a una operación Caja–Almacén: se resuelve con Rechazar, no con Anular.
  if app_vtd_en_caja_almacen(p_venta_id) then  -- [FIX] anular_venta corre como invocador: lee con helper SECURITY DEFINER
    if v_venta.estado = 'ABIERTA' then
      raise exception '% está en una operación Caja–Almacén y no se anula desde aquí. Recházala en Caja → «Operaciones en espera de Almacén» (o en la operación abierta del cajero).',
        coalesce(v_venta.numero, '#' || p_venta_id);
    else
      raise exception '% ya se entregó por Caja–Almacén. Revertirla es una devolución, que todavía no está habilitada: avisa al gerente.',
        coalesce(v_venta.numero, '#' || p_venta_id);
    end if;
  end if;

  v_rechazo := app_puede_revertir_venta(p_venta_id, 'anular');
  if v_rechazo is not null then
    raise exception '%', v_rechazo using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(monto), 0) into v_pagos
    from venta_pago where venta_id = p_venta_id;

  if v_pagos > 0 and p_sesion_caja_id is null then
    raise exception
      'La venta % tiene % cobrado: hay que indicar la sesión de caja donde se devuelve el dinero.',
      p_venta_id, v_pagos;
  end if;

  insert into venta_evento (venta_id, accion, motivo, usuario)
  values (p_venta_id, 'ANULADA', p_motivo, p_usuario);

  for v_k in
    select id, presentacion_id, ubicacion_id, cantidad
      from kardex_transacciones
     where referencia = 'Venta #' || p_venta_id and tipo_movimiento = 'SALIDA'
  loop
    perform registrar_entrada(v_k.presentacion_id, v_k.ubicacion_id, abs(v_k.cantidad),
                              'Anulación Venta #' || p_venta_id, p_usuario, current_date, null,
                              'anula:v' || p_venta_id || ':k' || v_k.id);
    v_revert := v_revert + 1;
  end loop;

  if p_sesion_caja_id is not null then
    perform 1 from sesion_caja where id = p_sesion_caja_id and estado = 'ABIERTA';
    if not found then
      raise exception 'La sesión de caja % no está abierta', p_sesion_caja_id;
    end if;
    for v_p in select metodo, monto from venta_pago where venta_id = p_venta_id loop
      insert into movimiento_caja (sesion_caja_id, tipo, metodo, monto, venta_id, creado_por, nota)
      values (p_sesion_caja_id, 'ANULACION', v_p.metodo, v_p.monto, p_venta_id, p_usuario,
              'Anulación de venta #' || p_venta_id);
    end loop;
  end if;

  update venta set estado = 'ANULADA' where id = p_venta_id;

  return jsonb_build_object(
    'venta_id',          p_venta_id,
    'estado',            'ANULADA',
    'estado_previo',     v_venta.estado,
    'kardex_revertido',  v_revert,
    'devuelto',          case when p_sesion_caja_id is not null then v_pagos else 0 end
  );
end;
$function$;

revoke all on function public.anular_venta(bigint,text,bigint,text) from public, anon;
grant execute on function public.anular_venta(bigint,text,bigint,text) to authenticated, service_role;
