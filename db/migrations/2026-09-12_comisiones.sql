-- Brief: Módulo de Comisiones, Fase 1.
-- Cubre únicamente el estado POTENCIAL (pedido COMPLETADO no-TIENDA, y venta directa
-- COMPLETADA desde ubicacion_id=31). DEVENGADA/LIQUIDADA quedan para la Fase 2, cuando
-- Hermes se consolide en este mismo proyecto (partida_abierta / pago_aplicacion).
--
-- NO aplicar a mano sin antes validar en BEGIN … ROLLBACK — Ness la aplica desde el
-- SQL editor de Cation (zxoxougwgstrarwymlvd), no Claude Code.

-- Reemplaza la colección `commissionGroups` de la app roari-comisiones (Firebase).
create table comision_regla (
  id            bigserial primary key,
  tipo          text not null check (tipo in ('MARCA','NOMBRE')),
  patron        text not null,
  accion        text not null check (accion in ('INCLUIR','EXCLUIR')),
  porcentaje    numeric(6,4) not null default 0,   -- fracción: 0.01 = 1%
  prioridad     int not null default 999,
  activo        boolean not null default true,
  nota          text,
  creado_por    text,
  creado_en     timestamptz not null default now()
);

-- Quién comisiona. Deliberadamente independiente de perfil.rol — ver brief: el rol
-- define permisos, comisionar es otra cosa, y hoy no coinciden (cuenta de mostrador con
-- rol admin, cajero que hace VTD).
create table comision_vendedor (
  perfil_id   uuid primary key references perfil(id),
  activo      boolean not null default true,
  desde       date not null default current_date,
  nota        text,
  creado_en   timestamptz not null default now()
);

-- El núcleo: una fila por documento comisionable. El monto se congela al calcularse —
-- una regla nueva aplica de ahí en adelante, nunca reescribe lo ya calculado.
create table comision_devengo (
  id                 bigserial primary key,
  origen             text not null check (origen in ('PEDIDO','VTD')),
  pedido_id          bigint references pedido(id),
  venta_id           bigint references venta(id),
  vendedor_email     text not null,
  documento_fecha    date not null,
  base_comisionable  numeric(14,2) not null,
  total_documento    numeric(14,2) not null,
  porcentaje         numeric(6,4) not null,
  monto              numeric(14,2) not null,
  estado             text not null default 'POTENCIAL'
                       check (estado in ('POTENCIAL','DEVENGADA','LIQUIDADA','ANULADA')),
  calculado_en       timestamptz not null default now(),
  devengado_en       timestamptz,
  -- Sin FK a propósito: comision_liquidacion llega en Fase 2.
  liquidacion_id     bigint,
  constraint devengo_un_origen check (
    (origen='PEDIDO' and pedido_id is not null and venta_id is null) or
    (origen='VTD'    and venta_id  is not null and pedido_id is null)
  ),
  constraint devengo_unico_pedido unique (pedido_id),
  constraint devengo_unico_venta  unique (venta_id)
);

create index comision_devengo_vendedor_fecha_idx on comision_devengo (vendedor_email, documento_fecha);

-- creado_por quedó sucio hasta el 26/08 ("Gabriel", "Rony", "mamanicristian865" en vez
-- de emails) — este mapeo lo resuelve sin ensuciar comision_vendedor_resolver con casos
-- especiales permanentes. Solo importa para el backfill histórico; desde el 26/08 en
-- adelante pedido.creado_por / venta.creado_por ya vienen como emails limpios.
create table comision_creado_por_alias (
  alias  text primary key,
  email  text not null
);
insert into comision_creado_por_alias (alias, email) values
  ('Gabriel', 'gabrieloni62@gmail.com'),
  ('Rony', 'piterali.argana@gmail.com'),
  ('mamanicristian865', 'mamanicristian865@gmail.com');

-- Resuelve creado_por (texto libre) -> email de un comision_vendedor activo, o null si
-- no resuelve. "No se crea la fila de devengo" cuando esto da null — nunca se inventa
-- un dueño (ver brief, incluye el caso 'pos', sin alias y sin match directo).
create or replace function comision_vendedor_resolver(p_creado_por text)
returns text
language sql
stable
as $$
  select p.email
  from perfil p
  join comision_vendedor cv on cv.perfil_id = p.id and cv.activo
  where lower(p.email) = lower(btrim(coalesce(
    (select a.email from comision_creado_por_alias a where lower(a.alias) = lower(btrim(p_creado_por))),
    p_creado_por
  )))
  limit 1;
$$;

-- Porcentaje de comisión aplicable a un producto, o null si ninguna regla INCLUIR
-- matchea (o si una regla EXCLUIR gana). Implementa evaluateItemCommission de la app
-- vieja: EXCLUIR gana siempre; entre INCLUIR, gana la prioridad más baja, y a igual
-- prioridad MARCA le gana a NOMBRE (una marca es una afirmación más fuerte que un
-- substring de nombre).
create or replace function comision_porcentaje_producto(p_producto_id bigint)
returns numeric
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
  select r.porcentaje
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

-- Calcula y registra (si corresponde) el devengo POTENCIAL de un pedido. Idempotente:
-- no hace nada si el pedido no califica, si el vendedor no resuelve, si no hay líneas
-- comisionables, o si ya existe la fila (una regla nueva nunca reescribe lo congelado).
create or replace function comision_registrar_pedido(p_pedido_id bigint)
returns void
language plpgsql
as $$
declare
  v_vendedor text;
  v_fecha date;
  v_total numeric(14,2);
  v_base numeric(14,2);
  v_monto numeric(14,2);
begin
  if exists (select 1 from comision_devengo where pedido_id = p_pedido_id) then return; end if;

  select comision_vendedor_resolver(pd.creado_por), pd.creado_en::date, coalesce(pd.total, 0)
    into v_vendedor, v_fecha, v_total
  from pedido pd
  where pd.id = p_pedido_id and pd.estado = 'COMPLETADO' and pd.categoria <> 'TIENDA';

  if v_vendedor is null then return; end if;

  select coalesce(sum(pl.subtotal), 0), coalesce(sum(pl.subtotal * comision_porcentaje_producto(pl.producto_id)), 0)
    into v_base, v_monto
  from pedido_linea pl
  where pl.pedido_id = p_pedido_id and comision_porcentaje_producto(pl.producto_id) is not null;

  if v_base is null or v_base = 0 then return; end if;

  insert into comision_devengo (origen, pedido_id, vendedor_email, documento_fecha, base_comisionable, total_documento, porcentaje, monto)
  values ('PEDIDO', p_pedido_id, v_vendedor, v_fecha, v_base, v_total, round(v_monto / v_base, 4), round(v_monto, 2))
  on conflict (pedido_id) do nothing;
end;
$$;

-- Mismo cálculo para venta directa (VTD). ubicacion_id=31 hardcodeado a propósito con
-- deuda técnica anotada: identificar la VTD por la ubicación de despacho es frágil — si
-- mañana despacha desde otra zona, deja de comisionar en silencio. Debería resolverse
-- contra ubicacion.codigo_zona = 'VENTAS DIRECTAS' (ver brief), o mejor aún una marca
-- explícita en venta — queda pendiente para no ampliar el alcance de Fase 1.
create or replace function comision_registrar_venta(p_venta_id bigint)
returns void
language plpgsql
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

  insert into comision_devengo (origen, venta_id, vendedor_email, documento_fecha, base_comisionable, total_documento, porcentaje, monto)
  values ('VTD', p_venta_id, v_vendedor, v_fecha, v_base, v_total, round(v_monto / v_base, 4), round(v_monto, 2))
  on conflict (venta_id) do nothing;
end;
$$;

create or replace function comision_trigger_pedido()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'COMPLETADO' and (TG_OP = 'INSERT' or old.estado is distinct from new.estado) then
    perform comision_registrar_pedido(new.id);
  end if;
  return new;
end;
$$;

create trigger comision_pedido_completado
  after insert or update on pedido
  for each row execute function comision_trigger_pedido();

create or replace function comision_trigger_venta()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'COMPLETADA' and (TG_OP = 'INSERT' or old.estado is distinct from new.estado) then
    perform comision_registrar_venta(new.id);
  end if;
  return new;
end;
$$;

create trigger comision_venta_completada
  after insert or update on venta
  for each row execute function comision_trigger_venta();

alter table comision_creado_por_alias enable row level security;
create policy comision_creado_por_alias_admin_lectura on comision_creado_por_alias for select to authenticated using (app_es_admin());

alter table comision_regla enable row level security;
alter table comision_vendedor enable row level security;
alter table comision_devengo enable row level security;

-- comision_regla / comision_vendedor: lectura a cualquier sesión autenticada,
-- escritura solo admin. Mismo patrón que perfil_select / perfil_admin_write.
create policy comision_regla_lectura on comision_regla for select to authenticated using (true);
create policy comision_regla_admin_write on comision_regla for insert to authenticated with check (app_es_admin());
create policy comision_regla_admin_update on comision_regla for update to authenticated using (app_es_admin()) with check (app_es_admin());
create policy comision_regla_admin_delete on comision_regla for delete to authenticated using (app_es_admin());

create policy comision_vendedor_lectura on comision_vendedor for select to authenticated using (true);
create policy comision_vendedor_admin_write on comision_vendedor for insert to authenticated with check (app_es_admin());
create policy comision_vendedor_admin_update on comision_vendedor for update to authenticated using (app_es_admin()) with check (app_es_admin());
create policy comision_vendedor_admin_delete on comision_vendedor for delete to authenticated using (app_es_admin());

-- comision_devengo: es plata de la gente — cada vendedor ve solo sus filas, admin ve
-- todas. La restricción vive en la base, no solo en la UI.
create policy comision_devengo_lectura on comision_devengo for select to authenticated using (
  app_es_admin() or vendedor_email = (select p.email from perfil p where p.id = auth.uid())
);
-- Escritura reservada al backend (service role / funciones futuras) — nadie escribe
-- comision_devengo desde el cliente en Fase 1, ni admin.

-- Reporte de "productos huérfanos" (pantalla Reglas, solo admin): líneas de documentos
-- comisionables cuyo producto NO matchea ninguna regla. Sin RLS propia — corre bajo los
-- permisos de quien consulta contra pedido/venta/producto (mismo patrón que las vistas
-- v_reporte_* de Reportes, ya abiertas a cualquier sesión autenticada); el gate a
-- "solo admin" es de UI, igual que el resto de las secciones admin-only de este módulo.
create or replace view v_comision_huerfano_linea as
select pl.producto_id, p.nombre as producto_nombre, p.marca, pd.creado_en::date as fecha, pl.subtotal as monto
from pedido_linea pl
join pedido pd on pd.id = pl.pedido_id
join producto p on p.id = pl.producto_id
where pd.estado = 'COMPLETADO' and pd.categoria <> 'TIENDA'
  and pl.producto_id is not null
  and comision_porcentaje_producto(pl.producto_id) is null
union all
select vl.producto_id, p.nombre, p.marca, v.creado_en::date, vl.subtotal
from venta_linea vl
join venta v on v.id = vl.venta_id
join producto p on p.id = vl.producto_id
where v.estado = 'COMPLETADA' and v.ubicacion_id = 31
  and comision_porcentaje_producto(vl.producto_id) is null;
