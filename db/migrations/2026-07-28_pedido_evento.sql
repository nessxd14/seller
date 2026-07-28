-- Ronda 9 (POS) — TAREA 2: bitácora de anulación/restauración de pedidos.
--
-- pedido.estado ya soporta ABIERTO | COMPLETADO | CANCELADO. Anular = pasar a
-- CANCELADO; restaurar = volver al estado que tenía antes (no siempre
-- ABIERTO — un pedido COMPLETADO anulado por error tiene que volver a
-- COMPLETADO). Nunca se borra la fila de pedido: se llevaría sus líneas, su
-- historial de despacho y cualquier movimiento de Kardex asociado.
--
-- Este archivo NO fue corrido en BEGIN … ROLLBACK contra la base viva por
-- quien lo generó (solo se hizo una lectura de esquema, ver nota más abajo).
-- Las funciones anular_pedido/restaurar_pedido son nuevas: probalas en
-- BEGIN … ROLLBACK antes de aplicar de verdad — en particular el ciclo
-- anular → restaurar (2 eventos, estado final = el previo a la anulación) y
-- el rechazo de pedidos con líneas despachadas.
--
-- Decisión operativa (confirmada con Ness, 2026-07-28): un pedido con líneas
-- ya despachadas (pedido_linea.estado IN ('DESPACHADA','COMPRADO_DIRECTO')) NO
-- se puede anular — camino (a) del brief: simple y seguro, evita dejar un
-- pedido CANCELADO con mercadería que efectivamente salió. anular_pedido()
-- lo rechaza server-side; la UI también lo bloquea antes de intentarlo.
--
-- OJO — verificado por lectura (information_schema/pg_catalog, sin escrituras)
-- contra la base viva el 2026-07-28: la tabla `pedido_evento` YA EXISTE en
-- producción, con `estado_previo` tipado como el enum `estado_pedido` (no
-- `text` como se asumía al escribir este archivo) y con políticas RLS propias
-- (`auth_all`/`dev_anon_all`, más permisivas que las de abajo). El CREATE
-- TABLE/POLICY de acá abajo ya se ajustó a ese tipo real y es un no-op seguro
-- si se corre de nuevo (IF NOT EXISTS / políticas con nombre propio, sin
-- choque). Lo que SÍ falta y este archivo agrega de verdad: las funciones
-- anular_pedido/restaurar_pedido — no existían todavía.
--
-- NO APLICAR sin OK explícito de Ness. Este archivo solo se genera; no se
-- ejecuta desde este brief.

create table if not exists pedido_evento (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references pedido(id),
  accion text not null check (accion in ('ANULADO', 'RESTAURADO')),
  motivo text not null,
  estado_previo estado_pedido not null,
  usuario text not null,
  creado_en timestamptz not null default now()
);

create index if not exists idx_pedido_evento_pedido on pedido_evento(pedido_id, creado_en desc);

alter table pedido_evento enable row level security;

create policy "pedido_evento_select_authenticated" on pedido_evento
  for select to authenticated using (true);

create policy "pedido_evento_insert_authenticated" on pedido_evento
  for insert to authenticated with check (true);

-- Anular: exige motivo, exige que ninguna línea tenga salida física
-- (DESPACHADA/COMPRADO_DIRECTO), y escribe el cambio de estado + la fila de
-- bitácora en una sola transacción (evita quedar con el estado cambiado y
-- sin registro, o viceversa).
create or replace function anular_pedido(p_pedido_id bigint, p_motivo text, p_usuario text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_actual pedido.estado%type;
  v_despachadas int;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select estado into v_estado_actual from pedido where id = p_pedido_id for update;
  if v_estado_actual is null then
    raise exception 'Pedido % no existe', p_pedido_id;
  end if;
  if v_estado_actual = 'CANCELADO' then
    raise exception 'El pedido ya está anulado';
  end if;

  select count(*) into v_despachadas
  from pedido_linea
  where pedido_id = p_pedido_id and estado in ('DESPACHADA', 'COMPRADO_DIRECTO');
  if v_despachadas > 0 then
    raise exception 'No se puede anular: tiene % línea(s) ya despachada(s)', v_despachadas;
  end if;

  update pedido set estado = 'CANCELADO' where id = p_pedido_id;
  insert into pedido_evento (pedido_id, accion, motivo, estado_previo, usuario)
    values (p_pedido_id, 'ANULADO', p_motivo, v_estado_actual, p_usuario);
end;
$$;

-- Restaurar: vuelve al estado_previo registrado en el último evento ANULADO
-- de este pedido — no siempre ABIERTO.
create or replace function restaurar_pedido(p_pedido_id bigint, p_motivo text, p_usuario text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_actual pedido.estado%type;
  v_estado_previo pedido.estado%type;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio';
  end if;

  select estado into v_estado_actual from pedido where id = p_pedido_id for update;
  if v_estado_actual is null then
    raise exception 'Pedido % no existe', p_pedido_id;
  end if;
  if v_estado_actual <> 'CANCELADO' then
    raise exception 'El pedido no está anulado';
  end if;

  select estado_previo into v_estado_previo
  from pedido_evento
  where pedido_id = p_pedido_id and accion = 'ANULADO'
  order by creado_en desc
  limit 1;
  if v_estado_previo is null then
    raise exception 'No se encontró el estado previo a la anulación';
  end if;

  update pedido set estado = v_estado_previo where id = p_pedido_id;
  insert into pedido_evento (pedido_id, accion, motivo, estado_previo, usuario)
    values (p_pedido_id, 'RESTAURADO', p_motivo, v_estado_actual, p_usuario);
end;
$$;

grant execute on function anular_pedido(bigint, text, text) to authenticated;
grant execute on function restaurar_pedido(bigint, text, text) to authenticated;
