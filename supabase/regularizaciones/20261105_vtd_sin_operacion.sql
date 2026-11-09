-- Regularización de las 27 VTD pagadas, sin salida de Kardex y sin operación (semana del 12 oct).
-- Decisión de Ness (2026-11-05): las 27 se entregaron.
-- Correr en el SQL Editor con la caja cerrada. Por defecto NO guarda nada: termina con una
-- excepción que muestra el resumen. Para guardar, cambiar aplicar a true y volver a correr.
--
-- Regla por línea, para no restar dos veces:
--   - Sin AJUSTE del producto después de la venta: registra la salida en Kardex.
--   - Con AJUSTE posterior: no toca Kardex, porque el ajuste ya fijó el stock.
-- No cuentan los ajustes del traslado a POR UBICAR, que no reflejan un conteo.

do $reg$
declare
  aplicar   constant boolean  := false;
  entregadas constant bigint[] := '{2180,2182,2185,2186,2187,2188,2196,2204,2212,2219,2221,2227,2234,2271,2281,2295,2300,2304,2306,2307,2315,2318,2321,2323,2348,2396,2423}';
  motivo    constant text     := 'Regularización VTD sin operación: entregada según Ness, 2026-11-05';
  v public.venta%rowtype; l public.venta_linea%rowtype; k bigint; id_venta bigint; salidas int := 0; omitidas int := 0; n_v int; ajustada boolean;
begin
  foreach id_venta in array entregadas loop
    select * into v from public.venta where id = id_venta for update;
    if not found or v.numero not like 'VTD-%' or v.estado::text <> 'ABIERTA'
       or exists (select 1 from public.caja_operacion_vtd d where d.venta_id = id_venta)
       or not exists (select 1 from public.venta_pago p where p.venta_id = id_venta)
       or exists (select 1 from public.venta_linea x where x.venta_id = id_venta and (x.kardex_transaccion_id is not null or x.presentacion_id is null)) then
      raise exception 'La venta % no es una VTD pagada, abierta, sin operación, sin Kardex y con presentación.', id_venta;
    end if;

    n_v := 0;
    for l in select * from public.venta_linea where venta_id = id_venta order by id loop
      ajustada := exists (select 1 from public.kardex_transacciones t
                           where t.producto_id = l.producto_id and t.creado_en > v.creado_en
                             and t.tipo_movimiento::text = 'AJUSTE' and coalesce(t.referencia, '') not ilike '%POR UBICAR%');
      if ajustada then
        omitidas := omitidas + 1;
      else
        k := public.registrar_salida(
          p_presentacion_id => l.presentacion_id,
          p_ubicacion_id => public.resolver_ubicacion_salida(l.producto_id, v.ubicacion_id),
          p_cantidad_pres => coalesce(l.cantidad_presentacion, l.cantidad),
          p_referencia => 'Venta #' || id_venta,
          p_usuario => 'Regularización',
          p_fecha => (v.creado_en at time zone 'America/La_Paz')::date,
          p_idempotencia => 'venta_linea:' || l.id,
          p_permitir_sobregiro => true);
        update public.venta_linea set kardex_transaccion_id = k where id = l.id;
        salidas := salidas + 1; n_v := n_v + 1;
      end if;
    end loop;

    update public.venta set estado = 'COMPLETADA', completado_en = now() where id = id_venta;
    update public.almacen_documento_movil set estado = 'DESPACHADO', version = version + 1 where venta_id = id_venta;
    insert into public.venta_evento (venta_id, accion, motivo, usuario)
      values (id_venta, 'REGULARIZADA', motivo || ' · líneas con salida: ' || n_v, 'Regularización');
  end loop;

  if not aplicar then
    raise exception 'ENSAYO OK, nada guardado. Ventas: %. Líneas con salida: %. Líneas omitidas por ajuste posterior: %.', cardinality(entregadas), salidas, omitidas;
  end if;
  raise notice 'Regularización aplicada. Ventas: %. Líneas con salida: %. Omitidas: %.', cardinality(entregadas), salidas, omitidas;
end
$reg$;
