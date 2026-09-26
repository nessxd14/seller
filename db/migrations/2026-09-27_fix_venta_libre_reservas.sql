-- Fix: compuerta de reservas bloqueaba la venta libre en Tienda.
-- Síntoma: POST /rpc/registrar_venta 400 — "Producto N está reservado: 1 unidad(es)
-- comprometidas para otro pedido (vendible real: 0)" con reservado = 0 en Tienda (LIBRE).
-- Cambio único respecto a la versión viva (2026-09-27_caja_turno_cajero.sql): la
-- COMPUERTA 2.5 no bloquea cuando la sucursal es LIBRE y no hay reserva real.
-- Firma sin cambios -> CREATE OR REPLACE directo.

create or replace function public._registrar_venta_nucleo(p_lineas jsonb, p_pagos jsonb, p_sesion_caja_id bigint, p_cliente_id bigint, p_descuento_total numeric, p_usuario text, p_idempotencia text, p_forzar_reserva boolean, p_motivo_forzado text)
 returns jsonb
 language plpgsql
as $function$
declare
  v_venta_id bigint; v_header_ubic bigint; v_linea jsonb;
  v_prod bigint; v_cant numeric; v_cant_pres numeric; v_factor numeric;
  v_unit numeric; v_lista numeric; v_pres bigint; v_pres_base bigint;
  v_forzada bigint; v_st_forzada numeric; v_st_tienda numeric; v_st_almacen numeric;
  v_suc bigint; v_nombre_suc text; v_restante numeric; v_toma numeric;
  v_primer_kid bigint; v_kid bigint; v_ub record;
  v_sub numeric; v_subtotal numeric := 0; v_total numeric; v_pagado numeric; v_pago jsonb;
  v_previa jsonb;
  v_libre boolean; v_ubic_sobregiro bigint;
  v_ix int := 0;
  v_vendible numeric; v_reserva_motivo text; v_exceso numeric;
  v_reservado numeric; -- fix 2026-09-27: LIBRE sin reserva no se bloquea
  -- Brief Caja-1: numeración propia VTA-2026-NNNNN (A1) y recibido/estado de
  -- verificación por pago (A2/A3).
  v_numero text; v_anio int;
  v_metodo metodo_pago; v_recibido numeric; v_estado_verif text;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array no vacío';
  end if;

  if p_forzar_reserva and (p_motivo_forzado is null or btrim(p_motivo_forzado) = '') then
    raise exception 'El motivo es obligatorio para vender por encima de la reserva';
  end if;

  if p_idempotencia is not null then
    if btrim(p_idempotencia) = '' or length(p_idempotencia) > 200 then
      raise exception 'Clave de idempotencia inválida (vacía, en blanco, o mayor a 200 caracteres)';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('venta:' || p_idempotencia, 0));
    select jsonb_build_object('venta_id', v.id, 'numero', v.numero, 'subtotal', v.subtotal,
             'descuento_total', v.descuento_total, 'total', v.total, 'reintento', true)
      into v_previa
      from venta v
     where v.idempotencia_clave = p_idempotencia;
    if v_previa is not null then
      return v_previa;
    end if;
  end if;

  perform 1 from sesion_caja where id = p_sesion_caja_id and estado = 'ABIERTA';
  if not found then raise exception 'No hay una sesión de caja abierta (%).', p_sesion_caja_id; end if;

  select id into v_header_ubic from ubicacion where sucursal_id = 2 order by id limit 1;
  if v_header_ubic is null then select id into v_header_ubic from ubicacion order by id limit 1; end if;

  -- A1: numeración gap-free — se asigna en la MISMA transacción que la venta, así
  -- que un rollback más abajo (stock insuficiente, pago que no cuadra, etc.) también
  -- revierte el incremento del contador. Mismo patrón que abrir_venta (serie VTD).
  v_anio := extract(year from now() at time zone 'America/La_Paz')::int;
  v_numero := formato_numero('VTA', v_anio, siguiente_numero('VTA', v_anio));

  insert into venta (numero, cliente_id, ubicacion_id, estado, creado_por, sesion_caja_id, idempotencia_clave)
  values (v_numero, p_cliente_id, v_header_ubic, 'ABIERTA', p_usuario, p_sesion_caja_id, p_idempotencia)
  returning id into v_venta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_ix := v_ix + 1;

    v_prod  := (v_linea->>'producto_id')::bigint;
    v_unit  := (v_linea->>'precio_unitario')::numeric;
    v_lista := coalesce((v_linea->>'precio_lista')::numeric, v_unit);
    v_pres  := (v_linea->>'presentacion_id')::bigint;
    if v_prod is null or v_unit is null then
      raise exception 'Línea inválida (producto_id/precio_unitario)';
    end if;

    select id into v_pres_base from presentacion
     where producto_id = v_prod and es_base = true and coalesce(activo, true) = true limit 1;
    if v_pres_base is null then raise exception 'Producto % sin presentación base', v_prod; end if;

    if v_pres is not null then
      select factor_unidad_base into v_factor from presentacion
       where id = v_pres and producto_id = v_prod and coalesce(activo, true);
      if v_factor is null then
        raise exception 'La presentación % no pertenece al producto % (o está inactiva)', v_pres, v_prod;
      end if;
      v_cant_pres := (v_linea->>'cantidad_presentacion')::numeric;
      if v_cant_pres is null or v_cant_pres <= 0 then
        raise exception 'cantidad_presentacion debe ser positiva';
      end if;
      v_cant := v_cant_pres * v_factor;
    else
      v_pres := v_pres_base;
      v_cant := coalesce((v_linea->>'cantidad_base')::numeric, (v_linea->>'cantidad')::numeric);
      v_cant_pres := v_cant;
    end if;
    if v_cant is null or v_cant <= 0 then raise exception 'cantidad debe ser positiva'; end if;

    -- ── COMPUERTA 1: origen forzado por el POS ───────────────────────────────
    v_forzada := (v_linea->>'sucursal_origen_id')::bigint;
    if v_forzada is not null then
      v_libre := coalesce(permite_sobregiro_sucursal(v_prod, v_forzada), false);
      select coalesce(sum(sa.cantidad_base), 0) into v_st_forzada
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_forzada;
      if v_st_forzada < v_cant and not v_libre then
        select nombre into v_nombre_suc from sucursal where id = v_forzada;
        raise exception 'Stock insuficiente en % para el producto % (necesita %, hay %)',
          coalesce(v_nombre_suc, 'sucursal ' || v_forzada), v_prod, v_cant, v_st_forzada;
      end if;
      v_suc := v_forzada;
    else
      -- ── COMPUERTA 2: elección automática de sucursal ───────────────────────
      select coalesce(sum(sa.cantidad_base), 0) into v_st_tienda
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = 2;
      select coalesce(sum(sa.cantidad_base), 0) into v_st_almacen
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = 1;
      if v_st_tienda >= v_cant then v_suc := 2;
      elsif v_st_almacen >= v_cant then v_suc := 1;
      elsif coalesce(permite_sobregiro_sucursal(v_prod, 2), false) then
        v_suc := 2;
      else
        raise exception 'Stock insuficiente para producto % (necesita %, Tienda %, Almacén %)',
          v_prod, v_cant, v_st_tienda, v_st_almacen;
      end if;
      v_libre := coalesce(permite_sobregiro_sucursal(v_prod, v_suc), false);
    end if;

    -- ── COMPUERTA 2.5: protección de reservas ────────────────────────────────
    select vendible, reservado, motivo into v_vendible, v_reservado, v_reserva_motivo
      from saldo_vendible(array[v_prod], v_suc)
     limit 1;

    -- Fix 2026-09-27: en una sucursal LIBRE (Tienda en venta libre) sin stock contado,
    -- vendible = 0 aunque no haya NINGUNA reserva, y la compuerta bloqueaba toda venta
    -- con "está reservado" falso. Regla S10 intacta: si hay reserva real (reservado > 0),
    -- la reserva sigue ganando sobre LIBRE. Sin reserva, LIBRE vende.
    if v_cant > coalesce(v_vendible, 0)
       and not (coalesce(v_libre, false) and coalesce(v_reservado, 0) = 0) then
      v_exceso := v_cant - coalesce(v_vendible, 0);
      if not p_forzar_reserva then
        raise exception 'Producto % está reservado: % unidad(es) comprometidas para % en esta sucursal (vendible real: %)',
          v_prod, v_exceso, coalesce(v_reserva_motivo, 'otro pedido'), coalesce(v_vendible, 0)
          using errcode = 'check_violation';
      else
        insert into venta_sobre_reserva (venta_id, producto_id, cantidad_base, pedidos_afectados, motivo, usuario)
        values (v_venta_id, v_prod, v_exceso, v_reserva_motivo, p_motivo_forzado, p_usuario);
      end if;
    end if;

    -- ── COMPUERTA 3: reparto entre ubicaciones ───────────────────────────────
    v_restante := v_cant; v_primer_kid := null;
    for v_ub in
      select sa.ubicacion_id, sa.cantidad_base
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_suc and sa.cantidad_base > 0
       order by sa.cantidad_base desc
    loop
      exit when v_restante <= 0;
      v_toma := least(v_restante, v_ub.cantidad_base);
      v_kid := registrar_salida(v_pres_base, v_ub.ubicacion_id, v_toma,
        'Venta #' || v_venta_id, p_usuario, current_date,
        'venta:' || v_venta_id || ':l' || v_ix || ':p' || v_prod || ':u' || v_ub.ubicacion_id, false);
      if v_primer_kid is null then v_primer_kid := v_kid; end if;
      v_restante := v_restante - v_toma;
    end loop;

    if v_restante > 0 then
      if not v_libre then
        raise exception 'Stock insuficiente (carrera) producto %', v_prod;
      end if;
      select sa.ubicacion_id into v_ubic_sobregiro
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_suc
       order by sa.cantidad_base desc limit 1;
      if v_ubic_sobregiro is null then
        select id into v_ubic_sobregiro from ubicacion
         where sucursal_id = v_suc order by id limit 1;
      end if;
      if v_ubic_sobregiro is null then
        raise exception 'La sucursal % no tiene ninguna ubicación configurada', v_suc;
      end if;

      v_kid := registrar_salida(v_pres_base, v_ubic_sobregiro, v_restante,
        'Venta #' || v_venta_id, p_usuario, current_date,
        'venta:' || v_venta_id || ':l' || v_ix || ':p' || v_prod || ':sobregiro', true);
      if v_primer_kid is null then v_primer_kid := v_kid; end if;
      v_restante := 0;
    end if;

    v_sub := round(v_unit * v_cant_pres, 2);
    insert into venta_linea (venta_id, producto_id, presentacion_id, cantidad,
                             cantidad_presentacion, precio_lista, precio_unitario,
                             kardex_transaccion_id)
    values (v_venta_id, v_prod, v_pres, v_cant, v_cant_pres, v_lista, v_unit, v_primer_kid);
    v_subtotal := v_subtotal + v_sub;
  end loop;

  v_total := round(v_subtotal - coalesce(p_descuento_total, 0), 2);
  select coalesce(sum((p->>'monto')::numeric), 0) into v_pagado from jsonb_array_elements(p_pagos) p;
  if round(v_pagado, 2) <> v_total then
    raise exception 'El pago (%) no coincide con el total (%)', v_pagado, v_total;
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := (v_pago->>'metodo')::metodo_pago;

    -- A2: "recibido" (solo tiene sentido en EFECTIVO, pero se valida siempre que
    -- venga) nunca entra en la suma de p_pagos — el chequeo de arriba ya corrió.
    v_recibido := (v_pago->>'recibido')::numeric;
    if v_recibido is not null and v_recibido < (v_pago->>'monto')::numeric then
      raise exception 'El monto recibido (%) no puede ser menor al monto del pago (%)', v_recibido, (v_pago->>'monto')::numeric;
    end if;

    -- A3: QR/TRANSFERENCIA quedan PENDIENTE de verificación (Caja-2 los concilia);
    -- EFECTIVO (y cualquier otro método que llegue por acá) no aplica.
    v_estado_verif := case when v_metodo in ('QR', 'TRANSFERENCIA') then 'PENDIENTE' else 'NO_APLICA' end;

    insert into venta_pago (venta_id, metodo, monto, recibido, referencia, estado_verificacion)
    values (v_venta_id, v_metodo, (v_pago->>'monto')::numeric, v_recibido, v_pago->>'referencia', v_estado_verif);
    insert into movimiento_caja (sesion_caja_id, tipo, metodo, monto, venta_id, creado_por)
    values (p_sesion_caja_id, 'VENTA', v_metodo, (v_pago->>'monto')::numeric, v_venta_id, p_usuario);
  end loop;
  update venta set subtotal = v_subtotal, descuento_total = coalesce(p_descuento_total, 0),
                   total = v_total, estado = 'COMPLETADA', completado_en = now()
   where id = v_venta_id;
  return jsonb_build_object('venta_id', v_venta_id, 'numero', v_numero, 'subtotal', v_subtotal,
                            'descuento_total', coalesce(p_descuento_total, 0), 'total', v_total);
end;
$function$;

revoke all on function public._registrar_venta_nucleo(jsonb, jsonb, bigint, bigint, numeric, text, text, boolean, text) from anon, public;
grant execute on function public._registrar_venta_nucleo(jsonb, jsonb, bigint, bigint, numeric, text, text, boolean, text) to authenticated, service_role;
