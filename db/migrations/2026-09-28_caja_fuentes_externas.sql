-- Brief Caja-2 — External sources now point to the Seller (Parts A y B; Parte C es
-- una spec para el scraper de BNB, proyecto separado; Parte D es un checklist
-- operativo, va en la descripción del PR).
--
-- NO APLICAR sin validar antes en BEGIN…ROLLBACK. Ness la valida y la aplica a mano.
-- El PR del frontend no debe mergearse hasta que esta migración exista en la base.
--
-- Verificado contra la base viva (proyecto zxoxougwgstrarwymlvd) el 2026-09-26:
--   * notificacion_pendiente/notificacion_canal/worker_latido ya existen — se REUSAN
--     tal cual, no se tocan sus columnas ni sus defaults.
--   * ya existe public.notificar(p_canal_clave, p_evento_tipo, p_payload,
--     p_idempotencia_clave) — SECURITY DEFINER, upsert-idempotente sobre
--     notificacion_pendiente (on conflict (idempotencia_clave) do nothing), granted a
--     authenticated y service_role. caja_notificar() de más abajo es un wrapper fino
--     sobre esa función existente, no una reimplementación — se le agrega la garantía
--     "nunca falla la transacción que la llama" (A4) y se la deja SIN grant a
--     authenticated (solo la llaman triggers SECURITY DEFINER, que corren como el
--     dueño de la función — normalmente postgres — y no necesitan el GRANT).
--   * canales ya dados de alta en notificacion_canal: sesiones, pagos, aprobaciones,
--     alertas, salud (entre otros) — no hace falta crearlos.
--
-- Convenciones del proyecto seguidas acá (mismas que 2026-09-27_caja_turno_cajero.sql):
--   * cada función nueva o reemplazada trae su propio
--     REVOKE ALL ... FROM anon, public; GRANT EXECUTE ... TO authenticated, service_role
--     (o solo service_role cuando el brief lo restringe explícitamente).
--   * toda tabla nueva: RLS habilitado, sin acceso a anon, una sola policy ALL para
--     authenticated (el control fino vive en las funciones SECURITY DEFINER).
--   * ningún parámetro de usuario/identidad es de confianza: sale de auth.uid() +
--     perfil / app_rol_actual() / app_es_admin().
--   * NINGUNA función de Caja-1 se toca (abrir_turno, cerrar_turno,
--     registrar_movimiento_turno, resolver_gasto, revisar_turno,
--     registrar_arqueo_sorpresa, faltantes_resolver, _registrar_venta_nucleo,
--     resumen_turno) — las notificaciones se enganchan con triggers (A4), no
--     reemplazando esas funciones.

-- ============================================================================
-- A1. Movimientos bancarios (BNB QR)
-- ============================================================================

create table if not exists banco_qr_movimiento (
  id bigint generated always as identity primary key,
  banco_id text not null,
  importe numeric not null,
  fecha_transaccion timestamptz not null,
  estado_banco text not null,
  originante text null,
  glosa text null,
  raw jsonb not null,
  capturado_en timestamptz not null default now(),
  venta_pago_id bigint null references venta_pago(id),
  vinculado_en timestamptz null,
  vinculado_por text null
);

create unique index if not exists banco_qr_movimiento_banco_id_uidx on banco_qr_movimiento (banco_id);
create unique index if not exists banco_qr_movimiento_venta_pago_uidx
  on banco_qr_movimiento (venta_pago_id) where venta_pago_id is not null;
create index if not exists banco_qr_movimiento_sin_vincular_idx
  on banco_qr_movimiento (fecha_transaccion) where venta_pago_id is null;

alter table banco_qr_movimiento enable row level security;
revoke all on banco_qr_movimiento from anon;
drop policy if exists banco_qr_movimiento_auth_all on banco_qr_movimiento;
create policy banco_qr_movimiento_auth_all on banco_qr_movimiento for all to authenticated using (true) with check (true);

-- ============================================================================
-- A2. Verificación de pagos QR/transferencia
-- ============================================================================

-- Callable SOLO por service_role — el endpoint de ingesta (A3) es el único llamador.
-- Ni siquiera authenticated puede invocarla (a diferencia del resto de las funciones
-- de este archivo): el scraper nunca tiene una sesión de usuario del Seller.
drop function if exists public.ingestar_pagos_qr(jsonb, text);

create function public.ingestar_pagos_qr(p_movimientos jsonb, p_version text default null) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mov jsonb;
  v_recibidos int := 0;
  v_nuevos int := 0;
  v_es_nuevo boolean;
  v_banco_id text;
  v_conciliacion jsonb;
begin
  if p_movimientos is null or jsonb_typeof(p_movimientos) <> 'array' then
    raise exception 'p_movimientos debe ser un array (puede ser vacío: [] es el latido)';
  end if;

  for v_mov in select * from jsonb_array_elements(p_movimientos) loop
    v_recibidos := v_recibidos + 1;
    v_banco_id := v_mov->>'banco_id';
    -- Fila sin banco_id no se puede upsertear de forma idempotente — se descarta sin
    -- abortar el resto de la tanda (el endpoint A3 ya valida el shape antes de llamar
    -- acá; esto es una segunda red de seguridad, no la validación principal).
    if v_banco_id is null or btrim(v_banco_id) = '' then
      continue;
    end if;

    insert into banco_qr_movimiento (banco_id, importe, fecha_transaccion, estado_banco, originante, glosa, raw)
    values (
      v_banco_id,
      (v_mov->>'importe')::numeric,
      (v_mov->>'fecha_transaccion')::timestamptz,
      v_mov->>'estado',
      v_mov->>'originante',
      v_mov->>'glosa',
      coalesce(v_mov->'raw', v_mov)
    )
    on conflict (banco_id) do update
       set estado_banco = excluded.estado_banco, raw = excluded.raw
    returning (xmax = 0) into v_es_nuevo;

    if v_es_nuevo then v_nuevos := v_nuevos + 1; end if;
  end loop;

  -- Esto corre también con el array vacío — es el latido del worker (A5 lo vigila).
  insert into worker_latido (worker, ultimo_latido, ultimo_resultado, corridas)
  values ('bnb-qr', now(), jsonb_build_object('recibidos', v_recibidos, 'nuevos', v_nuevos, 'version', p_version), 1)
  on conflict (worker) do update
     set ultimo_latido = excluded.ultimo_latido, ultimo_resultado = excluded.ultimo_resultado,
         corridas = worker_latido.corridas + 1;

  v_conciliacion := conciliar_pagos_qr();

  return jsonb_build_object(
    'recibidos', v_recibidos,
    'nuevos', v_nuevos,
    'verificados', coalesce((v_conciliacion->>'verificados')::int, 0)
  );
end;
$function$;

revoke all on function public.ingestar_pagos_qr(jsonb, text) from anon, public, authenticated;
grant execute on function public.ingestar_pagos_qr(jsonb, text) to service_role;

drop function if exists public.conciliar_pagos_qr();

create function public.conciliar_pagos_qr() returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_verificados int := 0;
  v_pendientes int;
  v_sin_venta int;
  v_pago record;
  v_mov_id bigint;
  v_banco_id text;
  v_candidatos int;
  v_otro_lado int;
begin
  -- Candidatos: venta_pago QR PENDIENTE contra movimientos "Pagado" todavía sin
  -- vincular. Match estricto (brief A2): diferencia < 0.01, ventana de tiempo
  -- [completado_en - 2min, completado_en + 10min], único en ambas direcciones.
  for v_pago in
    select vp.id as pago_id, vp.monto, v.completado_en
      from venta_pago vp
      join venta v on v.id = vp.venta_id
     where vp.metodo = 'QR' and vp.estado_verificacion = 'PENDIENTE'
  loop
    select count(*) into v_candidatos
      from banco_qr_movimiento m
     where m.venta_pago_id is null
       and m.estado_banco = 'Pagado'
       and abs(m.importe - v_pago.monto) < 0.01
       and m.fecha_transaccion between v_pago.completado_en - interval '2 minutes'
                                   and v_pago.completado_en + interval '10 minutes';

    if v_candidatos <> 1 then
      continue; -- 0 = sin match; >1 = ambiguo, queda PENDIENTE para el gerente
    end if;

    select m.id, m.banco_id into v_mov_id, v_banco_id
      from banco_qr_movimiento m
     where m.venta_pago_id is null
       and m.estado_banco = 'Pagado'
       and abs(m.importe - v_pago.monto) < 0.01
       and m.fecha_transaccion between v_pago.completado_en - interval '2 minutes'
                                   and v_pago.completado_en + interval '10 minutes';

    -- Único también en la otra dirección: ese movimiento no debe calzar con más de
    -- un pago QR pendiente.
    select count(*) into v_otro_lado
      from venta_pago vp2
      join venta v2 on v2.id = vp2.venta_id
      join banco_qr_movimiento m2 on m2.id = v_mov_id
     where vp2.metodo = 'QR' and vp2.estado_verificacion = 'PENDIENTE'
       and abs(m2.importe - vp2.monto) < 0.01
       and m2.fecha_transaccion between v2.completado_en - interval '2 minutes'
                                     and v2.completado_en + interval '10 minutes';

    if v_otro_lado <> 1 then
      continue;
    end if;

    update venta_pago
       set estado_verificacion = 'VERIFICADO', verificado_en = now(), verificado_por = 'auto:bnb', referencia = v_banco_id
     where id = v_pago.pago_id;
    update banco_qr_movimiento
       set venta_pago_id = v_pago.pago_id, vinculado_en = now(), vinculado_por = 'auto:bnb'
     where id = v_mov_id;

    v_verificados := v_verificados + 1;
  end loop;

  select count(*) into v_pendientes from venta_pago where metodo = 'QR' and estado_verificacion = 'PENDIENTE';
  select count(*) into v_sin_venta from banco_qr_movimiento where venta_pago_id is null and estado_banco = 'Pagado';

  return jsonb_build_object('verificados', v_verificados, 'pendientes', v_pendientes, 'movimientos_sin_venta', v_sin_venta);
end;
$function$;

revoke all on function public.conciliar_pagos_qr() from anon, public, authenticated;
grant execute on function public.conciliar_pagos_qr() to service_role;

drop function if exists public.vincular_pago_qr(bigint, bigint);

create function public.vincular_pago_qr(p_venta_pago_id bigint, p_banco_mov_id bigint) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_perfil perfil%rowtype;
  v_banco_id text;
begin
  if not app_es_admin() then raise exception 'Solo un gerente puede vincular pagos'; end if;
  select * into v_perfil from perfil where id = auth.uid();

  select banco_id into v_banco_id from banco_qr_movimiento where id = p_banco_mov_id and venta_pago_id is null for update;
  if not found then raise exception 'Movimiento bancario % no existe o ya está vinculado', p_banco_mov_id; end if;

  perform 1 from venta_pago where id = p_venta_pago_id and estado_verificacion = 'PENDIENTE' for update;
  if not found then raise exception 'Pago % no existe o no está pendiente de verificación', p_venta_pago_id; end if;

  update venta_pago
     set estado_verificacion = 'VERIFICADO', verificado_en = now(), verificado_por = coalesce(v_perfil.email, 'gerente'), referencia = v_banco_id
   where id = p_venta_pago_id;
  update banco_qr_movimiento
     set venta_pago_id = p_venta_pago_id, vinculado_en = now(), vinculado_por = coalesce(v_perfil.email, 'gerente')
   where id = p_banco_mov_id;

  return jsonb_build_object('venta_pago_id', p_venta_pago_id, 'banco_mov_id', p_banco_mov_id, 'estado', 'VERIFICADO');
end;
$function$;

revoke all on function public.vincular_pago_qr(bigint, bigint) from anon, public;
grant execute on function public.vincular_pago_qr(bigint, bigint) to authenticated, service_role;

drop function if exists public.verificar_pago_manual(bigint, text, boolean);

create function public.verificar_pago_manual(p_venta_pago_id bigint, p_referencia text, p_aprobar boolean) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_perfil perfil%rowtype;
  v_estado text;
begin
  -- Decisión 25: solo un gerente verifica transferencias; también cubre el QR que el
  -- scraper no pudo conciliar automáticamente.
  if not app_es_admin() then raise exception 'Solo un gerente puede verificar pagos'; end if;

  select * into v_perfil from perfil where id = auth.uid();
  perform 1 from venta_pago where id = p_venta_pago_id and estado_verificacion = 'PENDIENTE' for update;
  if not found then raise exception 'Pago % no existe o no está pendiente de verificación', p_venta_pago_id; end if;

  v_estado := case when p_aprobar then 'VERIFICADO' else 'RECHAZADO' end;

  update venta_pago
     set estado_verificacion = v_estado, verificado_en = now(), verificado_por = coalesce(v_perfil.email, 'gerente'),
         referencia = coalesce(p_referencia, referencia)
   where id = p_venta_pago_id;

  return jsonb_build_object('venta_pago_id', p_venta_pago_id, 'estado', v_estado);
end;
$function$;

revoke all on function public.verificar_pago_manual(bigint, text, boolean) from anon, public;
grant execute on function public.verificar_pago_manual(bigint, text, boolean) to authenticated, service_role;

drop function if exists public.estado_banco_qr();

create function public.estado_banco_qr() returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol text;
  v_ultimo timestamptz;
  v_minutos numeric;
begin
  v_rol := app_rol_actual();
  if v_rol is null then raise exception 'No autorizado'; end if;

  select ultimo_latido into v_ultimo from worker_latido where worker = 'bnb-qr';
  v_minutos := case when v_ultimo is null then null else round(extract(epoch from (now() - v_ultimo)) / 60, 1) end;

  return jsonb_build_object(
    'ultimo_latido', v_ultimo,
    'minutos_desde', v_minutos,
    'en_linea', v_ultimo is not null and v_ultimo > now() - interval '10 minutes'
  );
end;
$function$;

revoke all on function public.estado_banco_qr() from anon, public;
grant execute on function public.estado_banco_qr() to authenticated, service_role;

-- ============================================================================
-- A4. Discord vía el outbox existente (triggers, server-side)
-- ============================================================================

-- Formato Bolivia ("Bs 12.450,00") sin depender del locale numérico de la sesión
-- (to_char con 'D'/'G' saca el separador del lc_numeric del server, que en Supabase
-- suele ser en_US — daría "12,450.00", al revés de lo que ya usan los mensajes DEMO_*
-- vivos en notificacion_pendiente). Solo cosmético para Discord, no lo lee ningún test.
drop function if exists public._fmt_bs(numeric);

create function public._fmt_bs(p_valor numeric) returns text
language plpgsql
immutable
as $function$
declare
  v_neg boolean; v_abs numeric; v_ent text; v_dec text; v_out text := ''; v_i int; v_cnt int := 0;
begin
  v_neg := coalesce(p_valor, 0) < 0;
  v_abs := abs(round(coalesce(p_valor, 0), 2));
  v_ent := trunc(v_abs)::bigint::text;
  v_dec := lpad(round((v_abs - trunc(v_abs)) * 100)::int::text, 2, '0');
  for v_i in reverse length(v_ent)..1 loop
    v_out := substr(v_ent, v_i, 1) || v_out;
    v_cnt := v_cnt + 1;
    if v_cnt % 3 = 0 and v_i > 1 then v_out := '.' || v_out; end if;
  end loop;
  return (case when v_neg then '− Bs ' else 'Bs ' end) || v_out || ',' || v_dec;
end;
$function$;

-- Helper genérico: encola en el outbox existente (public.notificar) y NUNCA propaga un
-- error hacia quien la llama — brief A4: "un trigger nunca debe fallar la transacción
-- de negocio". SECURITY DEFINER y sin grant a authenticated: solo la llaman los
-- triggers de más abajo (también SECURITY DEFINER, corren como el dueño — no
-- necesitan el GRANT para invocarla).
drop function if exists public.caja_notificar(text, text, jsonb, text);

create function public.caja_notificar(p_canal text, p_evento text, p_payload jsonb, p_idem text default null) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.notificar(p_canal, p_evento, p_payload, p_idem);
exception when others then
  raise warning 'caja_notificar(%, %): %', p_canal, p_evento, sqlerrm;
end;
$function$;

revoke all on function public.caja_notificar(text, text, jsonb, text) from anon, public, authenticated;
grant execute on function public.caja_notificar(text, text, jsonb, text) to service_role;

-- ── sesion_caja INSERT: apertura de turno ──────────────────────────────────────

drop function if exists public._notif_sesion_apertura() cascade;

create function public._notif_sesion_apertura() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cajero text;
  v_fields jsonb;
begin
  select coalesce(nombre, email) into v_cajero from perfil where id = NEW.cajero_id;
  v_fields := jsonb_build_array(
    jsonb_build_object('name', 'Cajero', 'value', coalesce(v_cajero, NEW.abierta_por, 'desconocido'), 'inline', true),
    jsonb_build_object('name', 'Monto apertura', 'value', _fmt_bs(NEW.monto_apertura), 'inline', true)
  );
  if NEW.diferencia_relevo is not null then
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('name', 'Diferencia de relevo', 'value', _fmt_bs(NEW.diferencia_relevo), 'inline', true));
  end if;

  perform caja_notificar('sesiones', 'APERTURA_TURNO', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 3447003,
      'title', ':unlock: Apertura de turno',
      'fields', v_fields
    ))
  ), 'sesion:' || NEW.id || ':apertura');

  return NEW;
exception when others then
  raise warning '_notif_sesion_apertura: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_sesion_apertura on sesion_caja;
create trigger trg_notif_sesion_apertura
  after insert on sesion_caja
  for each row execute function public._notif_sesion_apertura();

-- ── sesion_caja UPDATE: cierre (CERRADA o EN_REVISION) ─────────────────────────

drop function if exists public._notif_sesion_cierre() cascade;

create function public._notif_sesion_cierre() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cajero text; v_caja text; v_cant int; v_color int; v_esperado numeric; v_metodos jsonb;
begin
  select coalesce(nombre, email) into v_cajero from perfil where id = NEW.cajero_id;
  select nombre into v_caja from caja where id = NEW.caja_id;
  select count(*) into v_cant from venta where sesion_caja_id = NEW.id and estado = 'COMPLETADA';

  select NEW.monto_apertura + coalesce(sum(case when tipo in ('VENTA', 'ANTICIPO', 'INGRESO') then monto
                                                 when tipo in ('EGRESO', 'ANULACION') then -monto else 0 end), 0)
    into v_esperado
    from movimiento_caja where sesion_caja_id = NEW.id and metodo = 'EFECTIVO';

  select coalesce(jsonb_agg(jsonb_build_object('name', initcap(lower(metodo::text)), 'value', _fmt_bs(monto), 'inline', true)), '[]'::jsonb)
    into v_metodos
    from (select metodo, sum(monto) as monto from movimiento_caja where sesion_caja_id = NEW.id and tipo = 'VENTA' group by metodo) t;

  v_color := case when coalesce(NEW.diferencia, 0) < -0.01 then 15548997
                  when coalesce(NEW.diferencia, 0) > 0.01 then 15105570
                  else 5763719 end;

  perform caja_notificar('sesiones', NEW.estado::text, jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', v_color,
      'title', case when NEW.estado = 'EN_REVISION' then ':warning: Turno cerrado con diferencia — en revisión' else ':receipt: Cierre de turno' end,
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Cajero', 'value', coalesce(v_cajero, NEW.cerrada_por, 'desconocido'), 'inline', true),
        jsonb_build_object('name', 'Caja', 'value', coalesce(v_caja, '—'), 'inline', true),
        jsonb_build_object('name', 'Abierto', 'value', to_char(NEW.abierta_en at time zone 'America/La_Paz', 'DD/MM HH24:MI'), 'inline', true),
        jsonb_build_object('name', 'Cerrado', 'value', to_char(coalesce(NEW.cerrada_en, now()) at time zone 'America/La_Paz', 'DD/MM HH24:MI'), 'inline', true),
        jsonb_build_object('name', 'Esperado', 'value', _fmt_bs(v_esperado), 'inline', true),
        jsonb_build_object('name', 'Contado', 'value', _fmt_bs(coalesce(NEW.monto_cierre_contado, 0)), 'inline', true),
        jsonb_build_object('name', 'Diferencia', 'value', _fmt_bs(coalesce(NEW.diferencia, 0)), 'inline', true),
        jsonb_build_object('name', 'Ventas', 'value', v_cant::text, 'inline', true)
      ) || v_metodos
    ))
  ), 'sesion:' || NEW.id || ':' || NEW.estado::text);

  return NEW;
exception when others then
  raise warning '_notif_sesion_cierre: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_sesion_cierre on sesion_caja;
create trigger trg_notif_sesion_cierre
  after update on sesion_caja
  for each row
  when (NEW.estado is distinct from OLD.estado and NEW.estado in ('CERRADA', 'EN_REVISION'))
  execute function public._notif_sesion_cierre();

-- ── sesion_caja_conteo INSERT (momento = SORPRESA) ─────────────────────────────

drop function if exists public._notif_conteo_sorpresa() cascade;

create function public._notif_conteo_sorpresa() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ses sesion_caja%rowtype;
  v_esperado numeric;
  v_dif numeric;
begin
  select * into v_ses from sesion_caja where id = NEW.sesion_caja_id;
  select v_ses.monto_apertura + coalesce(sum(case when tipo in ('VENTA', 'ANTICIPO', 'INGRESO') then monto
                                                   when tipo in ('EGRESO', 'ANULACION') then -monto else 0 end), 0)
    into v_esperado
    from movimiento_caja where sesion_caja_id = NEW.sesion_caja_id and metodo = 'EFECTIVO';
  v_dif := round(NEW.total - v_esperado, 2);

  perform caja_notificar('sesiones', 'ARQUEO_SORPRESA', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', case when abs(v_dif) < 0.01 then 5763719 else 15548997 end,
      'title', ':mag: Arqueo sorpresa',
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Caja', 'value', coalesce((select nombre from caja where id = v_ses.caja_id), '—'), 'inline', true),
        jsonb_build_object('name', 'Esperado', 'value', _fmt_bs(v_esperado), 'inline', true),
        jsonb_build_object('name', 'Contado', 'value', _fmt_bs(NEW.total), 'inline', true),
        jsonb_build_object('name', 'Diferencia', 'value', _fmt_bs(v_dif), 'inline', true)
      )
    ))
  ), 'conteo:' || NEW.id);

  return NEW;
exception when others then
  raise warning '_notif_conteo_sorpresa: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_conteo_sorpresa on sesion_caja_conteo;
create trigger trg_notif_conteo_sorpresa
  after insert on sesion_caja_conteo
  for each row
  when (NEW.momento = 'SORPRESA')
  execute function public._notif_conteo_sorpresa();

-- ── caja_gasto INSERT: gasto pendiente de aprobación ───────────────────────────

drop function if exists public._notif_gasto_nuevo() cascade;

create function public._notif_gasto_nuevo() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform caja_notificar('aprobaciones', 'GASTO_PENDIENTE', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 15105570,
      'title', ':clipboard: Nuevo gasto pendiente de aprobación',
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Cajero', 'value', coalesce(NEW.registrado_por, 'desconocido'), 'inline', true),
        jsonb_build_object('name', 'Monto', 'value', _fmt_bs(NEW.monto), 'inline', true),
        jsonb_build_object('name', 'Motivo', 'value', NEW.motivo, 'inline', false)
      )
    ))
  ), 'gasto:' || NEW.id || ':nuevo');
  return NEW;
exception when others then
  raise warning '_notif_gasto_nuevo: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_gasto_nuevo on caja_gasto;
create trigger trg_notif_gasto_nuevo
  after insert on caja_gasto
  for each row execute function public._notif_gasto_nuevo();

-- ── caja_gasto UPDATE: resolución (APROBADO/RECHAZADO) ─────────────────────────

drop function if exists public._notif_gasto_resuelto() cascade;

create function public._notif_gasto_resuelto() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform caja_notificar('aprobaciones', NEW.estado, jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', case when NEW.estado = 'APROBADO' then 5763719 else 15548997 end,
      'title', case when NEW.estado = 'APROBADO' then ':white_check_mark: Gasto aprobado' else ':x: Gasto rechazado' end,
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Cajero', 'value', coalesce(NEW.registrado_por, 'desconocido'), 'inline', true),
        jsonb_build_object('name', 'Monto', 'value', _fmt_bs(NEW.monto), 'inline', true),
        jsonb_build_object('name', 'Resuelto por', 'value', coalesce(NEW.resuelto_por, 'desconocido'), 'inline', true)
      ) || (case when NEW.nota_resolucion is not null
                 then jsonb_build_array(jsonb_build_object('name', 'Nota', 'value', NEW.nota_resolucion, 'inline', false))
                 else '[]'::jsonb end)
    ))
  ), 'gasto:' || NEW.id || ':' || NEW.estado);
  return NEW;
exception when others then
  raise warning '_notif_gasto_resuelto: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_gasto_resuelto on caja_gasto;
create trigger trg_notif_gasto_resuelto
  after update on caja_gasto
  for each row
  when (NEW.estado is distinct from OLD.estado and NEW.estado in ('APROBADO', 'RECHAZADO'))
  execute function public._notif_gasto_resuelto();

-- ── caja_faltante INSERT: faltante nuevo ───────────────────────────────────────

drop function if exists public._notif_faltante_nuevo() cascade;

create function public._notif_faltante_nuevo() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_cajero text;
begin
  select coalesce(nombre, email) into v_cajero from perfil where id = NEW.cajero_id;
  perform caja_notificar('alertas', 'FALTANTE_NUEVO', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 15548997,
      'title', ':warning: Faltante registrado',
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Cajero', 'value', coalesce(v_cajero, 'desconocido'), 'inline', true),
        jsonb_build_object('name', 'Monto', 'value', _fmt_bs(NEW.monto), 'inline', true),
        jsonb_build_object('name', 'Origen', 'value', case when NEW.origen = 'ARQUEO' then 'Arqueo' else 'Gasto rechazado' end, 'inline', true)
      )
    ))
  ), 'faltante:' || NEW.id);
  return NEW;
exception when others then
  raise warning '_notif_faltante_nuevo: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_faltante_nuevo on caja_faltante;
create trigger trg_notif_faltante_nuevo
  after insert on caja_faltante
  for each row execute function public._notif_faltante_nuevo();

-- ── venta UPDATE: anulación ─────────────────────────────────────────────────

drop function if exists public._notif_venta_anulada() cascade;

create function public._notif_venta_anulada() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_evento venta_evento%rowtype;
begin
  select * into v_evento from venta_evento where venta_id = NEW.id order by creado_en desc, id desc limit 1;

  perform caja_notificar('alertas', 'VENTA_ANULADA', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 15548997,
      'title', ':no_entry_sign: Venta anulada',
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Venta', 'value', coalesce(NEW.numero, '#' || NEW.id::text), 'inline', true),
        jsonb_build_object('name', 'Total', 'value', _fmt_bs(NEW.total), 'inline', true),
        jsonb_build_object('name', 'Anulado por', 'value', coalesce(v_evento.usuario, 'desconocido'), 'inline', true)
      ) || (case when v_evento.motivo is not null
                 then jsonb_build_array(jsonb_build_object('name', 'Motivo', 'value', v_evento.motivo, 'inline', false))
                 else '[]'::jsonb end)
    ))
  ), 'venta:' || NEW.id || ':anulada');

  return NEW;
exception when others then
  raise warning '_notif_venta_anulada: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_venta_anulada on venta;
create trigger trg_notif_venta_anulada
  after update on venta
  for each row
  when (NEW.estado is distinct from OLD.estado and NEW.estado = 'ANULADA')
  execute function public._notif_venta_anulada();

-- ── venta_pago UPDATE: pago rechazado ───────────────────────────────────────

drop function if exists public._notif_pago_rechazado() cascade;

create function public._notif_pago_rechazado() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_numero text;
begin
  select numero into v_numero from venta where id = NEW.venta_id;
  perform caja_notificar('pagos', 'PAGO_RECHAZADO', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 15548997,
      'title', ':x: Pago rechazado',
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Venta', 'value', coalesce(v_numero, '#' || NEW.venta_id::text), 'inline', true),
        jsonb_build_object('name', 'Método', 'value', initcap(lower(NEW.metodo::text)), 'inline', true),
        jsonb_build_object('name', 'Monto', 'value', _fmt_bs(NEW.monto), 'inline', true)
      )
    ))
  ), 'pago:' || NEW.id || ':rechazado');
  return NEW;
exception when others then
  raise warning '_notif_pago_rechazado: %', sqlerrm;
  return NEW;
end;
$function$;

drop trigger if exists trg_notif_pago_rechazado on venta_pago;
create trigger trg_notif_pago_rechazado
  after update on venta_pago
  for each row
  when (NEW.estado_verificacion is distinct from OLD.estado_verificacion and NEW.estado_verificacion = 'RECHAZADO')
  execute function public._notif_pago_rechazado();

-- ============================================================================
-- A5. Alerta de scraper caído (BNB QR)
-- ============================================================================

drop function if exists public.caja_vigilar_bnb();

create function public.caja_vigilar_bnb() returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hora int;
  v_ultimo timestamptz;
  v_idem text;
begin
  -- Solo entre 08:00 y 21:00 hora Bolivia — fuera de ese horario el scraper no corre
  -- y una alerta ahí sería puro ruido.
  v_hora := extract(hour from now() at time zone 'America/La_Paz');
  if v_hora < 8 or v_hora >= 21 then return; end if;

  select ultimo_latido into v_ultimo from worker_latido where worker = 'bnb-qr';
  -- Fila inexistente = el scraper nunca se conectó todavía: no es una caída, es que
  -- Part C (switch del scraper) todavía no pasó — no hace falta alertar por eso.
  if v_ultimo is null then return; end if;
  if v_ultimo > now() - interval '10 minutes' then return; end if;

  -- Como mucho una alerta cada 30 min: la clave de idempotencia cambia por bloque de
  -- media hora (hora + 0/1 según el minuto).
  v_idem := 'bnb-caido:' || to_char(now() at time zone 'America/La_Paz', 'YYYY-MM-DD HH24')
            || ':' || (extract(minute from now() at time zone 'America/La_Paz')::int / 30);

  perform caja_notificar('alertas', 'BNB_QR_CAIDO', jsonb_build_object(
    'username', 'ROARI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'color', 15548997,
      'title', ':red_circle: Scraper BNB QR sin latir',
      'description', format('El worker bnb-qr no reporta latido hace más de 10 minutos (último: %s).', v_ultimo)
    ))
  ), v_idem);
end;
$function$;

revoke all on function public.caja_vigilar_bnb() from anon, public, authenticated;
grant execute on function public.caja_vigilar_bnb() to service_role;

select cron.schedule('caja_vigilar_bnb', '*/5 * * * *', $$select public.caja_vigilar_bnb();$$)
where not exists (select 1 from cron.job where jobname = 'caja_vigilar_bnb');

-- ============================================================================
-- Verificación (correr después de aplicar, antes y en producción)
-- ============================================================================

-- select * from banco_qr_movimiento limit 5;
-- select proname from pg_proc where proname in ('ingestar_pagos_qr','conciliar_pagos_qr','vincular_pago_qr','verificar_pago_manual','estado_banco_qr','caja_notificar','caja_vigilar_bnb'); -- 7 filas
-- select p.proname, r.grantee from information_schema.routine_privileges r join pg_proc p on p.proname = r.routine_name where r.routine_name in ('ingestar_pagos_qr','caja_notificar','caja_vigilar_bnb') and r.grantee in ('anon','public','authenticated'); -- 0 filas
-- select p.proname, r.grantee from information_schema.routine_privileges r join pg_proc p on p.proname = r.routine_name where r.routine_name = 'ingestar_pagos_qr' and r.grantee = 'service_role'; -- 1 fila
-- select jobname, schedule from cron.job where jobname = 'caja_vigilar_bnb'; -- 1 fila, */5 * * * *
--
-- Chequeos de la migración (BEGIN…ROLLBACK, ver brief "Tests > Migration checks"):
-- 1) select ingestar_pagos_qr('[{"banco_id":"X1","importe":150.00,"fecha_transaccion":"2026-09-28T10:00:00-04:00","estado":"Pagado"}]'::jsonb);
--    -- con una venta_pago QR pendiente de Bs 150 hace <10min -> debe quedar VERIFICADO.
-- 2) dos venta_pago QR PENDIENTE del mismo monto dentro de 10 min + un solo movimiento
--    "Pagado" que calce -> ambos quedan PENDIENTE (ambigüedad, ver v_candidatos <> 1... hay
--    que revisar del lado del pago: dos pagos iguales matchean el mismo movimiento, así que
--    v_otro_lado > 1 para ambos -> ninguno se verifica).
-- 3) reingestar el mismo banco_id no duplica fila (on conflict) ni vuelve a contar "nuevos".
-- 4) select verificar_pago_manual(1, 'ref', true); -- como 'cajero' -> excepción "Solo un gerente...".
-- 5) cerrar un turno -> exactamente una fila nueva en notificacion_pendiente canal 'sesiones';
--    forzar un error dentro de _notif_sesion_cierre (p.ej. renombrando una columna en la
--    sesión de prueba) no debe abortar el UPDATE de sesion_caja (ver RAISE WARNING).
-- 6) select has_function_privilege('authenticated', 'ingestar_pagos_qr(jsonb,text)', 'execute'); -- false
