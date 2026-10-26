-- SEL-01 · Ampliación de pedidos transaccional e idempotente.
--
-- Antes: el Seller agregaba líneas en Cation (agregar_lineas_pedido) y después, en otra
-- petición, cargaba el monto en la cartera (hermes.procesar_adicion_pedido). Si fallaba el
-- segundo paso las líneas quedaban sin cargo, y un reintento las duplicaba. Además, un
-- pedido ya pagado (sin partida ABIERTA) no podía ampliarse.
--
-- Ahora: public.ampliar_pedido hace las dos cosas en una sola transacción, con una clave
-- de idempotencia que entrega el frontend y un control opcional de versión del pedido.
-- Pedido sin partida abierta (pagado): nace una partida hija "Entrega N" por lo agregado;
-- la partida pagada no se reabre.
--
-- hermes.procesar_adicion_pedido (usado por el Conciliador) NO se toca.

create table if not exists public.pedido_ampliacion (
  clave      uuid primary key,
  pedido_id  bigint not null references public.pedido(id),
  huella     text not null,
  resultado  jsonb not null,
  usuario    text,
  creado_en  timestamptz not null default now()
);
create index if not exists pedido_ampliacion_pedido_idx on public.pedido_ampliacion(pedido_id);
alter table public.pedido_ampliacion enable row level security;
revoke all on public.pedido_ampliacion from public, anon, authenticated;

-- Núcleo de cartera. Sin chequeo de rol: solo lo invocan funciones que ya validaron.
create or replace function hermes._aplicar_ampliacion_pedido(
  p_pedido_id bigint, p_monto numeric, p_motivo text, p_usuario text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, hermes, public
as $$
declare
  v_actual      hermes.partida_abierta%rowtype;
  v_hija        boolean := false;
  v_nueva_id    bigint;
  v_doc         text;
  v_entrega_num integer;
  v_raiz_id     bigint;
  v_camino      text;
  v_reabiertos  int := 0;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto_adicional debe ser positivo';
  end if;
  if p_clave is null or btrim(p_clave) = '' then
    raise exception 'La ampliación requiere una clave de idempotencia';
  end if;

  select * into v_actual
    from hermes.partida_abierta
   where pedido_id = p_pedido_id and estado = 'ABIERTA'
   order by entrega_numero desc, id desc
   limit 1
   for update;

  if v_actual.id is null then
    -- Pedido pagado (o cerrado): se toma la última partida vigente como madre.
    select * into v_actual
      from hermes.partida_abierta
     where pedido_id = p_pedido_id and estado not in ('ANULADA', 'CANCELADA')
     order by entrega_numero desc, id desc
     limit 1
     for update;
    if v_actual.id is null then
      raise exception 'El pedido % no tiene partidas vigentes en la cartera', p_pedido_id;
    end if;
    v_hija := true;
  end if;

  if v_actual.fecha_entrega is null and not v_hija then
    v_camino := 'MISMA_PARTIDA';

    update hermes.partida_abierta set total = total + p_monto where id = v_actual.id;

    insert into hermes.movimiento_cuenta (
      cliente_id, partida_id, tipo, monto, idempotencia_clave,
      fecha_efectiva, referencia, motivo, creado_por
    ) values (
      v_actual.cliente_id, v_actual.id, 'CARGO', p_monto,
      'ampliacion-' || p_clave,
      (now() at time zone 'America/La_Paz')::date, v_actual.documento_interno,
      coalesce(p_motivo, 'Ítems agregados al pedido'), p_usuario
    );

    -- Igual que procesar_adicion_pedido: cambió el monto, los habilitantes aprobados se revisan otra vez.
    with reabiertos as (
      update hermes.documento d
         set estado = 'PENDIENTE', revisado_por = null, revisado_en = null,
             notas = coalesce(d.notas || ' · ', '') || '[Reabierto automáticamente: el monto de la partida cambió]'
        from hermes.hito h
        join hermes.hito_plantilla hp on hp.id = h.hito_plantilla_id
       where d.hito_id = h.id
         and h.partida_abierta_id = v_actual.id
         and hp.fase = 'PREVIA'
         and d.tipo = 'HABILITANTE'
         and d.estado = 'APROBADO'
      returning d.id
    )
    select count(*) into v_reabiertos from reabiertos;

    update hermes.hito h
       set estado = 'PENDIENTE', completado_en = null, completado_por = null
      from hermes.hito_plantilla hp
     where h.hito_plantilla_id = hp.id
       and h.partida_abierta_id = v_actual.id
       and hp.fase = 'PREVIA'
       and h.estado = 'COMPLETO'
       and exists (select 1 from hermes.documento d where d.hito_id = h.id and d.estado = 'PENDIENTE');

    v_nueva_id := v_actual.id;
    v_entrega_num := v_actual.entrega_numero;
    v_doc := v_actual.documento_interno;
  else
    v_camino := 'PARTIDA_HIJA';
    v_raiz_id := coalesce(v_actual.partida_raiz_id, v_actual.id);

    -- Numerar contra todas las entregas de la raíz (incluidas anuladas) para no chocar
    -- con el documento_interno único.
    select coalesce(max(entrega_numero), 0) + 1 into v_entrega_num
      from hermes.partida_abierta where partida_raiz_id = v_raiz_id or id = v_raiz_id;
    select documento_interno || ' · Entrega ' || v_entrega_num into v_doc
      from hermes.partida_abierta where id = v_raiz_id;

    insert into hermes.partida_abierta (
      cliente_id, cliente_nombre, cliente_nit, cliente_categoria,
      pedido_id, documento_interno, total,
      inicio_computo, plazo_dias, referencia, creado_por,
      solicitante_id, solicitante_nombre,
      parent_partida_id, partida_raiz_id, entrega_numero
    ) values (
      v_actual.cliente_id, v_actual.cliente_nombre, v_actual.cliente_nit, v_actual.cliente_categoria,
      p_pedido_id, v_doc, p_monto,
      v_actual.inicio_computo, v_actual.plazo_dias, v_actual.referencia, p_usuario,
      v_actual.solicitante_id, v_actual.solicitante_nombre,
      v_actual.id, v_raiz_id, v_entrega_num
    )
    returning id into v_nueva_id;

    insert into hermes.movimiento_cuenta (
      cliente_id, partida_id, tipo, monto, idempotencia_clave,
      fecha_efectiva, referencia, motivo, creado_por
    ) values (
      v_actual.cliente_id, v_nueva_id, 'CARGO', p_monto,
      'ampliacion-' || p_clave,
      (now() at time zone 'America/La_Paz')::date, v_doc,
      coalesce(p_motivo, 'Ampliación del pedido'), p_usuario
    );
  end if;

  return jsonb_build_object(
    'camino', v_camino,
    'partida_id', v_nueva_id,
    'partida_madre_estado', v_actual.estado::text,
    'entrega_numero', v_entrega_num,
    'documento_interno', v_doc,
    'habilitantes_reabiertos', v_reabiertos
  );
end;
$$;

revoke all on function hermes._aplicar_ampliacion_pedido(bigint, numeric, text, text, text)
  from public, anon, authenticated, service_role;

-- Punto de entrada único del Seller.
create or replace function public.ampliar_pedido(
  p_pedido_id bigint,
  p_clave uuid,
  p_lineas jsonb,
  p_motivo text default null,
  p_version_esperada integer default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_usuario  text;
  v_motivo   text := nullif(btrim(p_motivo), '');
  v_huella   text;
  v_prev     public.pedido_ampliacion%rowtype;
  v_version  integer;
  v_lineas   jsonb;
  v_monto    numeric;
  v_cartera  jsonb;
  v_out      jsonb;
begin
  if not public.app_puede_inventariar() then
    raise exception 'Tu usuario no puede ampliar pedidos.' using errcode = '42501';
  end if;
  if p_clave is null then
    raise exception 'Falta la clave de la ampliación' using errcode = '22023';
  end if;

  v_usuario := coalesce(nullif(auth.jwt() ->> 'email', ''), auth.uid()::text);
  v_huella := md5(p_pedido_id::text || '|' || coalesce(p_lineas::text, '') || '|' || coalesce(v_motivo, ''));

  -- 1) Misma clave = misma ampliación: se devuelve el resultado guardado.
  perform pg_advisory_xact_lock(hashtextextended('pedido-ampliacion:' || p_clave::text, 0));
  select * into v_prev from public.pedido_ampliacion where clave = p_clave;
  if found then
    if v_prev.pedido_id <> p_pedido_id or v_prev.huella <> v_huella then
      raise exception 'Esta clave ya se usó para otra ampliación' using errcode = 'PT409';
    end if;
    return v_prev.resultado || jsonb_build_object('repetida', true);
  end if;

  -- 2) Un pedido se amplía de a uno; el mismo candado usa la sincronización con la cartera.
  perform pg_advisory_xact_lock(hashtextextended('hermes-pedido:' || p_pedido_id, 0));
  perform 1 from public.pedido where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido % no existe', p_pedido_id;
  end if;

  select coalesce(max(version), 0) into v_version from public.pedido_version where pedido_id = p_pedido_id;
  if p_version_esperada is not null and v_version <> p_version_esperada then
    raise exception 'El pedido cambió mientras lo editabas (versión % en vez de %). Recargalo y volvé a intentar.',
      v_version, p_version_esperada using errcode = 'PT409';
  end if;

  -- 3) Líneas en Cation (mismas validaciones de siempre).
  v_lineas := public.agregar_lineas_pedido(p_pedido_id, p_lineas, v_motivo, v_usuario);
  v_monto := coalesce((v_lineas ->> 'monto_adicional')::numeric, 0);

  -- 4) Cargo en la cartera, dentro de la misma transacción. Si falla, se revierte todo.
  --    Pedido de cliente de cartera sin partida todavía: el disparador diferido
  --    hermes_pedido_automatico la abre al confirmar, ya con el total nuevo.
  if v_monto > 0 and exists (
    select 1 from hermes.partida_abierta
     where pedido_id = p_pedido_id and estado not in ('ANULADA', 'CANCELADA')) then
    v_cartera := hermes._aplicar_ampliacion_pedido(p_pedido_id, v_monto, v_motivo, v_usuario, p_clave::text);
  end if;

  select coalesce(max(version), 0) into v_version from public.pedido_version where pedido_id = p_pedido_id;

  v_out := jsonb_build_object(
    'pedido_id', p_pedido_id,
    'lineas_agregadas', (v_lineas ->> 'lineas_agregadas')::int,
    'monto_adicional', v_monto,
    'version', v_version,
    'camino', v_cartera ->> 'camino',
    'partida_id', (v_cartera ->> 'partida_id')::bigint,
    'entrega_numero', (v_cartera ->> 'entrega_numero')::int,
    'documento_interno', v_cartera ->> 'documento_interno',
    'habilitantes_reabiertos', coalesce((v_cartera ->> 'habilitantes_reabiertos')::int, 0)
  );

  insert into public.pedido_ampliacion (clave, pedido_id, huella, resultado, usuario)
  values (p_clave, p_pedido_id, v_huella, v_out, v_usuario);

  return v_out || jsonb_build_object('repetida', false);
end;
$$;

revoke all on function public.ampliar_pedido(bigint, uuid, jsonb, text, integer) from public, anon;
grant execute on function public.ampliar_pedido(bigint, uuid, jsonb, text, integer) to authenticated, service_role;
