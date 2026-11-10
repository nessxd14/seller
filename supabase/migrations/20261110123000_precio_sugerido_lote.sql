-- Precio sugerido por lote + índices para el editor de cotizaciones.
--
-- El editor de cotizaciones pedía public.precio_sugerido() una vez por línea: una cotización de
-- 23 líneas eran 23 llamadas, y cada una recorría el historial del producto dos veces.
-- public.precio_sugerido_lote() responde todas las líneas en una sola llamada y recorre el
-- historial una vez por producto. Usa public._precios_base() igual que precio_sugerido(), así que
-- las dos devuelven lo mismo: la regla de precios vive en un solo lugar.
--
--   public.precio_sugerido_lote(p_lineas jsonb, p_cliente_id bigint, p_categoria text) → jsonb
--     p_lineas: [{"producto_id": 67, "presentacion_id": 123 | null}, …]  (máximo 500)
--     devuelve un arreglo en el MISMO orden; cada elemento es idéntico a lo que devuelve
--     precio_sugerido(): {"factor", "ultimo_cliente": {...} | null, "categoria": {...} | null}
--
-- Índices: venta_linea no tenía índice por producto (el historial la recorría entera);
-- presentacion e identificador se consultan por su tabla padre.
-- CREATE INDEX bloquea escrituras en la tabla mientras se construye: con estos tamaños
-- (8 mil, 2,7 mil y 2,3 mil filas) son milisegundos.
--
-- Requisitos: public._precios_base(bigint) y public.app_rol_actual() (ya en producción).
-- No reemplaza ni modifica precio_sugerido(): el frontend la sigue usando como respaldo.
-- Estado: ensayada el 2026-11-10 contra producción (298 líneas de 15 cotizaciones, idénticas a
-- precio_sugerido()). La aplica Ness. Ensayo: supabase/ensayos/20261110123000_precio_sugerido_lote_ENSAYO.sql.

CREATE INDEX IF NOT EXISTS venta_linea_producto_idx ON public.venta_linea USING btree (producto_id);
CREATE INDEX IF NOT EXISTS ix_presentacion_producto ON public.presentacion USING btree (producto_id);
CREATE INDEX IF NOT EXISTS ix_identificador_presentacion ON public.identificador USING btree (presentacion_id);

CREATE OR REPLACE FUNCTION public.precio_sugerido_lote(p_lineas jsonb, p_cliente_id bigint DEFAULT NULL::bigint, p_categoria text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoy date := (now() at time zone 'America/La_Paz')::date;
  v_res jsonb;
begin
  if app_rol_actual() is null then
    raise exception 'No autorizado';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'p_lineas debe ser un arreglo';
  end if;
  if jsonb_array_length(p_lineas) > 500 then
    raise exception 'Máximo 500 líneas por llamada';
  end if;

  with lin as (
    select (e->>'producto_id')::bigint as producto_id, (e->>'presentacion_id')::bigint as presentacion_id, ord
      from jsonb_array_elements(p_lineas) with ordinality as t(e, ord)
  ),
  prods as (
    select distinct producto_id from lin where producto_id is not null
  ),
  b as materialized (
    select p.producto_id, pb.fuente, pb.documento_id, pb.numero, pb.fecha, pb.cliente_id, pb.categoria, pb.precio_unidad_base, pb.atipico
      from prods p cross join lateral _precios_base(p.producto_id) pb
  ),
  ult as (
    select distinct on (producto_id) producto_id, precio_unidad_base, fecha, numero, fuente
      from b
     where cliente_id = p_cliente_id and not atipico
     order by producto_id, (fuente = 'COTIZACION'), fecha desc, documento_id desc
  ),
  med as (
    select producto_id,
           round(percentile_cont(0.5) within group (order by precio_unidad_base)::numeric, 2) as mediana,
           count(*)::int as n
      from b
     where categoria = p_categoria and not atipico and fuente <> 'COTIZACION' and fecha >= v_hoy - 90
     group by producto_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'factor', f.factor,
           'ultimo_cliente', case when u.producto_id is null then null else jsonb_build_object(
               'precio', round(u.precio_unidad_base * f.factor, 2), 'fecha', u.fecha, 'numero', u.numero, 'fuente', u.fuente) end,
           'categoria', case when m.producto_id is null then null else jsonb_build_object(
               'categoria', p_categoria, 'mediana', round(m.mediana * f.factor, 2), 'lineas', m.n, 'dias', 90) end
         ) order by l.ord), '[]'::jsonb)
    into v_res
    from lin l
    cross join lateral (
      select coalesce((select coalesce(nullif(pr.factor_unidad_base, 0), 1) from presentacion pr
                        where pr.id = l.presentacion_id and pr.producto_id = l.producto_id), 1) as factor
    ) f
    left join ult u on u.producto_id = l.producto_id
    left join med m on m.producto_id = l.producto_id;

  return v_res;
end;
$function$;
REVOKE ALL ON FUNCTION public.precio_sugerido_lote(jsonb, bigint, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.precio_sugerido_lote(jsonb, bigint, text) TO authenticated, service_role;
