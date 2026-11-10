-- ENSAYO de 20261110123000_precio_sugerido_lote.sql: BEGIN … ROLLBACK, no deja nada en la base.
begin;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Ensayo: RAISE EXCEPTION muestra los valores y aborta (nada se guarda).
-- Compara el lote contra precio_sugerido() línea por línea en cotizaciones reales.
-- ─────────────────────────────────────────────────────────────────────────────
do $t$
declare
  v_uid uuid; q record; pid bigint; i int;
  v_lineas jsonb; v_lote jsonb; v_ref jsonb; t0 timestamptz;
  ms_lote numeric := 0; ms_ref numeric := 0;
  n_cot int := 0; n_lin int := 0; n_dif int := 0; n_ult int := 0; n_cat int := 0;
  muestras text := ''; res text := '';
begin
  begin
    perform public.precio_sugerido_lote('[]'::jsonb);
    raise exception 'ENSAYO FALLÓ [1]: respondió sin sesión';
  exception when others then
    if sqlerrm not like 'No autorizado%' then raise; end if;
  end;
  res := res || E'\n1 SIN SESIÓN: ok, responde «No autorizado»';

  select id into v_uid from public.perfil where activo order by id limit 1;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if public.app_rol_actual() is null then raise exception 'ENSAYO FALLÓ [2]: no se pudo simular la sesión'; end if;

  if public.precio_sugerido_lote('[]'::jsonb) <> '[]'::jsonb then raise exception 'ENSAYO FALLÓ [2]: arreglo vacío no devuelve []'; end if;
  select producto_id into pid from public.cotizacion_linea where producto_id is not null order by id desc limit 1;
  v_lote := public.precio_sugerido_lote(jsonb_build_array(
    jsonb_build_object('producto_id', pid, 'presentacion_id', null),
    jsonb_build_object('producto_id', pid, 'presentacion_id', -1),
    jsonb_build_object('producto_id', pid)));
  if jsonb_array_length(v_lote) <> 3 then raise exception 'ENSAYO FALLÓ [2]: esperaba 3 elementos, llegaron %', jsonb_array_length(v_lote); end if;
  for i in 0..2 loop
    if (v_lote->i->>'factor')::numeric <> 1 or (v_lote->i->'ultimo_cliente') <> 'null'::jsonb or (v_lote->i->'categoria') <> 'null'::jsonb then
      raise exception 'ENSAYO FALLÓ [2]: sin cliente ni categoría esperaba factor 1 y nulos: %', v_lote->i;
    end if;
  end loop;
  begin
    perform public.precio_sugerido_lote((select jsonb_agg(jsonb_build_object('producto_id', pid)) from generate_series(1, 501)));
    raise exception 'ENSAYO FALLÓ [2]: aceptó 501 líneas';
  exception when others then
    if sqlerrm not like 'Máximo 500%' then raise; end if;
  end;
  res := res || E'\n2 BORDES: ok ([] vacío, presentación ajena = factor 1, sin cliente/categoría = nulos, tope 500)';

  for q in
    select co.id, co.numero, co.cliente_id, co.categoria::text as categoria
      from public.cotizacion co
     where co.cliente_id is not null
       and (select count(*) from public.cotizacion_linea cl where cl.cotizacion_id = co.id and cl.producto_id is not null) between 3 and 60
     order by co.id desc limit 15
  loop
    select jsonb_agg(jsonb_build_object('producto_id', cl.producto_id, 'presentacion_id', cl.presentacion_id) order by cl.id) into v_lineas
      from public.cotizacion_linea cl where cl.cotizacion_id = q.id and cl.producto_id is not null;
    n_cot := n_cot + 1; n_lin := n_lin + jsonb_array_length(v_lineas);

    t0 := clock_timestamp();
    v_lote := public.precio_sugerido_lote(v_lineas, q.cliente_id, q.categoria);
    ms_lote := ms_lote + extract(epoch from clock_timestamp() - t0) * 1000;

    t0 := clock_timestamp();
    select jsonb_agg(public.precio_sugerido((e->>'producto_id')::bigint, q.cliente_id, q.categoria, (e->>'presentacion_id')::bigint) order by ord) into v_ref
      from jsonb_array_elements(v_lineas) with ordinality as t(e, ord);
    ms_ref := ms_ref + extract(epoch from clock_timestamp() - t0) * 1000;

    for i in 0 .. jsonb_array_length(v_lineas) - 1 loop
      if (v_ref->i->'ultimo_cliente') <> 'null'::jsonb then n_ult := n_ult + 1; end if;
      if (v_ref->i->'categoria') <> 'null'::jsonb then n_cat := n_cat + 1; end if;
      if (v_lote->i) is distinct from (v_ref->i) then
        n_dif := n_dif + 1;
        if n_dif <= 3 then muestras := muestras || E'\n   ' || q.numero || ' #' || i || ' lote=' || (v_lote->i)::text || ' ref=' || (v_ref->i)::text; end if;
      end if;
    end loop;
  end loop;
  if n_dif > 0 then raise exception 'ENSAYO FALLÓ [3]: % de % líneas difieren de precio_sugerido():%', n_dif, n_lin, muestras; end if;
  res := res || E'\n3 IGUALDAD: ok, ' || n_lin || ' líneas de ' || n_cot || ' cotizaciones idénticas a precio_sugerido() (' || n_ult || ' con último precio, ' || n_cat || ' con mediana)';
  res := res || E'\n4 TIEMPO EN BASE: lote ' || round(ms_lote) || ' ms vs línea por línea ' || round(ms_ref) || ' ms (' || n_cot || ' llamadas vs ' || n_lin || ')';

  if has_function_privilege('anon', 'public.precio_sugerido_lote(jsonb,bigint,text)', 'execute') then raise exception 'ENSAYO FALLÓ [5]: anon puede ejecutar'; end if;
  if not has_function_privilege('authenticated', 'public.precio_sugerido_lote(jsonb,bigint,text)', 'execute') then raise exception 'ENSAYO FALLÓ [5]: authenticated no puede ejecutar'; end if;
  res := res || E'\n5 PERMISOS: ok, anon sin acceso; authenticated ejecuta';

  if (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('venta_linea_producto_idx', 'ix_presentacion_producto', 'ix_identificador_presentacion')) <> 3 then
    raise exception 'ENSAYO FALLÓ [6]: faltan índices';
  end if;
  res := res || E'\n6 ÍNDICES: ok, los 3 creados';

  raise exception E'ENSAYO OK (revertido):%', res;
end $t$;

rollback;
