-- Definición de crear_pedido vigente en Cation al actualizar Seller 7f78b4f.
-- Solo se carga en PGlite para verificar la RPC real sin tocar pedidos reales.
CREATE OR REPLACE FUNCTION public.crear_pedido(p_categoria categoria_pedido, p_referencia text, p_lineas jsonb, p_usuario text DEFAULT NULL::text, p_cliente_id bigint DEFAULT NULL::bigint, p_descuento_general numeric DEFAULT 0, p_cotizacion_origen_id bigint DEFAULT NULL::bigint, p_solicitante_id bigint DEFAULT NULL::bigint, p_condicion_pago condicion_pago DEFAULT NULL::condicion_pago, p_medio_pago metodo_pago DEFAULT NULL::metodo_pago)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  v_pedido_id bigint; v_linea jsonb; v_esp boolean; v_prod bigint;
  v_pres bigint; v_factor numeric; v_cant_pres numeric; v_cant numeric;
  v_desc_pct numeric; v_unit numeric; v_lista numeric; v_origen bigint;
  v_estado estado_linea; v_sub numeric; v_subtotal numeric := 0;
  v_tiene_precio boolean := false;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;

  insert into pedido (categoria, referencia, creado_por, cliente_id, cotizacion_origen_id,
                      solicitante_id, condicion_pago, medio_pago)
  values (p_categoria, p_referencia, p_usuario, p_cliente_id, p_cotizacion_origen_id,
          p_solicitante_id, p_condicion_pago, p_medio_pago)
  returning id into v_pedido_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_esp := coalesce((v_linea->>'es_personalizado')::boolean, false);
    v_desc_pct := coalesce((v_linea->>'descuento_pct')::numeric, 0);
    if v_desc_pct < 0 or v_desc_pct > 100 then
      raise exception 'descuento_pct fuera de rango (0..100)';
    end if;
    v_unit  := (v_linea->>'precio_unitario')::numeric;
    v_lista := coalesce((v_linea->>'precio_lista')::numeric, v_unit);
    v_pres  := (v_linea->>'presentacion_id')::bigint;

    if v_esp then
      if coalesce(btrim(v_linea->>'descripcion'),'') = '' then
        raise exception 'El ítem personalizado requiere descripcion';
      end if;
      v_prod := null; v_origen := null; v_estado := 'ESPECIAL'; v_pres := null;
      v_cant := (v_linea->>'cantidad_base')::numeric;
      v_cant_pres := v_cant;
    else
      v_prod := (v_linea->>'producto_id')::bigint;
      if v_prod is null then raise exception 'Cada línea de catálogo requiere producto_id'; end if;

      if v_pres is not null then
        select factor_unidad_base into v_factor
          from presentacion where id = v_pres and producto_id = v_prod;
        if v_factor is null then
          raise exception 'La presentación % no pertenece al producto %', v_pres, v_prod;
        end if;
        v_cant_pres := (v_linea->>'cantidad_presentacion')::numeric;
        if v_cant_pres is null or v_cant_pres <= 0 then
          raise exception 'cantidad_presentacion debe ser positiva';
        end if;
        v_cant := v_cant_pres * v_factor;
      else
        v_cant := (v_linea->>'cantidad_base')::numeric;
        v_cant_pres := v_cant;
      end if;

      v_origen := coalesce((v_linea->>'sucursal_origen_id')::bigint,
                           case when p_categoria = 'TIENDA' then 2 else 1 end);
      v_estado := 'POR_DESPACHAR';
    end if;

    if v_cant is null or v_cant <= 0 then raise exception 'cantidad debe ser positiva'; end if;

    v_sub := case when v_unit is not null
                  then round(v_unit * v_cant_pres * (1 - v_desc_pct/100), 2) else null end;
    if v_sub is not null then
      v_subtotal := v_subtotal + v_sub; v_tiene_precio := true;
    end if;

    insert into pedido_linea (
      pedido_id, producto_id, cantidad_base, estado, sucursal_origen_id,
      es_personalizado, descripcion, unidad_medida, nota, presentacion_id, cantidad_presentacion,
      precio_lista, precio_unitario, descuento_pct, subtotal
    ) values (
      v_pedido_id, v_prod, v_cant, v_estado, v_origen,
      v_esp, v_linea->>'descripcion', case when v_esp then coalesce(nullif(upper(btrim(v_linea->>'unidad_medida')), ''), 'UNIDAD') end, v_linea->>'nota', v_pres, v_cant_pres,
      v_lista, v_unit, v_desc_pct, v_sub
    );
  end loop;

  if v_tiene_precio then
    update pedido
       set subtotal = v_subtotal,
           descuento_general = coalesce(p_descuento_general, 0),
           total = v_subtotal - coalesce(p_descuento_general, 0)
     where id = v_pedido_id;
  end if;

  return v_pedido_id;
end;
$function$
