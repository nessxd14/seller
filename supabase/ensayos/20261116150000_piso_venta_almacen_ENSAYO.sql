-- Ensayo: aplica la migración, prueba y deshace todo (rollback).
begin;
-- 2026-11-16 · Piso: venta de almacén (VTD) armada por el reponedor / vendedor
--
-- El reponedor arma en el celular una venta que sale del almacén y la manda a caja.
-- Caja la cobra en el momento como venta directa (ticket VTD) y sigue el camino de
-- siempre: se envía a Almacén Central y almacén entrega con el ticket.
--
-- Cambios:
--   1. pedido_vendedor.canal ('TIENDA' | 'ALMACEN'), default 'TIENDA'.
--   2. guardar_pedido_vendedor: nuevo parámetro p_canal (null = deja el que tenía;
--      'TIENDA' si es nuevo). En ALMACEN: sin productos fuera de catálogo y con la
--      referencia del cliente (p_nota) obligatoria para enviar. Misma regla de tope.
--      Se reemplaza la firma de 4 parámetros por la de 5: las llamadas con nombre
--      que no mandan p_canal siguen funcionando.
--   3. _pedido_vendedor_json y pedidos_vendedor_cola devuelven "canal";
--      _pedido_vendedor_json además "venta_estado" y "entregado" (VTD completada).
--   4. cobrar_pedido_vendedor rechaza pedidos de canal ALMACEN.
--   5. Nueva cobrar_pedido_vendedor_vtd: mismas reglas de líneas que el cobro de
--      tienda, pago obligatorio en el momento, abre la VTD con abrir_venta en la
--      misma transacción y deja el pedido COBRADO a nombre del vendedor.
--   6. mi_cuenta_vendedor: "canal" por pedido; una venta ANULADA ya no suma a la parte.
--
-- Se ensaya con supabase/ensayos/20261116150000_piso_venta_almacen_ENSAYO.sql.
-- La aplica Ness.


-- 1. canal ------------------------------------------------------------------------
alter table public.pedido_vendedor
  add column if not exists canal text not null default 'TIENDA';
alter table public.pedido_vendedor
  drop constraint if exists pedido_vendedor_canal_chk;
alter table public.pedido_vendedor
  add constraint pedido_vendedor_canal_chk check (canal in ('TIENDA', 'ALMACEN'));

-- 2. guardar_pedido_vendedor (+ p_canal) -------------------------------------------
drop function if exists public.guardar_pedido_vendedor(text, jsonb, boolean, text);

create function public.guardar_pedido_vendedor(p_clave text, p_lineas jsonb, p_enviar boolean default false,
                                               p_nota text default null::text, p_canal text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  c_tope constant numeric := 0.10;  -- descuento máximo del vendedor / reponedor por línea
  v_uid  uuid := auth.uid();
  v_rol  text := app_rol_actual();
  v_hoy  date := (now() at time zone 'America/La_Paz')::date;
  v_ped  pedido_vendedor%rowtype;
  v_l    jsonb;
  v_ix   int := 0;
  v_prod producto%rowtype;
  v_pres presentacion%rowtype;
  v_cant numeric; v_precio numeric; v_lista numeric; v_min numeric;
  v_desc text;
  v_total numeric := 0;
  v_sin_precio int := 0;
  v_canal text := upper(nullif(btrim(p_canal), ''));
begin
  -- [2026-11-11] + 'reponedor': vende en tienda desde el celular, caja cobra.
  if v_rol is null or v_rol not in ('vendedor', 'reponedor', 'cajero', 'gerente', 'admin') then
    raise exception 'No autorizado para levantar pedidos' using errcode = '42501';
  end if;
  if p_clave is null or btrim(p_clave) = '' or length(p_clave) > 100 then
    raise exception 'Clave del pedido inválida';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'p_lineas debe ser un array';
  end if;
  if jsonb_array_length(p_lineas) > 200 then
    raise exception 'Un pedido admite hasta 200 líneas';
  end if;
  if v_canal is not null and v_canal not in ('TIENDA', 'ALMACEN') then
    raise exception 'Canal inválido: %', p_canal;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pdv:' || v_uid::text || ':' || p_clave, 0));
  select * into v_ped from pedido_vendedor
   where vendedor_id = v_uid and clave_cliente = p_clave
   for update;

  if found then
    -- Reintento de un envío que ya entró (se cortó la red antes de la respuesta).
    if p_enviar and v_ped.estado in ('ENVIADO', 'EN_CAJA', 'COBRADO') then
      return _pedido_vendedor_json(v_ped.id) || jsonb_build_object('reintento', true);
    end if;
    if v_ped.estado <> 'ARMANDO' then
      raise exception 'El pedido % ya está % y no se puede editar', v_ped.numero_dia,
        case v_ped.estado when 'ENVIADO' then 'enviado a caja (retíralo para cambiarlo)'
                          when 'EN_CAJA' then 'en caja'
                          when 'COBRADO' then 'cobrado'
                          else 'anulado' end;
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('pdv_dia:' || v_hoy::text, 0));
    insert into pedido_vendedor (fecha, numero_dia, vendedor_id, clave_cliente)
    values (v_hoy,
            (select coalesce(max(numero_dia), 0) + 1 from pedido_vendedor where fecha = v_hoy),
            v_uid, p_clave)
    returning * into v_ped;
  end if;

  -- [2026-11-16] null = se queda con el canal que tenía (un cliente viejo no lo cambia).
  v_canal := coalesce(v_canal, v_ped.canal, 'TIENDA');

  delete from pedido_vendedor_linea where pedido_id = v_ped.id;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_ix := v_ix + 1;
    v_cant := (v_l ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Línea %: la cantidad debe ser mayor a cero', v_ix;
    end if;
    v_precio := (v_l ->> 'precio_unitario')::numeric;
    if v_precio < 0 then
      raise exception 'Línea %: el precio no puede ser negativo', v_ix;
    end if;

    if coalesce((v_l ->> 'es_personalizado')::boolean, false) then
      if v_canal = 'ALMACEN' then
        raise exception 'Línea %: un producto fuera de catálogo solo se vende de tienda', v_ix;
      end if;
      v_desc := nullif(btrim(v_l ->> 'descripcion'), '');
      if v_desc is null then
        raise exception 'Línea %: falta la descripción del producto', v_ix;
      end if;
      insert into pedido_vendedor_linea (pedido_id, orden, es_personalizado, descripcion, unidad_medida,
                                         cantidad, factor, precio_unitario)
      values (v_ped.id, v_ix, true, left(v_desc, 200),
              left(coalesce(nullif(upper(btrim(v_l ->> 'unidad_medida')), ''), 'UNIDAD'), 30),
              v_cant, 1, v_precio);
    else
      select * into v_prod from producto where id = (v_l ->> 'producto_id')::bigint and activo;
      if not found then
        raise exception 'Línea %: el producto % no existe o está inactivo', v_ix, v_l ->> 'producto_id';
      end if;
      if nullif(v_l ->> 'presentacion_id', '') is null then
        select * into v_pres from presentacion
         where producto_id = v_prod.id and es_base and activo limit 1;
      else
        select * into v_pres from presentacion
         where id = (v_l ->> 'presentacion_id')::bigint and producto_id = v_prod.id and activo;
      end if;
      if not found then
        raise exception '%: la presentación no existe o no es de este producto', v_prod.nombre;
      end if;

      v_lista := precio_presentacion(v_pres.id, 'retail');  -- [2026-10-19] precio propio o unidad × factor
      -- El tope solo tiene sentido contra un precio real de catálogo: la unidad.
      v_min := case when v_lista is not null and v_pres.es_base
                    then round(v_lista * (1 - c_tope), 2) end;
      v_precio := coalesce(v_precio, v_lista);

      if v_min is not null and v_precio < v_min and v_rol not in ('gerente', 'admin') then
        raise exception '%: Bs % está por debajo del mínimo de Bs % (lista Bs %, máximo % %% menos)',
          v_prod.nombre, v_precio, v_min, v_lista, round(c_tope * 100)
          using errcode = 'check_violation';
      end if;

      insert into pedido_vendedor_linea (pedido_id, orden, producto_id, presentacion_id, cantidad, factor,
                                         precio_lista, precio_minimo, precio_unitario)
      values (v_ped.id, v_ix, v_prod.id, v_pres.id, v_cant, v_pres.factor_unidad_base,
              v_lista, v_min, v_precio);
    end if;

    if v_precio is null or v_precio <= 0 then v_sin_precio := v_sin_precio + 1; end if;
    v_total := v_total + round(coalesce(v_precio, 0) * v_cant, 2);
  end loop;

  if p_enviar then
    if v_ix = 0 then
      raise exception 'El pedido está vacío';
    end if;
    if v_sin_precio > 0 then
      raise exception 'Hay % línea(s) sin precio: ponles un precio antes de enviar a caja', v_sin_precio;
    end if;
    if v_canal = 'ALMACEN' and nullif(btrim(p_nota), '') is null then
      raise exception 'Escribe quién es el cliente: almacén lo necesita para entregar';
    end if;
  end if;

  update pedido_vendedor
     set total = v_total,
         nota = nullif(btrim(p_nota), ''),
         canal = v_canal,
         actualizado_en = now(),
         estado = case when p_enviar then 'ENVIADO' else 'ARMANDO' end,
         enviado_en = case when p_enviar then now() end
   where id = v_ped.id;

  return _pedido_vendedor_json(v_ped.id) || jsonb_build_object('reintento', false);
end;
$function$;

revoke all on function public.guardar_pedido_vendedor(text, jsonb, boolean, text, text) from anon, public;
grant execute on function public.guardar_pedido_vendedor(text, jsonb, boolean, text, text) to authenticated, service_role;

-- 3a. _pedido_vendedor_json (+ canal, venta_estado, entregado) ----------------------
create or replace function public._pedido_vendedor_json(p_id bigint)
 returns jsonb
 language sql
 stable
 set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'pedido_id', p.id,
    'codigo', 'PDV-' || p.id,
    'numero_dia', p.numero_dia,
    'fecha', p.fecha,
    'estado', p.estado,
    'canal', p.canal,
    'vendedor_id', p.vendedor_id,
    'vendedor', v.nombre,
    'nota', p.nota,
    'total', p.total,
    'creado_en', p.creado_en,
    'enviado_en', p.enviado_en,
    'tomado_por', t.nombre,
    'tomado_en', p.tomado_en,
    'sesion_caja_id', p.sesion_caja_id,
    'venta_id', p.venta_id,
    'venta_numero', ve.numero,
    'venta_estado', ve.estado,
    'entregado', case when p.canal = 'ALMACEN' and p.venta_id is not null then ve.estado = 'COMPLETADA' end,
    'entregado_en', case when p.canal = 'ALMACEN' and ve.estado = 'COMPLETADA' then ve.completado_en end,
    'cobrado_en', p.cobrado_en,
    'anulado_origen', p.anulado_origen,
    'anulado_motivo', p.anulado_motivo,
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'linea_id', l.id,
               'orden', l.orden,
               'producto_id', l.producto_id,
               'nombre', coalesce(pr.nombre, l.descripcion),
               'sku', pr.sku_interno,
               'presentacion_id', l.presentacion_id,
               'presentacion', ps.nombre,
               'es_base', coalesce(ps.es_base, true),
               'factor', l.factor,
               'es_personalizado', l.es_personalizado,
               'unidad_medida', l.unidad_medida,
               'cantidad', l.cantidad,
               'precio_lista', l.precio_lista,
               'precio_minimo', l.precio_minimo,
               'precio_unitario', l.precio_unitario,
               'subtotal', round(coalesce(l.precio_unitario, 0) * l.cantidad, 2),
               'resultado', l.resultado,
               'cantidad_final', l.cantidad_final,
               'precio_final', l.precio_final,
               'motivo_caja', l.motivo_caja) order by l.orden)
        from pedido_vendedor_linea l
        left join producto pr on pr.id = l.producto_id
        left join presentacion ps on ps.id = l.presentacion_id
       where l.pedido_id = p.id), '[]'::jsonb))
  from pedido_vendedor p
  join perfil v on v.id = p.vendedor_id
  left join perfil t on t.id = p.tomado_por
  left join venta ve on ve.id = p.venta_id
  where p.id = p_id;
$function$;

-- 3b. pedidos_vendedor_cola (+ canal) ------------------------------------------------
create or replace function public.pedidos_vendedor_cola()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rol text := app_rol_actual();
begin
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado para ver la cola de caja' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pedido_id', p.id,
             'codigo', 'PDV-' || p.id,
             'numero_dia', p.numero_dia,
             'estado', p.estado,
             'canal', p.canal,
             'vendedor', v.nombre,
             'nota', p.nota,
             'enviado_en', p.enviado_en,
             'total', p.total,
             'lineas', (select count(*) from pedido_vendedor_linea l where l.pedido_id = p.id),
             'tomado_por', t.nombre,
             'sesion_caja_id', p.sesion_caja_id) order by p.enviado_en)
      from pedido_vendedor p
      join perfil v on v.id = p.vendedor_id
      left join perfil t on t.id = p.tomado_por
     where p.estado in ('ENVIADO', 'EN_CAJA')), '[]'::jsonb);
end;
$function$;

-- 4. cobrar_pedido_vendedor: rechaza canal ALMACEN ------------------------------------
-- Se agrega un control al principio sin reescribir la función (10 kB): se toma su
-- definición actual, se inserta el bloque antes del candado de idempotencia y se
-- ejecuta. Si el texto de referencia no está exactamente una vez, la migración falla.
do $m$
declare
  v_def    text := pg_get_functiondef('public.cobrar_pedido_vendedor(bigint[],jsonb,jsonb,bigint,text,jsonb,numeric,bigint,text)'::regprocedure);
  v_ancla  text := 'perform pg_advisory_xact_lock(hashtextextended(''cobro_pdv:'' || p_idempotencia, 0));';
  v_bloque text := '-- [2026-11-16] La venta de almacén se cobra con cobrar_pedido_vendedor_vtd.' || chr(10) ||
                   '  if exists (select 1 from pedido_vendedor where id = any(p_pedido_ids) and canal = ''ALMACEN'') then' || chr(10) ||
                   '    raise exception ''Es una venta de almacén: cóbrala como venta directa'' using errcode = ''check_violation'';' || chr(10) ||
                   '  end if;' || chr(10) || '  ';
begin
  if position('canal = ''ALMACEN''' in v_def) > 0 then
    return;  -- ya aplicada
  end if;
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'cobrar_pedido_vendedor cambió: no se encontró una sola vez el texto de referencia';
  end if;
  execute replace(v_def, v_ancla, v_bloque || v_ancla);
end
$m$;

-- 5. cobrar_pedido_vendedor_vtd (nueva) -----------------------------------------------
create or replace function public.cobrar_pedido_vendedor_vtd(
  p_pedido_id bigint, p_lineas jsonb, p_pagos jsonb, p_sesion_caja_id bigint, p_ubicacion_id bigint,
  p_idempotencia text, p_quitadas jsonb default '[]'::jsonb, p_descuento_total numeric default 0,
  p_cliente_id bigint default null::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  c_tope constant numeric := 0.10;
  v_uid  uuid := auth.uid();
  v_rol  text := app_rol_actual();
  v_usuario text;
  v_ses  sesion_caja%rowtype;
  v_ped  pedido_vendedor%rowtype;
  v_n    int;
  v_l    jsonb;
  v_ix   int := 0;
  v_plid bigint;
  v_pl   pedido_vendedor_linea%rowtype;
  v_vistas bigint[] := '{}';
  v_prod producto%rowtype;
  v_pres presentacion%rowtype;
  v_unit numeric; v_cant numeric; v_lista numeric; v_min numeric; v_motivo text;
  v_out  jsonb := '[]'::jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_q    jsonb;
  v_res  jsonb;
  v_venta venta%rowtype;
begin
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado para cobrar' using errcode = '42501';
  end if;
  if p_idempotencia is null or btrim(p_idempotencia) = '' or length(p_idempotencia) > 180 then
    raise exception 'Clave de idempotencia obligatoria (máx. 180 caracteres)';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;
  if p_quitadas is null or jsonb_typeof(p_quitadas) <> 'array' then
    raise exception 'p_quitadas debe ser un array';
  end if;
  -- La venta de almacén del reponedor se paga en el momento: sin pago posterior.
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta de almacén se cobra en el momento: falta el pago';
  end if;
  if p_ubicacion_id is null or not exists (select 1 from ubicacion where id = p_ubicacion_id and activo) then
    raise exception 'Elige de qué ubicación del almacén sale la mercadería';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cobro_pdv:' || p_idempotencia, 0));

  -- Reintento: la VTD ya existe con esta clave y cerró este mismo pedido.
  select * into v_venta from venta where idempotencia_clave = p_idempotencia;
  if found then
    if exists (select 1 from pedido_vendedor where id = p_pedido_id and estado = 'COBRADO' and venta_id = v_venta.id) then
      return jsonb_build_object('reintento', true, 'venta_id', v_venta.id, 'numero', v_venta.numero,
                                'estado', v_venta.estado, 'subtotal', v_venta.subtotal,
                                'descuento_total', v_venta.descuento_total, 'total', v_venta.total,
                                'pedido_id', p_pedido_id, 'vendedor_id', v_venta.vendedor_id);
    end if;
    raise exception 'La clave de idempotencia ya se usó en otra venta';
  end if;

  select * into v_ses from sesion_caja where id = p_sesion_caja_id;
  if not found or v_ses.estado <> 'ABIERTA' then
    raise exception 'No hay una sesión de caja abierta (%).', p_sesion_caja_id;
  end if;
  if v_rol = 'cajero' and v_ses.cajero_id is distinct from v_uid then
    raise exception 'Solo puedes cobrar en tu propio turno';
  end if;
  select coalesce(email, 'sistema') into v_usuario from perfil where id = v_uid;

  select * into v_ped from pedido_vendedor where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_ped.canal <> 'ALMACEN' then
    raise exception 'El pedido % es de tienda: cóbralo en el carrito normal', v_ped.numero_dia;
  end if;
  if v_ped.estado <> 'EN_CAJA' or v_ped.sesion_caja_id is distinct from p_sesion_caja_id then
    raise exception 'El pedido % no está tomado en esta caja', v_ped.numero_dia;
  end if;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_ix := v_ix + 1;
    v_plid := nullif(v_l ->> 'pedido_linea_id', '')::bigint;
    v_unit := (v_l ->> 'precio_unitario')::numeric;
    v_lista := null; v_min := null; v_motivo := null;

    if coalesce((v_l ->> 'es_personalizado')::boolean, false) then
      raise exception 'Línea %: un producto fuera de catálogo no puede salir del almacén', v_ix;
    end if;
    if v_unit is null or v_unit < 0 then
      raise exception 'Línea %: falta el precio', v_ix;
    end if;

    if v_plid is not null then
      select * into v_pl from pedido_vendedor_linea where id = v_plid and pedido_id = v_ped.id;
      if not found then
        raise exception 'La línea % no pertenece al pedido que se está cobrando', v_plid;
      end if;
      if v_plid = any(v_vistas) then
        raise exception 'La línea % del pedido viene repetida', v_plid;
      end if;
      v_vistas := v_vistas || v_plid;
      if not coalesce((v_l ->> 'verificada')::boolean, false) then
        raise exception 'Falta verificar la línea % del pedido antes de cobrar', v_pl.orden;
      end if;
      if nullif(v_l ->> 'producto_id', '')::bigint is distinct from v_pl.producto_id then
        raise exception 'La línea % del pedido no puede cambiar de producto: quítala y agrega el producto nuevo', v_pl.orden;
      end if;
    end if;

    select * into v_prod from producto where id = (v_l ->> 'producto_id')::bigint;
    if not found then
      raise exception 'Línea %: el producto % no existe', v_ix, v_l ->> 'producto_id';
    end if;
    if nullif(v_l ->> 'presentacion_id', '') is null then
      select * into v_pres from presentacion where producto_id = v_prod.id and es_base and activo limit 1;
      v_cant := coalesce((v_l ->> 'cantidad_base')::numeric, (v_l ->> 'cantidad')::numeric);
    else
      select * into v_pres from presentacion
       where id = (v_l ->> 'presentacion_id')::bigint and producto_id = v_prod.id and activo;
      v_cant := (v_l ->> 'cantidad_presentacion')::numeric;
    end if;
    if not found then
      raise exception '%: la presentación no existe o no es de este producto', v_prod.nombre;
    end if;
    if v_cant is null or v_cant <= 0 then
      raise exception '%: la cantidad debe ser mayor a cero', v_prod.nombre;
    end if;

    v_lista := precio_presentacion(v_pres.id, 'retail');
    v_min := case when v_lista is not null and v_pres.es_base then round(v_lista * (1 - c_tope), 2) end;
    if v_min is not null and v_unit < v_min then
      v_motivo := nullif(btrim(v_l ->> 'motivo_descuento'), '');
      if v_motivo is null then
        raise exception '%: Bs % está más de % %% por debajo de la lista (Bs %). Falta el motivo del descuento',
          v_prod.nombre, v_unit, round(c_tope * 100), v_lista
          using errcode = 'check_violation';
      end if;
    end if;

    -- Lo que abrir_venta entiende; la lista la pone el servidor.
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'producto_id', v_prod.id,
               'presentacion_id', case when nullif(v_l ->> 'presentacion_id', '') is null then null else v_pres.id end,
               'cantidad_presentacion', case when nullif(v_l ->> 'presentacion_id', '') is null then null else v_cant end,
               'cantidad_base', case when nullif(v_l ->> 'presentacion_id', '') is null then v_cant end,
               'precio_unitario', v_unit,
               'precio_lista', coalesce(v_lista, v_unit))));
    v_meta := v_meta || jsonb_build_array(jsonb_build_object(
                'ix', v_ix, 'plid', v_plid, 'cant', v_cant, 'unit', v_unit, 'motivo', left(v_motivo, 200)));
  end loop;

  for v_q in select * from jsonb_array_elements(p_quitadas) loop
    v_plid := nullif(v_q ->> 'pedido_linea_id', '')::bigint;
    perform 1 from pedido_vendedor_linea where id = v_plid and pedido_id = v_ped.id;
    if not found then
      raise exception 'La línea quitada % no pertenece al pedido que se está cobrando', v_q ->> 'pedido_linea_id';
    end if;
    if v_plid = any(v_vistas) then
      raise exception 'La línea % del pedido figura cobrada y quitada a la vez', v_plid;
    end if;
    v_vistas := v_vistas || v_plid;
  end loop;

  select count(*) into v_n from pedido_vendedor_linea where pedido_id = v_ped.id;
  if v_n <> coalesce(array_length(v_vistas, 1), 0) then
    raise exception 'Faltan % línea(s) del pedido por verificar o quitar', v_n - coalesce(array_length(v_vistas, 1), 0);
  end if;

  -- Abre la VTD (pagada) con el mismo camino que el carrito de venta directa.
  v_res := abrir_venta(v_out, p_ubicacion_id, p_sesion_caja_id, p_pagos, p_cliente_id,
                       coalesce(p_descuento_total, 0), v_usuario, p_idempotencia);
  select * into v_venta from venta where id = (v_res ->> 'venta_id')::bigint;

  select count(*) into v_n from venta_linea where venta_id = v_venta.id;
  if v_n <> jsonb_array_length(v_out) then
    raise exception 'La venta quedó con % líneas y se enviaron %', v_n, jsonb_array_length(v_out);
  end if;

  with vl as (
    select id, row_number() over (order by id) as rn from venta_linea where venta_id = v_venta.id
  ), m as (
    select * from jsonb_to_recordset(v_meta) as x(ix int, plid bigint, cant numeric, unit numeric, motivo text)
  )
  update pedido_vendedor_linea l
     set resultado = 'COBRADA', venta_linea_id = vl.id, cantidad_final = m.cant, precio_final = m.unit
    from m join vl on vl.rn = m.ix
   where m.plid is not null and l.id = m.plid;

  insert into venta_evento (venta_id, linea_id, accion, motivo, usuario)
  select v_venta.id, vl.id, 'DESCUENTO_SOBRE_TOPE', m.motivo, v_usuario
    from jsonb_to_recordset(v_meta) as m(ix int, motivo text)
    join (select id, row_number() over (order by id) as rn from venta_linea where venta_id = v_venta.id) vl
      on vl.rn = m.ix
   where m.motivo is not null;

  update pedido_vendedor_linea l
     set resultado = 'QUITADA', motivo_caja = left(nullif(btrim(q.motivo), ''), 200)
    from jsonb_to_recordset(p_quitadas) as q(pedido_linea_id bigint, motivo text)
   where l.id = q.pedido_linea_id;

  update pedido_vendedor
     set estado = 'COBRADO', venta_id = v_venta.id, cobrado_en = now(), actualizado_en = now()
   where id = v_ped.id;

  update venta set vendedor_id = v_ped.vendedor_id where id = v_venta.id;

  insert into venta_evento (venta_id, accion, motivo, usuario)
  values (v_venta.id, 'PEDIDO_VENDEDOR', 'Venta de almacén del pedido PDV-' || v_ped.id, v_usuario);

  return v_res || jsonb_build_object('reintento', false, 'pedido_id', v_ped.id, 'vendedor_id', v_ped.vendedor_id);
end;
$function$;

revoke all on function public.cobrar_pedido_vendedor_vtd(bigint, jsonb, jsonb, bigint, bigint, text, jsonb, numeric, bigint) from anon, public;
grant execute on function public.cobrar_pedido_vendedor_vtd(bigint, jsonb, jsonb, bigint, bigint, text, jsonb, numeric, bigint) to authenticated, service_role;

-- 6. mi_cuenta_vendedor: + canal; una venta anulada no suma ---------------------------
-- Mismo método que en el punto 4: tres reemplazos sobre la definición actual.
do $m$
declare
  v_def text := pg_get_functiondef('public.mi_cuenta_vendedor(date,date,uuid)'::regprocedure);
  v_r   text[][] := array[
    array['p.anulado_origen, p.anulado_motivo, ve.total as total_venta,',
          'p.anulado_origen, p.anulado_motivo, ve.total as total_venta, p.canal, ve.estado as venta_estado,'],
    array['''parte'', coalesce(sum(parte) filter (where estado = ''COBRADO''), 0),',
          '''parte'', coalesce(sum(parte) filter (where estado = ''COBRADO'' and venta_estado is distinct from ''ANULADA''), 0),'],
    array['''pedido_id'', id, ''numero_dia'', numero_dia, ''fecha'', fecha, ''estado'', estado,',
          '''pedido_id'', id, ''numero_dia'', numero_dia, ''fecha'', fecha, ''estado'', estado, ''canal'', canal, ''venta_anulada'', venta_estado = ''ANULADA'','],
    array['''parte'', case when estado = ''COBRADO'' then parte end,',
          '''parte'', case when estado = ''COBRADO'' and venta_estado is distinct from ''ANULADA'' then parte end,']
  ];
  i int;
begin
  if position('venta_estado' in v_def) > 0 then
    return;  -- ya aplicada
  end if;
  for i in 1 .. array_length(v_r, 1) loop
    if (length(v_def) - length(replace(v_def, v_r[i][1], ''))) / length(v_r[i][1]) <> 1 then
      raise exception 'mi_cuenta_vendedor cambió: el texto de referencia % no está una sola vez', i;
    end if;
    v_def := replace(v_def, v_r[i][1], v_r[i][2]);
  end loop;
  execute v_def;
end
$m$;


-- ===== Pruebas (todo se deshace) =====
do $t$
declare
  v_josias uuid := (select id from perfil where rol = 'reponedor' and activo order by nombre limit 1);
  v_ses    sesion_caja%rowtype;
  v_prod bigint; v_lista numeric; v_ubic bigint;
  v_r jsonb; v_ped bigint; v_lin bigint; v_total numeric;
  e1 text; e2 text; e3 text; e4 text; e5 text;
  v_tienda jsonb; v_cobro jsonb; v_cuenta jsonb; v_ven venta%rowtype;
begin
  select * into v_ses from sesion_caja where estado = 'ABIERTA' order by id desc limit 1;
  if not found then raise exception 'ENSAYO: no hay sesión de caja abierta para probar'; end if;
  select p.id, precio_presentacion(pr.id, 'retail') into v_prod, v_lista
    from producto p join presentacion pr on pr.producto_id = p.id and pr.es_base and pr.activo
   where p.activo and precio_presentacion(pr.id, 'retail') > 5 order by p.id limit 1;
  select id into v_ubic from ubicacion where sucursal_id = 1 and activo and not es_recepcion order by id limit 1;

  -- Como reponedor
  perform set_config('request.jwt.claim.sub', v_josias::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_josias, 'role', 'authenticated')::text, true);

  begin
    perform guardar_pedido_vendedor('ensayo-vtd-1', jsonb_build_array(jsonb_build_object('es_personalizado', true, 'descripcion', 'Algo', 'cantidad', 1, 'precio_unitario', 10)), false, null, 'ALMACEN');
    e1 := 'NO bloqueó (mal)';
  exception when others then e1 := 'bloqueado OK';
  end;
  begin
    perform guardar_pedido_vendedor('ensayo-vtd-2', jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 2)), true, null, 'ALMACEN');
    e2 := 'NO bloqueó (mal)';
  exception when others then e2 := 'bloqueado OK';
  end;
  v_r := guardar_pedido_vendedor('ensayo-vtd-3', jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 2, 'precio_unitario', v_lista)), true, 'Cliente de prueba', 'ALMACEN');
  v_ped := (v_r ->> 'pedido_id')::bigint;
  v_lin := (v_r -> 'lineas' -> 0 ->> 'linea_id')::bigint;
  v_total := (v_r ->> 'total')::numeric;
  -- llamada vieja, sin p_canal
  v_tienda := guardar_pedido_vendedor(p_clave => 'ensayo-vtd-4', p_lineas => jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1)), p_enviar => false, p_nota => null);

  -- Como el cajero de la sesión abierta
  perform set_config('request.jwt.claim.sub', v_ses.cajero_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ses.cajero_id, 'role', 'authenticated')::text, true);
  perform tomar_pedido_vendedor(v_ped, v_ses.id);
  begin
    perform cobrar_pedido_vendedor(array[v_ped], jsonb_build_array(jsonb_build_object('pedido_linea_id', v_lin, 'producto_id', v_prod, 'cantidad_base', 2, 'precio_unitario', v_lista, 'verificada', true)),
                                   jsonb_build_array(jsonb_build_object('metodo', 'EFECTIVO', 'monto', v_total)), v_ses.id, 'ensayo-vtd-x');
    e3 := 'NO bloqueó (mal)';
  exception when check_violation then e3 := 'bloqueado OK';
  end;
  begin
    perform cobrar_pedido_vendedor_vtd(v_ped, jsonb_build_array(jsonb_build_object('pedido_linea_id', v_lin, 'producto_id', v_prod, 'cantidad_base', 2, 'precio_unitario', v_lista, 'verificada', true)),
                                       '[]'::jsonb, v_ses.id, v_ubic, 'ensayo-vtd-y');
    e4 := 'NO bloqueó (mal)';
  exception when others then e4 := 'bloqueado OK';
  end;
  v_cobro := cobrar_pedido_vendedor_vtd(v_ped, jsonb_build_array(jsonb_build_object('pedido_linea_id', v_lin, 'producto_id', v_prod, 'cantidad_base', 2, 'precio_unitario', v_lista, 'verificada', true)),
                                        jsonb_build_array(jsonb_build_object('metodo', 'EFECTIVO', 'monto', v_total)), v_ses.id, v_ubic, 'ensayo-vtd-z');
  select * into v_ven from venta where id = (v_cobro ->> 'venta_id')::bigint;
  -- reintento con la misma clave
  e5 := (cobrar_pedido_vendedor_vtd(v_ped, jsonb_build_array(jsonb_build_object('pedido_linea_id', v_lin, 'producto_id', v_prod, 'cantidad_base', 2, 'precio_unitario', v_lista, 'verificada', true)),
                                    jsonb_build_array(jsonb_build_object('metodo', 'EFECTIVO', 'monto', v_total)), v_ses.id, v_ubic, 'ensayo-vtd-z')) ->> 'reintento';

  -- Otra vez como reponedor
  perform set_config('request.jwt.claim.sub', v_josias::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_josias, 'role', 'authenticated')::text, true);
  v_cuenta := mi_cuenta_vendedor();

  raise exception 'ENSAYO | personalizado en almacén: % | enviar sin cliente: % | enviada: estado=% canal=% | llamada vieja: canal=% | cobro de tienda: % | sin pago: % | VTD: numero=% estado=% total=% vendedor_ok=% pedido=% | reintento=% | cuenta: canal=% parte=%',
    e1, e2, v_r ->> 'estado', v_r ->> 'canal', v_tienda ->> 'canal', e3, e4,
    v_ven.numero, v_ven.estado, v_ven.total, v_ven.vendedor_id = v_josias,
    (select estado from pedido_vendedor where id = v_ped), e5,
    (select x ->> 'canal' from jsonb_array_elements(v_cuenta -> 'pedidos') x where (x ->> 'pedido_id')::bigint = v_ped),
    (select x ->> 'parte' from jsonb_array_elements(v_cuenta -> 'pedidos') x where (x ->> 'pedido_id')::bigint = v_ped);
end
$t$;

rollback;
