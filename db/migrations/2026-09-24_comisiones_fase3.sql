-- Brief: Comisiones, Fase 3 — comisionar líneas personalizadas, marca visual, estilo de
-- pestañas, y una corrección pendiente de visibilidad de Fase 2.
--
-- NO aplicar a mano sin antes validar en BEGIN … ROLLBACK — Ness la aplica desde el
-- SQL editor de Cation (zxoxougwgstrarwymlvd), no Claude Code.

-- ============================================================================
-- Parte 1.1 — nuevo tipo de regla DESCRIPCION, para que "limpieza" (y lo que venga
-- después) se cargue desde la pantalla de Reglas, no hardcodeado en una función.
-- ============================================================================

alter table comision_regla drop constraint comision_regla_tipo_check;
alter table comision_regla add constraint comision_regla_tipo_check
  check (tipo in ('MARCA', 'NOMBRE', 'DESCRIPCION'));

-- Prioridad baja (10, contra 100 de MARCA y 200 de NOMBRE) para que "limpieza" gane
-- sobre cualquier otra regla que también matchee la misma descripción — es el criterio
-- de negocio de Ness, no un caso especial en el código.
insert into comision_regla (tipo, patron, accion, porcentaje, prioridad, nota, creado_por)
values ('DESCRIPCION', 'limpieza', 'INCLUIR', 0.005, 10,
        'Seed Fase 3 — paraguas de guantes/jabones/escobas que se compran aparte, confirmado con Ness', 'migracion');

-- ============================================================================
-- Parte 1.2 — evaluación de reglas contra texto libre (pedido_linea.descripcion).
-- CUIDADO ya documentado en el brief: MARCA sobre descripción usa límite de palabra
-- (\m…\M), no ILIKE — 'NORMA' como substring matchea "PILA NOR-MAL" y "GOMA EVA
-- NOR-MAL", ninguna de las cuales es la marca NORMA (mismo bug de 'bia'/'CAMBIA
-- colores' de la Fase 1). NOMBRE y DESCRIPCION siguen con ILIKE a propósito: describen
-- frases ("cinta de embalaje", "limpieza"), no marcas, y ahí el substring es correcto.
-- Contracaso aceptado: 'NOTA ADHESIVA RECTANGULAR DL6022' no matchea la marca DL con
-- límite de palabra (DL pegado a un código) — se prefiere perder ese match a pagar cinco
-- falsos como el de NORMA.
-- ============================================================================

-- Refactor sin cambio de comportamiento: comision_porcentaje_producto ahora delega a
-- una función que devuelve la regla completa, reusada por comision_lineas_devengo para
-- mostrar qué regla matcheó (brief Parte 2) sin duplicar el predicado de matching.
create or replace function comision_regla_ganadora_producto(p_producto_id bigint)
returns comision_regla
language sql
stable
as $$
  with prod as (
    select marca, nombre from producto where id = p_producto_id
  ),
  excluida as (
    select 1
    from comision_regla r, prod
    where r.activo and r.accion = 'EXCLUIR'
      and (
        (r.tipo = 'MARCA' and upper(btrim(prod.marca)) = upper(r.patron))
        or (r.tipo = 'NOMBRE' and prod.nombre ilike '%' || r.patron || '%')
      )
    limit 1
  )
  select r.*
  from comision_regla r, prod
  where r.activo and r.accion = 'INCLUIR'
    and not exists (select 1 from excluida)
    and (
      (r.tipo = 'MARCA' and upper(btrim(prod.marca)) = upper(r.patron))
      or (r.tipo = 'NOMBRE' and prod.nombre ilike '%' || r.patron || '%')
    )
  order by r.prioridad asc, (case r.tipo when 'MARCA' then 0 else 1 end) asc
  limit 1;
$$;

create or replace function comision_porcentaje_producto(p_producto_id bigint)
returns numeric
language sql
stable
as $$
  select (comision_regla_ganadora_producto(p_producto_id)).porcentaje;
$$;

-- Misma idea para líneas personalizadas, evaluando contra pedido_linea.descripcion en
-- vez de producto.marca/nombre. DESCRIPCION > MARCA > NOMBRE en el desempate a igual
-- prioridad (no hace falta en la práctica con las prioridades del seed, pero deja la
-- regla explícita si algún día alguien las empareja).
create or replace function comision_regla_ganadora_personalizada(p_descripcion text)
returns comision_regla
language sql
stable
as $$
  with excluida as (
    select 1 from comision_regla r
    where r.activo and r.accion = 'EXCLUIR'
      and (
        (r.tipo = 'DESCRIPCION' and p_descripcion ilike '%' || r.patron || '%')
        or (r.tipo = 'MARCA' and p_descripcion ~* ('\m' || r.patron || '\M'))
        or (r.tipo = 'NOMBRE' and p_descripcion ilike '%' || r.patron || '%')
      )
    limit 1
  )
  select r.*
  from comision_regla r
  where r.activo and r.accion = 'INCLUIR' and not exists (select 1 from excluida)
    and (
      (r.tipo = 'DESCRIPCION' and p_descripcion ilike '%' || r.patron || '%')
      or (r.tipo = 'MARCA' and p_descripcion ~* ('\m' || r.patron || '\M'))
      or (r.tipo = 'NOMBRE' and p_descripcion ilike '%' || r.patron || '%')
    )
  order by r.prioridad asc, (case r.tipo when 'DESCRIPCION' then 0 when 'MARCA' then 1 else 2 end) asc
  limit 1;
$$;

create or replace function comision_porcentaje_personalizada(p_descripcion text)
returns numeric
language sql
stable
as $$
  select (comision_regla_ganadora_personalizada(p_descripcion)).porcentaje;
$$;

alter table comision_devengo add column tiene_personalizado_comisionable boolean not null default false;

-- comision_registrar_pedido ahora suma también las líneas personalizadas que matchean
-- (antes las excluía por completo: sin producto_id, comision_porcentaje_producto(null)
-- siempre daba null). base_comisionable/monto siguen congelándose una sola vez, igual
-- que en Fase 1 — esto solo cambia qué entra a la suma en el momento del cálculo.
-- tiene_personalizado_comisionable queda grabado ahí mismo para la marca visual de la
-- Parte 2, sin tener que recorrer líneas otra vez en el front.
create or replace function comision_registrar_pedido(p_pedido_id bigint)
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
  v_tiene_personalizado boolean;
begin
  if exists (select 1 from comision_devengo where pedido_id = p_pedido_id) then return; end if;

  select comision_vendedor_resolver(pd.creado_por), pd.creado_en::date, coalesce(pd.total, 0)
    into v_vendedor, v_fecha, v_total
  from pedido pd
  where pd.id = p_pedido_id and pd.estado = 'COMPLETADO' and pd.categoria <> 'TIENDA';

  if v_vendedor is null then return; end if;

  select
    coalesce(sum(pl.subtotal) filter (where x.pct is not null), 0),
    coalesce(sum(pl.subtotal * x.pct) filter (where x.pct is not null), 0),
    coalesce(bool_or(pl.es_personalizado and x.pct is not null), false)
    into v_base, v_monto, v_tiene_personalizado
  from pedido_linea pl
  cross join lateral (
    select case
      when pl.producto_id is not null then comision_porcentaje_producto(pl.producto_id)
      when pl.es_personalizado then comision_porcentaje_personalizada(coalesce(pl.descripcion, ''))
      else null
    end as pct
  ) x
  where pl.pedido_id = p_pedido_id;

  if v_base is null or v_base = 0 then return; end if;

  insert into comision_devengo (origen, pedido_id, vendedor_email, documento_fecha, base_comisionable, total_documento, porcentaje, monto, tiene_personalizado_comisionable)
  values ('PEDIDO', p_pedido_id, v_vendedor, v_fecha, v_base, v_total, round(v_monto / v_base, 4), round(v_monto, 2), v_tiene_personalizado)
  on conflict (pedido_id) do nothing;
end;
$$;

-- ============================================================================
-- Parte 1.3 — backfill. El monto sigue congelado por diseño: esto NUNCA toca
-- DEVENGADA ni LIQUIDADA (ver guarda explícita adentro, y el WHERE de más abajo).
-- ============================================================================

-- Recalcula en el lugar un devengo ya existente, pero solo si sigue POTENCIAL —
-- DEVENGADA/LIQUIDADA es plata ya prometida o pagada, y el snapshot de Fase 1 existe
-- justo para que una regla nueva no la reescriba retroactivamente.
create or replace function comision_recalcular_personalizado_pedido(p_pedido_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_devengo record;
  v_base numeric(14,2);
  v_monto numeric(14,2);
  v_tiene_personalizado boolean;
begin
  select * into v_devengo from comision_devengo where pedido_id = p_pedido_id;
  if not found or v_devengo.estado <> 'POTENCIAL' then return; end if;

  select
    coalesce(sum(pl.subtotal) filter (where x.pct is not null), 0),
    coalesce(sum(pl.subtotal * x.pct) filter (where x.pct is not null), 0),
    coalesce(bool_or(pl.es_personalizado and x.pct is not null), false)
    into v_base, v_monto, v_tiene_personalizado
  from pedido_linea pl
  cross join lateral (
    select case
      when pl.producto_id is not null then comision_porcentaje_producto(pl.producto_id)
      when pl.es_personalizado then comision_porcentaje_personalizada(coalesce(pl.descripcion, ''))
      else null
    end as pct
  ) x
  where pl.pedido_id = p_pedido_id;

  if v_base is null or v_base = 0 then return; end if;

  update comision_devengo
     set base_comisionable = v_base,
         monto = round(v_monto, 2),
         porcentaje = round(v_monto / v_base, 4),
         tiene_personalizado_comisionable = v_tiene_personalizado
   where id = v_devengo.id;
end;
$$;

-- 1) Pedidos con líneas personalizadas que hoy NO tienen devengo (antes su base daba 0
--    porque las personalizadas no sumaban nada) — comision_registrar_pedido ya usa la
--    lógica nueva, así que esto los registra de cero si ahora corresponde.
select comision_registrar_pedido(pd.id)
from pedido pd
where pd.estado = 'COMPLETADO' and pd.categoria <> 'TIENDA'
  and exists (select 1 from pedido_linea pl where pl.pedido_id = pd.id and pl.es_personalizado)
  and not exists (select 1 from comision_devengo cd where cd.pedido_id = pd.id);

-- 2) Pedidos que ya tienen devengo — recalcular en el lugar, solo si sigue POTENCIAL
--    (la función de arriba ya lo verifica; el WHERE es una segunda guarda explícita).
select comision_recalcular_personalizado_pedido(cd.pedido_id)
from comision_devengo cd
where cd.origen = 'PEDIDO' and cd.estado = 'POTENCIAL'
  and exists (select 1 from pedido_linea pl where pl.pedido_id = cd.pedido_id and pl.es_personalizado);

-- 3) La marca visual (tiene_personalizado_comisionable) es un dato de auditoría, no de
--    dinero — a diferencia del monto, sí se completa también para DEVENGADA/LIQUIDADA
--    (Ness la quiere ver justo al momento de liquidar), sin tocar base/porcentaje/monto.
update comision_devengo cd
   set tiene_personalizado_comisionable = exists (
     select 1 from pedido_linea pl
     where pl.pedido_id = cd.pedido_id and pl.es_personalizado
       and comision_porcentaje_personalizada(coalesce(pl.descripcion, '')) is not null
   )
 where cd.origen = 'PEDIDO' and cd.estado in ('DEVENGADA', 'LIQUIDADA');

-- ============================================================================
-- Parte 2 — desglose por línea: ahora también indica si la línea es personalizada y
-- qué regla matcheó (tipo + patrón), para auditar antes de pagar.
-- ============================================================================

-- Cambia el conjunto de columnas devueltas (agrega es_personalizado/regla_tipo/
-- regla_patron) — Postgres exige borrar la función antes de recrearla con un RETURNS
-- TABLE distinto.
drop function comision_lineas_devengo(bigint);

create function comision_lineas_devengo(p_devengo_id bigint)
returns table (
  producto_id      bigint,
  producto_nombre  text,
  marca            text,
  subtotal         numeric,
  porcentaje       numeric,
  comisiona        boolean,
  es_personalizado boolean,
  regla_tipo       text,
  regla_patron     text
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
  if not comision_puede_ver(v_devengo.vendedor_email) then
    raise exception 'No autorizado';
  end if;

  if v_devengo.origen = 'PEDIDO' then
    return query
    select
      pl.producto_id,
      coalesce(p.nombre::text, coalesce(pl.descripcion, 'Ítem personalizado')),
      p.marca::text,
      pl.subtotal,
      case when pl.producto_id is not null then (comision_regla_ganadora_producto(pl.producto_id)).porcentaje
           when pl.es_personalizado then (comision_regla_ganadora_personalizada(coalesce(pl.descripcion, ''))).porcentaje
      end,
      case when pl.producto_id is not null then (comision_regla_ganadora_producto(pl.producto_id)).porcentaje is not null
           when pl.es_personalizado then (comision_regla_ganadora_personalizada(coalesce(pl.descripcion, ''))).porcentaje is not null
           else false
      end,
      coalesce(pl.es_personalizado, false),
      case when pl.producto_id is not null then (comision_regla_ganadora_producto(pl.producto_id)).tipo
           when pl.es_personalizado then (comision_regla_ganadora_personalizada(coalesce(pl.descripcion, ''))).tipo
      end,
      case when pl.producto_id is not null then (comision_regla_ganadora_producto(pl.producto_id)).patron
           when pl.es_personalizado then (comision_regla_ganadora_personalizada(coalesce(pl.descripcion, ''))).patron
      end
    from pedido_linea pl
    left join producto p on p.id = pl.producto_id
    where pl.pedido_id = v_devengo.pedido_id;
  else
    return query
    select
      vl.producto_id, p.nombre::text, p.marca::text, vl.subtotal,
      (comision_regla_ganadora_producto(vl.producto_id)).porcentaje,
      (comision_regla_ganadora_producto(vl.producto_id)).porcentaje is not null,
      false,
      (comision_regla_ganadora_producto(vl.producto_id)).tipo,
      (comision_regla_ganadora_producto(vl.producto_id)).patron
    from venta_linea vl
    join producto p on p.id = vl.producto_id
    where vl.venta_id = v_devengo.venta_id;
  end if;
end;
$$;

-- comision_regla_conteo (Fase 2, 3.8) contaba contra producto — una regla DESCRIPCION no
-- aplica a productos, así que sin este ajuste 'limpieza' se mostraría con 0 y quedaría
-- marcada en rojo como si no matcheara nada. Para DESCRIPCION cuenta líneas
-- personalizadas que matchean en vez de productos.
create or replace function comision_regla_conteo()
returns table (regla_id bigint, productos int)
language sql
stable
as $$
  select r.id,
    case when r.tipo = 'DESCRIPCION' then
      (select count(*)::int from pedido_linea pl where pl.es_personalizado and pl.descripcion ilike '%' || r.patron || '%')
    else
      (select count(*)::int from producto p where
         (r.tipo = 'MARCA' and upper(btrim(p.marca)) = upper(r.patron))
         or (r.tipo = 'NOMBRE' and p.nombre ilike '%' || r.patron || '%')
      )
    end
  from comision_regla r;
$$;

-- ============================================================================
-- Parte 4 — comision_puede_ver(vendedor_email): una sola definición de "quién ve qué",
-- reusada por la policy de comision_devengo y por las dos RPC de Fase 2
-- (comision_seguimiento, comision_lineas_devengo) en vez de reimplementar la condición
-- en cada una. Mismo patrón que se repitió cinco veces esta semana con app_metadata:
-- una condición de acceso escondida un nivel adentro que nadie sincroniza con la de al
-- lado. Se extiende también a comision_liquidacion_lectura por la misma razón, aunque
-- el brief solo nombra tres consumidores — es exactamente la misma condición.
-- ============================================================================

create or replace function comision_puede_ver(p_vendedor_email text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select comision_es_gerente() or p_vendedor_email = (select p.email from perfil p where p.id = auth.uid());
$$;

drop policy comision_devengo_lectura on comision_devengo;
create policy comision_devengo_lectura on comision_devengo for select to authenticated using (
  comision_puede_ver(vendedor_email)
);

drop policy comision_liquidacion_lectura on comision_liquidacion;
create policy comision_liquidacion_lectura on comision_liquidacion for select to authenticated using (
  comision_puede_ver(vendedor_email)
);

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
  where comision_puede_ver(cd.vendedor_email)
    and (p_desde is null or cd.documento_fecha >= p_desde)
    and (p_hasta is null or cd.documento_fecha <= p_hasta)
  group by cd.id;
end;
$$;
