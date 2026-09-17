-- Brief: Comisiones, Fase 2 — devengo automático + liquidación por lotes.
-- Aplicar sobre lo que ya está en producción de la Fase 1
-- (2026-09-12_comisiones.sql/_seed.sql/_backfill.sql, ya aplicadas por Ness).
--
-- NO aplicar a mano sin antes validar en BEGIN … ROLLBACK — Ness la aplica desde el
-- SQL editor de Cation (zxoxougwgstrarwymlvd), no Claude Code.

-- ============================================================================
-- Parte 1.1 — VTD devenga al instante (venta_pago cobra en el mismo acto, nunca
-- pasa por la cartera de hermes).
-- ============================================================================

create or replace function comision_registrar_venta(p_venta_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_vendedor text;
  v_fecha date;
  v_total numeric(14,2);
  v_base numeric(14,2);
  v_monto numeric(14,2);
begin
  if exists (select 1 from comision_devengo where venta_id = p_venta_id) then return; end if;

  select comision_vendedor_resolver(v.creado_por), v.creado_en::date, coalesce(v.total, 0)
    into v_vendedor, v_fecha, v_total
  from venta v
  where v.id = p_venta_id and v.estado = 'COMPLETADA' and v.ubicacion_id = 31;

  if v_vendedor is null then return; end if;

  select coalesce(sum(vl.subtotal), 0), coalesce(sum(vl.subtotal * comision_porcentaje_producto(vl.producto_id)), 0)
    into v_base, v_monto
  from venta_linea vl
  where vl.venta_id = p_venta_id and comision_porcentaje_producto(vl.producto_id) is not null;

  if v_base is null or v_base = 0 then return; end if;

  -- Único cambio de Fase 2 sobre la función de Fase 1: VTD nace DEVENGADA, no
  -- POTENCIAL — venta_pago cobra en el acto, nunca pasa por hermes.partida_abierta.
  insert into comision_devengo (origen, venta_id, vendedor_email, documento_fecha, base_comisionable, total_documento, porcentaje, monto, estado, devengado_en)
  values ('VTD', p_venta_id, v_vendedor, v_fecha, v_base, v_total, round(v_monto / v_base, 4), round(v_monto, 2), 'DEVENGADA', now())
  on conflict (venta_id) do nothing;
end;
$$;

-- Corrección de las 33 filas VTD ya existentes, calculadas en POTENCIAL por la
-- versión de Fase 1 de la función de arriba.
update comision_devengo
   set estado = 'DEVENGADA', devengado_en = coalesce(devengado_en, calculado_en)
 where origen = 'VTD' and estado = 'POTENCIAL';

-- ============================================================================
-- Parte 1.2 — PEDIDO devenga al saldarse la partida, y revierte si el pago se
-- anula o se rechaza. El monto NO se recalcula: sigue congelado desde Fase 1.
-- ============================================================================

-- Recalcula el estado de devengo del pedido dueño de una partida, mirando TODAS
-- las partidas de ese pedido (partir_partida puede dividir una en varias) y sumando
-- solo pagos CONFIRMADO/ACREDITADO — mismo criterio que hermes.v_partida_estado.
-- Nunca toca el monto congelado; solo mueve POTENCIAL <-> DEVENGADA. Si ya está
-- LIQUIDADA y la partida vuelve a tener saldo, no se revierte solo — eso es una
-- decisión humana (ya se le pagó al vendedor) — se deja avisado por WARNING.
create or replace function comision_sincronizar_partida(p_partida_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'hermes', 'pg_temp'
as $$
declare
  v_pedido_id bigint;
  v_total     numeric;
  v_imputado  numeric;
  v_devengo   record;
begin
  select pedido_id into v_pedido_id from hermes.partida_abierta where id = p_partida_id;
  if v_pedido_id is null then return; end if;

  select * into v_devengo from comision_devengo where pedido_id = v_pedido_id;
  if not found then return; end if;

  select coalesce(sum(pa.total), 0) into v_total
  from hermes.partida_abierta pa
  where pa.pedido_id = v_pedido_id and pa.estado <> 'ANULADA';

  if v_total is null or v_total = 0 then return; end if;

  select coalesce(sum(pap.monto), 0) into v_imputado
  from hermes.pago_aplicacion pap
  join hermes.pago pg on pg.id = pap.pago_id
  join hermes.partida_abierta pa on pa.id = pap.partida_id
  where pa.pedido_id = v_pedido_id and pa.estado <> 'ANULADA'
    and pg.estado in ('CONFIRMADO', 'ACREDITADO');

  if v_imputado >= v_total then
    if v_devengo.estado = 'POTENCIAL' then
      update comision_devengo set estado = 'DEVENGADA', devengado_en = now() where id = v_devengo.id;
    end if;
  else
    if v_devengo.estado = 'DEVENGADA' then
      update comision_devengo set estado = 'POTENCIAL', devengado_en = null where id = v_devengo.id;
    elsif v_devengo.estado = 'LIQUIDADA' then
      raise warning 'comision_devengo % (pedido %) volvió a tener saldo pendiente pero ya está LIQUIDADA — revisar a mano', v_devengo.id, v_pedido_id;
    end if;
  end if;
end;
$$;

-- Dispara en el momento en que se imputa un pago a una partida (confirmar_pago
-- inserta pago_aplicacion vía FIFO automático DURANTE la confirmación, antes del
-- UPDATE de pago.estado — a esa altura el pago sigue en PROPUESTO, así que esta
-- corrida no devenga nada todavía; la hace el trigger de abajo, sobre pago.estado).
create or replace function comision_trigger_pago_aplicacion()
returns trigger
language plpgsql
set search_path to 'public', 'hermes', 'pg_temp'
as $$
begin
  begin
    perform comision_sincronizar_partida(new.partida_id);
  exception when others then
    -- Nunca abortar la imputación de un pago por un fallo de sincronización de comisión.
    raise warning 'comision_sincronizar_partida(%) (pago_aplicacion) falló: % (%)', new.partida_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

create trigger comision_pago_aplicacion_sync
  after insert or update on hermes.pago_aplicacion
  for each row execute function comision_trigger_pago_aplicacion();

-- Dispara en el momento real en que un pago pasa a (o sale de) CONFIRMADO/ACREDITADO
-- — imputar_pago ya insertó las pago_aplicacion mientras el pago estaba PROPUESTO,
-- así que el cambio de estado (confirmar_pago, o una futura anulación/rechazo) es lo
-- único que mueve el saldo de la partida. Cubre ambas direcciones: saldar Y revertir.
create or replace function comision_trigger_pago_estado()
returns trigger
language plpgsql
set search_path to 'public', 'hermes', 'pg_temp'
as $$
declare
  r record;
begin
  begin
    for r in select distinct partida_id from hermes.pago_aplicacion where pago_id = new.id loop
      perform comision_sincronizar_partida(r.partida_id);
    end loop;
  exception when others then
    -- Nunca abortar el cambio de estado de un pago por un fallo de comisión.
    raise warning 'comision_sincronizar_partida (pago %) falló: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

create trigger comision_pago_estado_sync
  after update of estado on hermes.pago
  for each row
  when (old.estado is distinct from new.estado)
  execute function comision_trigger_pago_estado();

-- ============================================================================
-- Parte 1.3 — sincronización automática de partidas al completar un pedido.
-- La de mayor valor de las tres: sin esto, una partida solo nace si alguien entra
-- a CONCILIADOR y aprieta un botón (en agosto nadie lo hizo 3 semanas — Bs 201.679
-- entregados sin figurar como deuda).
-- ============================================================================

-- No filtra por categoría/estado acá: hermes.sincronizar_pedidos_cation() ya lo hace
-- (v_pedidos_cation_pendientes) y es idempotente (omite lo que ya tiene partida), así
-- que se la llama entera en cada cierre de pedido — barre cualquier backlog además del
-- pedido que se acaba de completar. 4 de los 26 casos sin partida de este brief son de
-- clientes sin cuenta en Hermes y 1 sin cliente — sincronizar_pedidos_cation() no los
-- resuelve (los reporta como CLIENTE_SIN_CUENTA/SIN_CLIENTE); hace falta además
-- sincronizar_clientes_cation(), que queda fuera de este trigger a propósito: importar
-- clientes nuevos a Hermes es una decisión de negocio, no un efecto secundario de
-- cerrar un pedido.
create or replace function comision_trigger_sync_partida_pedido()
returns trigger
language plpgsql
set search_path to 'public', 'hermes', 'pg_temp'
as $$
begin
  if new.estado = 'COMPLETADO' and (TG_OP = 'INSERT' or old.estado is distinct from new.estado) then
    begin
      perform hermes.sincronizar_pedidos_cation();
    exception when others then
      -- Nunca abortar el cierre de un pedido por un fallo de sincronización de cartera.
      raise warning 'sincronizar_pedidos_cation() tras pedido % falló: % (%)', new.id, sqlerrm, sqlstate;
    end;
  end if;
  return new;
end;
$$;

create trigger comision_sync_partida_pedido
  after insert or update on public.pedido
  for each row execute function comision_trigger_sync_partida_pedido();

-- ============================================================================
-- Parte 2 — liquidación por lotes (solo gerente).
-- ============================================================================

create table comision_liquidacion (
  id               bigserial primary key,
  vendedor_email   text not null,
  monto_total      numeric(14,2) not null,
  medio_pago       text,
  referencia       text,
  comprobante_url  text,
  nota             text,
  creado_por       text not null,
  creado_en        timestamptz not null default now(),
  anulado_en       timestamptz,
  anulado_por      text,
  motivo_anulacion text
);

-- FK que quedó pendiente de la Fase 1.
alter table comision_devengo
  add constraint comision_devengo_liquidacion_fk foreign key (liquidacion_id) references comision_liquidacion(id);

alter table comision_liquidacion enable row level security;

create policy comision_liquidacion_lectura on comision_liquidacion for select to authenticated using (
  comision_es_gerente() or vendedor_email = (select p.email from perfil p where p.id = auth.uid())
);
-- Sin policies de insert/update/delete para authenticated a propósito — toda escritura
-- pasa por las funciones SECURITY DEFINER de abajo, que validan comision_es_gerente()
-- y las reglas de negocio (nunca se liquida POTENCIAL, nunca se borra un lote).

-- Se paga la comisión completa de un documento o no se paga (confirmado con Ness: no
-- hay pagos parciales) — de ahí que esto sea un FK + cambio de estado, no un monto
-- acumulado. Valida que TODOS los ids sean DEVENGADA y del mismo vendedor antes de
-- tocar nada; si uno solo no califica, no liquida ninguno.
create or replace function comision_crear_liquidacion(
  p_vendedor_email   text,
  p_devengo_ids      bigint[],
  p_medio_pago       text default null,
  p_referencia       text default null,
  p_comprobante_url  text default null,
  p_nota             text default null
) returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_actor          text;
  v_monto          numeric(14,2);
  v_n_calificados  int;
  v_liquidacion_id bigint;
begin
  if not comision_es_gerente() then
    raise exception 'Solo el gerente puede armar liquidaciones';
  end if;
  if p_devengo_ids is null or array_length(p_devengo_ids, 1) is null then
    raise exception 'No se seleccionó ningún devengo';
  end if;

  select count(*), coalesce(sum(monto), 0) into v_n_calificados, v_monto
  from comision_devengo
  where id = any(p_devengo_ids) and vendedor_email = p_vendedor_email and estado = 'DEVENGADA';

  if v_n_calificados <> array_length(p_devengo_ids, 1) then
    raise exception 'Alguno de los devengos seleccionados no está DEVENGADA o no es de %', p_vendedor_email;
  end if;

  v_actor := coalesce(auth.jwt() ->> 'email', current_user);

  insert into comision_liquidacion (vendedor_email, monto_total, medio_pago, referencia, comprobante_url, nota, creado_por)
  values (p_vendedor_email, v_monto, p_medio_pago, p_referencia, p_comprobante_url, p_nota, v_actor)
  returning id into v_liquidacion_id;

  update comision_devengo set estado = 'LIQUIDADA', liquidacion_id = v_liquidacion_id
  where id = any(p_devengo_ids);

  return v_liquidacion_id;
end;
$$;

-- Anular un lote devuelve todos sus devengos a DEVENGADA y marca el lote anulado.
-- Nunca se borra — es historial de pagos.
create or replace function comision_anular_liquidacion(p_liquidacion_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_actor text;
begin
  if not comision_es_gerente() then
    raise exception 'Solo el gerente puede anular liquidaciones';
  end if;
  if not exists (select 1 from comision_liquidacion where id = p_liquidacion_id and anulado_en is null) then
    raise exception 'La liquidación % no existe o ya está anulada', p_liquidacion_id;
  end if;

  v_actor := coalesce(auth.jwt() ->> 'email', current_user);

  update comision_liquidacion
     set anulado_en = now(), anulado_por = v_actor, motivo_anulacion = p_motivo
   where id = p_liquidacion_id;

  update comision_devengo
     set estado = 'DEVENGADA', liquidacion_id = null
   where liquidacion_id = p_liquidacion_id and estado = 'LIQUIDADA';
end;
$$;

grant execute on function comision_crear_liquidacion(text, bigint[], text, text, text, text) to authenticated;
grant execute on function comision_anular_liquidacion(bigint, text) to authenticated;

-- ============================================================================
-- Parte 3.1 — "qué falta para cobrar", por RPC en vez de vista: hermes.partida_abierta/
-- pago/pago_aplicacion tienen RLS gateado por perfil.hermes_acceso (hermes_tiene_acceso()),
-- que la mayoría de los vendedores NO tiene — una vista corriente expondría null para
-- ellos (o, peor, si corre con privilegios del dueño de la vista, todo el detalle de
-- cartera de TODOS los clientes a CUALQUIER autenticado). Esta función SECURITY DEFINER
-- replica exactamente el filtro de comision_devengo_lectura fila por fila antes de
-- devolver nada — un vendedor sigue viendo solo lo suyo, ahora con estado de cobro.
create or replace function comision_seguimiento(p_desde date default null, p_hasta date default null)
returns table (
  devengo_id       bigint,
  partidas         int,
  partida_total    numeric,
  imputado         numeric,
  pendiente        numeric,
  fecha_vencimiento date,
  dias_vencido     int,
  reloj_corriendo  boolean
)
language plpgsql
security definer
set search_path to 'public', 'hermes', 'pg_temp'
as $$
begin
  return query
  select
    cd.id,
    count(pa.id)::int,
    sum(pa.total),
    sum(coalesce(ve.imputado, 0)),
    sum(coalesce(ve.pendiente, 0)),
    min(va.fecha_vencimiento),
    max(case when va.fecha_vencimiento < current_date then (current_date - va.fecha_vencimiento) end),
    bool_or(va.estado_reloj = 'CORRIENDO')
  from comision_devengo cd
  left join hermes.partida_abierta pa on pa.pedido_id = cd.pedido_id and pa.estado <> 'ANULADA'
  left join hermes.v_partida_estado ve on ve.partida_id = pa.id
  left join hermes.v_antiguedad va on va.partida_id = pa.id
  where (comision_es_gerente() or cd.vendedor_email = (select p.email from perfil p where p.id = auth.uid()))
    and (p_desde is null or cd.documento_fecha >= p_desde)
    and (p_hasta is null or cd.documento_fecha <= p_hasta)
  group by cd.id;
end;
$$;

grant execute on function comision_seguimiento(date, date) to authenticated;

-- ============================================================================
-- Parte 3.2 — desglose por línea de un devengo (fila expandible).
-- ============================================================================

create or replace function comision_lineas_devengo(p_devengo_id bigint)
returns table (
  producto_id     bigint,
  producto_nombre text,
  marca           text,
  subtotal        numeric,
  porcentaje      numeric,
  comisiona       boolean
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_devengo record;
begin
  select * into v_devengo from comision_devengo where id = p_devengo_id;
  if not found then return; end if;
  if not (comision_es_gerente() or v_devengo.vendedor_email = (select p.email from perfil p where p.id = auth.uid())) then
    raise exception 'No autorizado';
  end if;

  if v_devengo.origen = 'PEDIDO' then
    return query
    select pl.producto_id, coalesce(p.nombre::text, coalesce(pl.descripcion, 'Ítem personalizado')), p.marca::text, pl.subtotal,
           case when pl.producto_id is not null then comision_porcentaje_producto(pl.producto_id) end,
           coalesce(comision_porcentaje_producto(pl.producto_id) is not null, false)
    from pedido_linea pl
    left join producto p on p.id = pl.producto_id
    where pl.pedido_id = v_devengo.pedido_id;
  else
    return query
    select vl.producto_id, p.nombre::text, p.marca::text, vl.subtotal,
           comision_porcentaje_producto(vl.producto_id),
           coalesce(comision_porcentaje_producto(vl.producto_id) is not null, false)
    from venta_linea vl
    join producto p on p.id = vl.producto_id
    where vl.venta_id = v_devengo.venta_id;
  end if;
end;
$$;

grant execute on function comision_lineas_devengo(bigint) to authenticated;

-- ============================================================================
-- Parte 3.8 — contador de matches por regla (detecta reglas con 0 productos, el
-- mismo problema silencioso que tuvo el sistema viejo con toner/envius/blinder clip).
-- Cuenta contra el patrón de la regla directamente, sin arbitrar ganadora — una regla
-- sombreada por otra de mayor prioridad sigue "matcheando", que es lo que importa acá.
-- ============================================================================

create or replace function comision_regla_conteo()
returns table (regla_id bigint, productos int)
language sql
stable
as $$
  select r.id,
    (select count(*)::int from producto p where
       (r.tipo = 'MARCA' and upper(btrim(p.marca)) = upper(r.patron))
       or (r.tipo = 'NOMBRE' and p.nombre ilike '%' || r.patron || '%')
    )
  from comision_regla r;
$$;
