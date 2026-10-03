-- El formulario tenía condiciones comerciales que no tenían una columna de destino.
ALTER TABLE public.cotizacion ADD COLUMN condiciones_comerciales text;
DROP FUNCTION public.crear_cotizacion(public.categoria_pedido,jsonb,bigint,text,numeric,date,text,text,public.condicion_pago,date,bigint,public.metodo_pago,text);
DROP FUNCTION public.actualizar_cotizacion(bigint,integer,public.categoria_pedido,jsonb,bigint,text,text,numeric,date,text,public.condicion_pago,date,text,bigint,public.metodo_pago);

CREATE OR REPLACE FUNCTION public.crear_cotizacion(p_categoria categoria_pedido, p_lineas jsonb, p_cliente_id bigint DEFAULT NULL::bigint, p_referencia text DEFAULT NULL::text, p_descuento_general numeric DEFAULT 0, p_vigencia_hasta date DEFAULT NULL::date, p_usuario text DEFAULT NULL::text, p_asunto text DEFAULT NULL::text, p_condicion_pago condicion_pago DEFAULT NULL::condicion_pago, p_fecha date DEFAULT NULL::date, p_solicitante_id bigint DEFAULT NULL::bigint, p_medio_pago metodo_pago DEFAULT NULL::metodo_pago, p_notas text DEFAULT NULL::text, p_condiciones_comerciales text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public
AS $function$
declare
  v_cot_id bigint; v_linea jsonb; v_esp boolean; v_prod bigint;
  v_pres bigint; v_factor numeric; v_cant_pres numeric; v_cant numeric;
  v_desc_pct numeric; v_unit numeric; v_lista numeric; v_origen bigint;
  v_sub numeric; v_subtotal numeric := 0;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;

  insert into cotizacion (categoria, referencia, cliente_id, descuento_general,
                          vigencia_hasta, creado_por, asunto, condicion_pago, fecha,
                          solicitante_id, medio_pago, notas, condiciones_comerciales)
  values (p_categoria, p_referencia, p_cliente_id, coalesce(p_descuento_general,0),
          p_vigencia_hasta, p_usuario, p_asunto, p_condicion_pago,
          coalesce(p_fecha, current_date), p_solicitante_id, p_medio_pago, p_notas, nullif(p_condiciones_comerciales, ''))
  returning id into v_cot_id;

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
      v_prod := null; v_origen := null; v_pres := null;
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
    end if;

    if v_cant is null or v_cant <= 0 then raise exception 'cantidad debe ser positiva'; end if;

    v_sub := case when v_unit is not null
                  then round(v_unit * v_cant_pres * (1 - v_desc_pct/100), 2) else null end;
    if v_sub is not null then v_subtotal := v_subtotal + v_sub; end if;

    insert into cotizacion_linea (
      cotizacion_id, producto_id, es_personalizado, descripcion, unidad_medida, nota,
      sucursal_origen_id, presentacion_id, cantidad_presentacion, cantidad_base,
      precio_lista, precio_unitario, descuento_pct, subtotal,
      precio_modificado, modificado_por, modificado_en
    ) values (
      v_cot_id, v_prod, v_esp, v_linea->>'descripcion', case when v_esp then coalesce(nullif(upper(btrim(v_linea->>'unidad_medida')), ''), 'UNIDAD') end, v_linea->>'nota',
      v_origen, v_pres, v_cant_pres, v_cant,
      v_lista, v_unit, v_desc_pct, v_sub,
      coalesce((v_linea->>'precio_modificado')::boolean, false),
      case when (v_linea->>'precio_modificado')::boolean then coalesce(v_linea->>'modificado_por', p_usuario) end,
      case when (v_linea->>'precio_modificado')::boolean then now() end
    );
  end loop;

  update cotizacion
     set subtotal = v_subtotal,
         total = v_subtotal - coalesce(p_descuento_general, 0)
   where id = v_cot_id;

  return v_cot_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.actualizar_cotizacion(p_cotizacion_id bigint, p_version_actual integer, p_categoria categoria_pedido, p_lineas jsonb, p_cliente_id bigint DEFAULT NULL::bigint, p_referencia text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_descuento_general numeric DEFAULT 0, p_vigencia_hasta date DEFAULT NULL::date, p_asunto text DEFAULT NULL::text, p_condicion_pago condicion_pago DEFAULT NULL::condicion_pago, p_fecha date DEFAULT NULL::date, p_usuario text DEFAULT NULL::text, p_solicitante_id bigint DEFAULT NULL::bigint, p_medio_pago metodo_pago DEFAULT NULL::metodo_pago, p_condiciones_comerciales text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path = public
AS $function$
declare
  v_linea jsonb; v_esp boolean; v_prod bigint;
  v_pres bigint; v_factor numeric; v_cant_pres numeric; v_cant numeric;
  v_desc_pct numeric; v_unit numeric; v_lista numeric; v_origen bigint;
  v_sub numeric; v_subtotal numeric := 0;
  v_estado_actual text;
  v_version_actual_db integer;
  v_solicitante_actual bigint;
  v_nombre_solicitante text;
  v_activo_solicitante boolean;
begin
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;

  select estado, version, solicitante_id into v_estado_actual, v_version_actual_db, v_solicitante_actual
  from cotizacion where id = p_cotizacion_id
  for update;

  if not found then
    raise exception 'Cotización % no existe', p_cotizacion_id;
  end if;
  if v_estado_actual <> 'BORRADOR' then
    raise exception 'Solo una cotización en borrador puede editarse';
  end if;
  if v_version_actual_db is distinct from p_version_actual then
    raise exception 'La cotización fue modificada por otra sesión';
  end if;

  -- Validar el par cliente/contacto antes de reemplazar las líneas.
  if p_solicitante_id is not null then
    select nombre, activo into v_nombre_solicitante, v_activo_solicitante
      from public.cliente_contacto
      where id = p_solicitante_id and cliente_id = p_cliente_id;
    if not found then
      raise exception 'El solicitante elegido no pertenece a este cliente. Selecciona un contacto del cliente actual.'
        using errcode = 'check_violation';
    end if;
    if not v_activo_solicitante and p_solicitante_id is distinct from v_solicitante_actual then
      raise exception 'El solicitante está desactivado. Elige un contacto activo.'
        using errcode = 'check_violation';
    end if;
  end if;

  delete from cotizacion_linea where cotizacion_id = p_cotizacion_id;

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
      v_prod := null; v_origen := null; v_pres := null;
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
    end if;

    if v_cant is null or v_cant <= 0 then raise exception 'cantidad debe ser positiva'; end if;

    v_sub := case when v_unit is not null
                  then round(v_unit * v_cant_pres * (1 - v_desc_pct/100), 2) else null end;
    if v_sub is not null then v_subtotal := v_subtotal + v_sub; end if;

    insert into cotizacion_linea (
      cotizacion_id, producto_id, es_personalizado, descripcion, unidad_medida, nota,
      sucursal_origen_id, presentacion_id, cantidad_presentacion, cantidad_base,
      precio_lista, precio_unitario, descuento_pct, subtotal,
      precio_modificado, modificado_por, modificado_en
    ) values (
      p_cotizacion_id, v_prod, v_esp, v_linea->>'descripcion', case when v_esp then coalesce(nullif(upper(btrim(v_linea->>'unidad_medida')), ''), 'UNIDAD') end, v_linea->>'nota',
      v_origen, v_pres, v_cant_pres, v_cant,
      v_lista, v_unit, v_desc_pct, v_sub,
      coalesce((v_linea->>'precio_modificado')::boolean, false),
      case when (v_linea->>'precio_modificado')::boolean then coalesce(v_linea->>'modificado_por', p_usuario) else null end,
      case when (v_linea->>'precio_modificado')::boolean then now() else null end
    );
  end loop;

  update cotizacion
     set cliente_id = p_cliente_id,
         categoria = p_categoria,
         referencia = p_referencia,
         notas = p_notas,
         -- NULL mantiene el campo para clientes anteriores; '' lo borra explícitamente.
         condiciones_comerciales = case when p_condiciones_comerciales is null then condiciones_comerciales else nullif(p_condiciones_comerciales, '') end,
         vigencia_hasta = p_vigencia_hasta,
         asunto = p_asunto,
         condicion_pago = p_condicion_pago,
         medio_pago = p_medio_pago,
         fecha = coalesce(p_fecha, fecha),
         solicitante_id = p_solicitante_id,
         -- Refrescar el nombre al guardar el borrador, o borrarlo al quitar el contacto.
         -- Un contacto histórico desactivado y sin cambios conserva su snapshot.
         solicitado_por = case when v_activo_solicitante = false then solicitado_por else v_nombre_solicitante end,
         subtotal = v_subtotal,
         descuento_general = coalesce(p_descuento_general, 0),
         total = v_subtotal - coalesce(p_descuento_general, 0),
         version = version + 1,
         actualizado_en = now()
   where id = p_cotizacion_id;

  return p_cotizacion_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.crear_cotizacion(public.categoria_pedido,jsonb,bigint,text,numeric,date,text,text,public.condicion_pago,date,bigint,public.metodo_pago,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.actualizar_cotizacion(bigint,integer,public.categoria_pedido,jsonb,bigint,text,text,numeric,date,text,public.condicion_pago,date,text,bigint,public.metodo_pago,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(public.categoria_pedido,jsonb,bigint,text,numeric,date,text,text,public.condicion_pago,date,bigint,public.metodo_pago,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.actualizar_cotizacion(bigint,integer,public.categoria_pedido,jsonb,bigint,text,text,numeric,date,text,public.condicion_pago,date,text,bigint,public.metodo_pago,text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
