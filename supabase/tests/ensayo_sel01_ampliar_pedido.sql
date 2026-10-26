-- Ensayo SEL-01. Correr DESPUÉS del contenido de la migración, en la misma transacción.
-- Termina siempre con RAISE EXCEPTION: no deja nada escrito.
do $$
declare
  r jsonb; rep text := ''; n_antes int; n_despues int;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();
  l jsonb := '[{"es_personalizado":true,"descripcion":"PRUEBA SEL-01","cantidad_base":1,"precio_unitario":10,"unidad_medida":"UNIDAD"}]';
  l2 jsonb := '[{"es_personalizado":true,"descripcion":"PRUEBA SEL-01 B","cantidad_base":2,"precio_unitario":10,"unidad_medida":"UNIDAD"}]';
  v int;
begin
  perform set_config('request.jwt.claims', '{"sub":"33d29ce8-a4fe-4776-bf34-16b09b6a81b4","email":"admin@cation.app","role":"authenticated"}', true);
  execute 'set local role authenticated';

  -- T1 partida abierta sin entrega (pedido 828)
  r := public.ampliar_pedido(828, k1, l, 'ensayo');
  rep := rep || ' | T1 ' || (r->>'camino') || ' monto=' || (r->>'monto_adicional') || ' v=' || (r->>'version');
  select count(*) into n_antes from pedido_linea where pedido_id = 828;
  -- T1b reintento con la misma clave
  r := public.ampliar_pedido(828, k1, l, 'ensayo');
  select count(*) into n_despues from pedido_linea where pedido_id = 828;
  rep := rep || ' | T1b repetida=' || (r->>'repetida') || ' lineas ' || n_antes || '->' || n_despues;
  -- T1c misma clave, otro contenido
  begin
    r := public.ampliar_pedido(828, k1, l2, 'ensayo');
    rep := rep || ' | T1c FALLO: aceptó';
  exception when others then rep := rep || ' | T1c ' || sqlstate;
  end;
  -- T1d versión vieja
  begin
    r := public.ampliar_pedido(828, gen_random_uuid(), l, 'ensayo', 0);
    rep := rep || ' | T1d FALLO: aceptó';
  exception when others then rep := rep || ' | T1d ' || sqlstate;
  end;

  -- T2 pedido pagado (844, partida 489 PAGADA)
  r := public.ampliar_pedido(844, k2, l, 'ensayo');
  rep := rep || ' | T2 ' || (r->>'camino') || ' entrega=' || coalesce(r->>'entrega_numero','-') || ' doc=' || coalesce(r->>'documento_interno','-');

  -- T3 partida abierta con entrega (842)
  r := public.ampliar_pedido(842, k3, l, 'ensayo');
  rep := rep || ' | T3 ' || (r->>'camino') || ' entrega=' || coalesce(r->>'entrega_numero','-');

  execute 'reset role';
  -- Dispara ahora los disparadores diferidos (lo que pasaría al confirmar).
  execute 'set constraints all immediate';

  -- Cuadre pedido vs cartera después de todo
  rep := rep || ' | CUADRE ' || (
    select string_agg(p.id || ':pedido=' || p.total || ' cartera=' ||
      coalesce((select sum(total) from hermes.partida_abierta pa where pa.pedido_id = p.id and pa.estado not in ('ANULADA','CANCELADA')), 0)
      || ' movs=' || (select count(*) from hermes.movimiento_cuenta m where m.idempotencia_clave like 'ampliacion-%' and m.partida_id in (select id from hermes.partida_abierta where pedido_id = p.id)), '; ' order by p.id)
    from pedido p where p.id in (828, 842, 844));
  rep := rep || ' | REGISTROS ' || (select count(*) from pedido_ampliacion);

  raise exception 'ENSAYO SEL-01 (rollback):%', rep;
end $$;
