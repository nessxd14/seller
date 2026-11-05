-- Regularización de las VTD pagadas, sin salida de Kardex y sin operación (semana del 12 oct).
-- Correr en el SQL Editor con la caja cerrada. Por defecto NO guarda nada: termina con una
-- excepción que muestra el resumen. Para guardar, cambiar aplicar a true y volver a correr.
--
-- Llenar las listas con venta.id, después de revisar con Almacén:
--   descontar:    se entregó y el stock actual todavía la incluye. Completa y registra la salida.
--   sin_descontar: se entregó y un conteo posterior ya la absorbió. Completa sin tocar Kardex.
--   anular:       no se entregó. Anula; con turno cerrado el reintegro queda fuera de arqueo.
-- Una venta que no esté en ninguna lista queda como está.

do $reg$
declare
  aplicar       constant boolean  := false;
  descontar     constant bigint[] := '{}';
  sin_descontar constant bigint[] := '{}';
  anular        constant bigint[] := '{}';
  motivo        constant text     := 'Regularización VTD sin operación, revisada con Almacén 2026-11-05';
  todas bigint[] := descontar || sin_descontar || anular;
  v public.venta%rowtype; l public.venta_linea%rowtype; pres bigint; k bigint; id_venta bigint; salidas int := 0;
begin
  if (select count(distinct x) from unnest(todas) x) <> cardinality(todas) then raise exception 'Una venta está en más de una lista.'; end if;
  foreach id_venta in array todas loop
    select * into v from public.venta where id = id_venta for update;
    if not found or v.numero not like 'VTD-%' or v.estado::text <> 'ABIERTA'
       or exists (select 1 from public.caja_operacion_vtd d where d.venta_id = id_venta)
       or not exists (select 1 from public.venta_pago p where p.venta_id = id_venta)
       or exists (select 1 from public.venta_linea x where x.venta_id = id_venta and x.kardex_transaccion_id is not null) then
      raise exception 'La venta % no es una VTD pagada, abierta, sin operación y sin Kardex.', id_venta;
    end if;
  end loop;

  foreach id_venta in array descontar loop
    select * into v from public.venta where id = id_venta;
    for l in select * from public.venta_linea where venta_id = id_venta order by id loop
      pres := coalesce(l.presentacion_id, (select id from public.presentacion where producto_id = l.producto_id and es_base limit 1));
      k := public.registrar_salida(
        p_presentacion_id => pres,
        p_ubicacion_id => public.resolver_ubicacion_salida(l.producto_id, v.ubicacion_id),
        p_cantidad_pres => coalesce(l.cantidad_presentacion, l.cantidad),
        p_referencia => 'Venta #' || id_venta,
        p_usuario => 'Regularización',
        p_fecha => (l.creado_en at time zone 'America/La_Paz')::date,
        p_idempotencia => 'venta_linea:' || l.id,
        p_permitir_sobregiro => true);
      update public.venta_linea set presentacion_id = pres, kardex_transaccion_id = k where id = l.id;
      salidas := salidas + 1;
    end loop;
  end loop;

  foreach id_venta in array descontar || sin_descontar loop
    update public.venta set estado = 'COMPLETADA', completado_en = now() where id = id_venta;
    update public.almacen_documento_movil set estado = 'DESPACHADO', version = version + 1 where venta_id = id_venta;
    insert into public.venta_evento (venta_id, accion, motivo, usuario)
      values (id_venta, 'REGULARIZADA', motivo || case when id_venta = any(descontar) then ' · con salida de Kardex' else ' · sin salida de Kardex' end, 'Regularización');
  end loop;

  foreach id_venta in array anular loop
    perform public.anular_venta(id_venta, 'Regularización', null, motivo);
    update public.almacen_documento_movil set estado = 'ANULADO', version = version + 1 where venta_id = id_venta;
  end loop;

  if not aplicar then
    raise exception 'ENSAYO OK, nada guardado. Con salida: %, líneas descontadas: %. Sin salida: %. Anuladas: %.',
      cardinality(descontar), salidas, cardinality(sin_descontar), cardinality(anular);
  end if;
  raise notice 'Regularización aplicada. Con salida: %, sin salida: %, anuladas: %.', cardinality(descontar), cardinality(sin_descontar), cardinality(anular);
end
$reg$;
