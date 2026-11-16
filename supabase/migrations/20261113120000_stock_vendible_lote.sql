-- 2026-11-13_stock_vendible_lote.sql
-- Reemplaza las 4 peticiones de getStockBySucursalBatch (Seller) por una sola RPC.
-- Devuelve los mismos datos crudos que hoy pide el cliente por separado, para que la
-- lógica del front (sumas por sucursal, LIBRE/CONTROLADO, vendible/reservado) quede igual:
--   stock            ← stock_actual + ubicacion (embed ubicacion_id)
--   overrides        ← producto_sucursal
--   vendible_tienda  ← saldo_vendible(ids, 2)
--   vendible_almacen ← saldo_vendible(ids, 1)
-- SECURITY INVOKER: respeta las mismas RLS que las lecturas directas actuales.
-- Objetivo: reducir peticiones a la API (logs). Ver claude/incidente-logs-puente-vlm-2026-11-13.md

create or replace function public.stock_vendible_lote(p_producto_ids bigint[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', s.producto_id,
               'cantidad_base', s.cantidad_base,
               'sucursal_id', u.sucursal_id,
               'excluye_disponible', u.excluye_disponible)
             order by s.producto_id, s.ubicacion_id)
      from public.stock_actual s
      left join public.ubicacion u on u.id = s.ubicacion_id
      where s.producto_id = any(p_producto_ids)), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'producto_id', ps.producto_id,
               'sucursal_id', ps.sucursal_id,
               'control_stock', ps.control_stock))
      from public.producto_sucursal ps
      where ps.producto_id = any(p_producto_ids)), '[]'::jsonb),
    'vendible_tienda', coalesce((
      select jsonb_agg(to_jsonb(v)) from public.saldo_vendible(p_producto_ids, 2) v), '[]'::jsonb),
    'vendible_almacen', coalesce((
      select jsonb_agg(to_jsonb(v)) from public.saldo_vendible(p_producto_ids, 1) v), '[]'::jsonb)
  );
$$;

revoke all on function public.stock_vendible_lote(bigint[]) from anon, public;
grant execute on function public.stock_vendible_lote(bigint[]) to authenticated, service_role;

comment on function public.stock_vendible_lote(bigint[]) is
  'Seller: stock físico, overrides de control_stock y saldo_vendible de tienda (2) y almacén (1) para un lote de productos, en una sola petición.';
