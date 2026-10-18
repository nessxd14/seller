-- Consulta de sólo lectura. No confirma pagos ni modifica pedidos o saldos.
create function public.consultar_cobros_pedidos(p_pedido_ids bigint[])
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, hermes as $$
declare resultado jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.perfil where id = auth.uid() and activo
      and rol::text in ('admin','gerente','cajero','vendedor','vendedor_mayoreo')
  ) then
    raise exception 'No autorizado para consultar cobros' using errcode = '42501';
  end if;
  if p_pedido_ids is null or cardinality(p_pedido_ids) < 1 or cardinality(p_pedido_ids) > 200
    or exists (select 1 from unnest(p_pedido_ids) id where id is null or id <= 0) then
    raise exception 'Pedidos inválidos';
  end if;

  with pedidos as (
    select p.id, p.estado, p.categoria, p.cliente_id, p.total pedido_total from public.pedido p where p.id = any(p_pedido_ids)
  ), resumen as (
    select p.id, p.estado, p.categoria, p.pedido_total,
      count(ve.partida_id) filter (where ve.estado::text <> 'ANULADA') as partidas,
      coalesce(sum(ve.total) filter (where ve.estado::text <> 'ANULADA'), 0) as total,
      coalesce(sum(greatest(ve.imputado, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as aplicado,
      coalesce(sum(greatest(ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as en_revision,
      -- Sumar pendientes por partida: el excedente de una no paga automáticamente otra.
      coalesce(sum(greatest(ve.pendiente, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as pendiente,
      coalesce(sum(greatest(ve.pendiente - ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as por_cobrar,
      coalesce(bool_or(ve.pendiente < 0 or ve.en_revision > greatest(ve.pendiente, 0)
        or ve.total is null or ve.pendiente is null or hc.pos_cliente_id is distinct from p.cliente_id)
        filter (where ve.estado::text <> 'ANULADA'), false) as inconsistente
    from pedidos p left join hermes.v_partida_estado ve on ve.pedido_id = p.id
      left join hermes.cliente hc on hc.id = ve.cliente_id
    group by p.id, p.estado, p.categoria, p.pedido_total
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pedido_id', id, 'partidas', partidas, 'total', total, 'aplicado', aplicado,
    'en_revision', en_revision, 'pendiente', pendiente, 'por_cobrar', por_cobrar,
    'estado', case
      when categoria::text = 'TIENDA' then 'no_aplica'
      when estado::text = 'CANCELADO' and partidas > 0 then 'revisar'
      when estado::text = 'CANCELADO' then 'cancelado'
      when partidas = 0 then 'sin_partida'
      when pedido_total is null or total <> pedido_total then 'revisar'
      when inconsistente then 'revisar'
      when en_revision > 0 then 'por_verificar'
      when pendiente = 0 and total = 0 then 'sin_pendiente'
      when pendiente = 0 then 'pagado'
      when aplicado > 0 then 'parcial'
      else 'pendiente'
    end
  ) order by id), '[]'::jsonb) into resultado from resumen;
  return resultado;
end $$;
revoke all on function public.consultar_cobros_pedidos(bigint[]) from public, anon, service_role;
grant execute on function public.consultar_cobros_pedidos(bigint[]) to authenticated;
comment on function public.consultar_cobros_pedidos(bigint[]) is
  'Lectura de cobros para Seller: partidas vigentes, confirmados y propuestas separados; no usa el saldo global del cliente.';
