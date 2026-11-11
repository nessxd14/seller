-- ============================================================================
-- 2026-11-11_rol_reponedor.sql
-- Primer rol definido: REPONEDOR (vendedor de tienda que además hace traslados).
--
-- Decisión de Ness (2026-11-11):
--   · El reponedor vende en tienda desde el celular: arma la venta y la manda
--     a caja. Solo caja cobra.
--   · Puede bajar el precio "muy levemente": el mismo tope del vendedor de
--     piso (10 % sobre la presentación base). El cajero puede cambiarlo sin
--     tope al cobrar, y la venta queda a nombre del reponedor.
--   · Hace traslados (ya permitido en traslado_autorizar) y VTD (sin cobrar).
--
-- Cambios de esta migración (misma firma en las funciones que ya existían):
--   1. guardar_pedido_vendedor: acepta el rol 'reponedor'.
--   2. vendedores_caja: incluye a los reponedores, para que caja pueda
--      atribuirles una venta que atendieron.
--   3. anular_pedido_vendedor: el reponedor NO anula, ni lo suyo. Solo caja
--      (ENVIADO / EN_CAJA, con motivo) o gerente/admin. Lo que deja en el
--      celular sin enviar lo cierra el cron de la noche.
--   4. mi_cuenta_vendedor (nueva): la cuenta automática de "su parte".
--      Suma solo las líneas que anotó el vendedor/reponedor y que caja
--      cobró, al precio final de caja. Lo agregado en caja no suma.
-- Nada más cambia: cobrar_pedido_vendedor ya pasa pedido_vendedor.vendedor_id
-- a venta.vendedor_id, y la RLS de pedido_vendedor ya deja a cada uno ver lo suyo.
-- ============================================================================

begin;

-- 1. guardar_pedido_vendedor ---------------------------------------------------
create or replace function public.guardar_pedido_vendedor(p_clave text, p_lineas jsonb, p_enviar boolean default false, p_nota text default null::text)
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
  end if;

  update pedido_vendedor
     set total = v_total,
         nota = nullif(btrim(p_nota), ''),
         actualizado_en = now(),
         estado = case when p_enviar then 'ENVIADO' else 'ARMANDO' end,
         enviado_en = case when p_enviar then now() end
   where id = v_ped.id;

  return _pedido_vendedor_json(v_ped.id) || jsonb_build_object('reintento', false);
end;
$function$;

revoke all on function public.guardar_pedido_vendedor(text, jsonb, boolean, text) from anon, public;
grant execute on function public.guardar_pedido_vendedor(text, jsonb, boolean, text) to authenticated, service_role;

-- 2. vendedores_caja -----------------------------------------------------------
create or replace function public.vendedores_caja()
 returns table(id uuid, nombre text)
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  perform hermes.exigir_operador_pos();
  -- [2026-11-11] + 'reponedor': caja puede atribuirle la venta que atendió.
  return query select p.id,p.nombre from public.perfil p where p.activo
    and p.rol::text in ('vendedor','vendedor_mayoreo','reponedor','cajero','admin','gerente') order by p.nombre,p.id;
end $function$;

revoke all on function public.vendedores_caja() from anon, public;
grant execute on function public.vendedores_caja() to authenticated, service_role;

-- 3. anular_pedido_vendedor ----------------------------------------------------
create or replace function public.anular_pedido_vendedor(p_pedido_id bigint, p_motivo text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rol text := app_rol_actual();
  v_ped pedido_vendedor%rowtype;
  v_origen text;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_rol is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  -- [2026-11-11] El reponedor no anula ventas, ni las suyas: solo caja.
  if v_rol = 'reponedor' then
    raise exception 'Solo caja puede anular una venta. Si te equivocaste, retírala de caja y corrígela.' using errcode = '42501';
  end if;
  select * into v_ped from pedido_vendedor where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_ped.estado = 'ANULADO' then
    return _pedido_vendedor_json(v_ped.id);
  end if;
  if v_ped.estado = 'COBRADO' then
    raise exception 'El pedido % ya está cobrado', v_ped.numero_dia;
  end if;

  if v_ped.vendedor_id = v_uid and v_ped.estado in ('ARMANDO', 'ENVIADO') then
    v_origen := 'VENDEDOR';
  elsif v_rol in ('gerente', 'admin') then
    v_origen := 'GERENTE';
  elsif v_rol = 'cajero' and v_ped.estado in ('ENVIADO', 'EN_CAJA') then
    v_origen := 'CAJERO';
  else
    raise exception 'No puedes anular este pedido' using errcode = '42501';
  end if;
  if v_origen <> 'VENDEDOR' and v_motivo is null then
    raise exception 'El motivo es obligatorio para anular un pedido de otro vendedor';
  end if;

  update pedido_vendedor
     set estado = 'ANULADO', anulado_en = now(), anulado_por = v_uid,
         anulado_origen = v_origen, anulado_motivo = left(v_motivo, 300), actualizado_en = now()
   where id = v_ped.id;
  return _pedido_vendedor_json(v_ped.id);
end;
$function$;

revoke all on function public.anular_pedido_vendedor(bigint, text) from anon, public;
grant execute on function public.anular_pedido_vendedor(bigint, text) to authenticated, service_role;

-- 4. mi_cuenta_vendedor (nueva) --------------------------------------------------
-- La cuenta de cada vendedor / reponedor, sin costos ni márgenes.
--   parte          = suma de sus líneas cobradas (cantidad_final × precio_final).
--   agregado_caja  = lo que caja sumó encima (total de la venta − su parte).
--   corregidas     = líneas donde caja cambió el precio que él puso.
-- Rango máximo 62 días. Cada uno ve solo lo suyo; gerente/admin pueden pedir
-- la de otro con p_perfil.
create or replace function public.mi_cuenta_vendedor(p_desde date default null, p_hasta date default null, p_perfil uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_rol   text := app_rol_actual();
  v_hoy   date := (now() at time zone 'America/La_Paz')::date;
  v_desde date := coalesce(p_desde, v_hoy);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_quien uuid := coalesce(p_perfil, v_uid);
  v_res   jsonb;
begin
  if v_rol is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_quien <> v_uid and v_rol not in ('gerente', 'admin') then
    raise exception 'Solo puedes ver tu propia cuenta' using errcode = '42501';
  end if;
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'Rango de fechas no válido (máximo 62 días)';
  end if;

  with ped as (
    select p.id, p.numero_dia, p.fecha, p.estado, p.total, p.cobrado_en,
           p.anulado_origen, p.anulado_motivo, ve.total as total_venta,
           coalesce((select round(sum(l.cantidad_final * l.precio_final), 2)
                       from pedido_vendedor_linea l
                      where l.pedido_id = p.id and l.resultado = 'COBRADA'), 0) as parte,
           (select count(*) from pedido_vendedor_linea l
             where l.pedido_id = p.id and l.resultado = 'COBRADA'
               and l.precio_final is distinct from l.precio_unitario) as corregidas,
           (select count(*) from pedido_vendedor_linea l
             where l.pedido_id = p.id and l.resultado = 'QUITADA') as quitadas
      from pedido_vendedor p
      left join venta ve on ve.id = p.venta_id
     where p.vendedor_id = v_quien and p.fecha between v_desde and v_hasta
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'parte', coalesce(sum(parte) filter (where estado = 'COBRADO'), 0),
    'cobradas', count(*) filter (where estado = 'COBRADO'),
    'por_cobrar', count(*) filter (where estado in ('ENVIADO', 'EN_CAJA')),
    'guardadas', count(*) filter (where estado = 'ARMANDO'),
    'anuladas', count(*) filter (where estado = 'ANULADO'),
    'pedidos', coalesce(jsonb_agg(jsonb_build_object(
        'pedido_id', id, 'numero_dia', numero_dia, 'fecha', fecha, 'estado', estado,
        'total_enviado', total, 'cobrado_en', cobrado_en,
        'parte', case when estado = 'COBRADO' then parte end,
        'agregado_caja', case when estado = 'COBRADO' then greatest(coalesce(total_venta, 0) - parte, 0) end,
        'precios_corregidos', corregidas, 'lineas_quitadas', quitadas,
        'anulado_origen', anulado_origen, 'anulado_motivo', anulado_motivo)
      order by id desc), '[]'::jsonb))
    into v_res
    from ped;
  return v_res;
end;
$function$;

revoke all on function public.mi_cuenta_vendedor(date, date, uuid) from anon, public;
grant execute on function public.mi_cuenta_vendedor(date, date, uuid) to authenticated, service_role;

commit;
