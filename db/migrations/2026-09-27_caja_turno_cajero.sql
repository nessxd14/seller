-- Brief Caja-1 — Módulo de turno de cajero en el Seller (lógica de Caja ROARI).
--
-- NO APLICAR sin validar antes en BEGIN…ROLLBACK. Ness la valida y la aplica a mano.
-- El PR del frontend no debe mergearse hasta que esta migración exista en la base.
--
-- Prerequisito: 2026-09-27_caja_turno_cajero_enum.sql (ALTER TYPE ... ADD VALUE
-- 'EN_REVISION', no puede ir en la misma transacción) ya debe estar aplicado.
--
-- Convenciones del proyecto seguidas acá:
--   * cada función nueva o reemplazada trae su propio
--     REVOKE ALL ... FROM anon, public; GRANT EXECUTE ... TO authenticated, service_role;
--   * toda tabla nueva: RLS habilitado, sin acceso a anon (mismo patrón "auth_all" que
--     ya usan sesion_caja/movimiento_caja/venta/venta_pago/caja: una sola policy ALL
--     para authenticated — el control fino vive en las funciones SECURITY DEFINER, no
--     en RLS por fila, igual que el resto de este esquema).
--   * ningún parámetro de usuario/identidad es de confianza: todo sale de auth.uid() +
--     perfil / app_rol_actual().

-- ============================================================================
-- A1a. Backfill de las ventas históricas sin `numero` (ANTES de tocar la función,
-- para que el conteo de partida sea exacto). Verificado contra la base viva:
-- 15 filas, todas creado_en en 2026 (America/La_Paz) — el particionado por año
-- es igual de correcto si en el futuro esto corre contra más historia.
-- ============================================================================

with numerados as (
  select id,
         extract(year from creado_en at time zone 'America/La_Paz')::int as anio,
         row_number() over (
           partition by extract(year from creado_en at time zone 'America/La_Paz')::int
           order by id
         ) as rn
    from venta
   where numero is null
)
update venta v
   set numero = formato_numero('VTA', n.anio, n.rn)
  from numerados n
 where v.id = n.id;

-- El contador continúa justo después del backfill: siguiente_numero('VTA', 2026)
-- en la primera venta real post-migración va a devolver 16 (o lo que corresponda).
insert into contador_documento (tipo, anio, ultimo_valor)
select 'VTA', extract(year from creado_en at time zone 'America/La_Paz')::int, count(*)
  from venta
 where numero like 'VTA-%'
 group by extract(year from creado_en at time zone 'America/La_Paz')::int
on conflict (tipo, anio)
do update set ultimo_valor = greatest(contador_documento.ultimo_valor, excluded.ultimo_valor);

-- venta.numero ya tiene un índice único parcial (`venta_numero_key`, verificado en la
-- base viva vía pg_indexes: `CREATE UNIQUE INDEX venta_numero_key ON venta (numero)
-- WHERE numero IS NOT NULL`) — es exactamente lo que pide A1 (`venta_numero_uidx`), solo
-- que con otro nombre. No se crea un segundo índice redundante sobre la misma columna.

-- ============================================================================
-- A2. Cash received / change
-- ============================================================================

alter table venta_pago add column if not exists recibido numeric null;

-- ============================================================================
-- A3. Payment verification fields (preparados acá, usados por Caja-2)
-- ============================================================================

alter table venta_pago add column if not exists estado_verificacion text not null default 'NO_APLICA';
alter table venta_pago add column if not exists referencia text null;
alter table venta_pago add column if not exists verificado_en timestamptz null;
alter table venta_pago add column if not exists verificado_por text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'venta_pago'::regclass and conname = 'venta_pago_estado_verificacion_check'
  ) then
    alter table venta_pago
      add constraint venta_pago_estado_verificacion_check
      check (estado_verificacion in ('NO_APLICA', 'PENDIENTE', 'VERIFICADO', 'RECHAZADO'));
  end if;
end $$;

-- Filas existentes: QR/TRANSFERENCIA ya cobradas y asentadas → VERIFICADO (son
-- historia ya saldada, no algo que Caja-2 tenga que re-conciliar). Todo lo demás ya
-- quedó en NO_APLICA por el DEFAULT de la columna recién agregada.
update venta_pago
   set estado_verificacion = 'VERIFICADO', verificado_en = now(), verificado_por = 'migracion'
 where metodo in ('QR', 'TRANSFERENCIA')
   and estado_verificacion = 'NO_APLICA';

-- ============================================================================
-- A4. El turno pertenece a un cajero
-- ============================================================================

alter table sesion_caja add column if not exists cajero_id uuid null references perfil(id);
alter table sesion_caja add column if not exists diferencia_relevo numeric null;
alter table sesion_caja add column if not exists revisada_por text null;
alter table sesion_caja add column if not exists revisada_en timestamptz null;
alter table sesion_caja add column if not exists nota_revision text null;

-- ============================================================================
-- A5. Conteos por denominación
-- ============================================================================

create table if not exists sesion_caja_conteo (
  id bigint generated always as identity primary key,
  sesion_caja_id bigint not null references sesion_caja(id),
  momento text not null check (momento in ('APERTURA', 'CIERRE', 'SORPRESA')),
  denominaciones jsonb not null,
  total numeric not null,
  contado_por text null,
  contado_por_id uuid null,
  contado_en timestamptz not null default now()
);

create unique index if not exists sesion_caja_conteo_apertura_uidx
  on sesion_caja_conteo (sesion_caja_id) where momento = 'APERTURA';
create unique index if not exists sesion_caja_conteo_cierre_uidx
  on sesion_caja_conteo (sesion_caja_id) where momento = 'CIERRE';
create index if not exists sesion_caja_conteo_sesion_idx on sesion_caja_conteo (sesion_caja_id);

alter table sesion_caja_conteo enable row level security;
revoke all on sesion_caja_conteo from anon;
drop policy if exists sesion_caja_conteo_auth_all on sesion_caja_conteo;
create policy sesion_caja_conteo_auth_all on sesion_caja_conteo for all to authenticated using (true) with check (true);

-- ============================================================================
-- A6. Gastos, remesas, inyecciones (decisiones 18, 19)
-- ============================================================================

create table if not exists caja_gasto (
  id bigint generated always as identity primary key,
  -- decisión 14: un gerente puede registrar un gasto sin que haya un turno de
  -- cajero abierto — por eso nullable, a diferencia del resto de las FKs de sesión.
  sesion_caja_id bigint null references sesion_caja(id),
  monto numeric not null check (monto > 0),
  motivo text not null check (btrim(motivo) <> ''),
  comprobante_path text null,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  registrado_por text null,
  registrado_por_id uuid null,
  registrado_en timestamptz not null default now(),
  resuelto_por text null,
  resuelto_en timestamptz null,
  nota_resolucion text null
);

create index if not exists caja_gasto_sesion_idx on caja_gasto (sesion_caja_id);
create index if not exists caja_gasto_estado_idx on caja_gasto (estado);

alter table caja_gasto enable row level security;
revoke all on caja_gasto from anon;
drop policy if exists caja_gasto_auth_all on caja_gasto;
create policy caja_gasto_auth_all on caja_gasto for all to authenticated using (true) with check (true);

alter table movimiento_caja add column if not exists subtipo text null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'movimiento_caja'::regclass and conname = 'movimiento_caja_subtipo_check'
  ) then
    alter table movimiento_caja
      add constraint movimiento_caja_subtipo_check
      check (subtipo is null or subtipo in ('GASTO', 'REMESA', 'INYECCION', 'OTRO'));
  end if;
end $$;
alter table movimiento_caja add column if not exists caja_gasto_id bigint null references caja_gasto(id);
create index if not exists movimiento_caja_gasto_idx on movimiento_caja (caja_gasto_id);

-- Bucket privado para las fotos de comprobante de gasto. Mismo patrón que
-- `documentos-expediente` (verificado contra pg_policies de storage.objects en la
-- base viva): INSERT + SELECT para authenticated, nada para anon. La subida hace
-- `INSERT ... ON CONFLICT DO UPDATE`, así que hace falta la policy de SELECT además
-- de la de INSERT — sin ella, la parte "on conflict" del upload falla.
insert into storage.buckets (id, name, public)
select 'caja-comprobantes', 'caja-comprobantes', false
where not exists (select 1 from storage.buckets where id = 'caja-comprobantes');

drop policy if exists caja_comprobantes_insert on storage.objects;
create policy caja_comprobantes_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'caja-comprobantes');

drop policy if exists caja_comprobantes_select on storage.objects;
create policy caja_comprobantes_select
  on storage.objects for select to authenticated
  using (bucket_id = 'caja-comprobantes');

-- ============================================================================
-- A7. Faltantes
-- ============================================================================

create table if not exists caja_faltante (
  id bigint generated always as identity primary key,
  sesion_caja_id bigint not null references sesion_caja(id),
  cajero_id uuid null references perfil(id),
  origen text not null check (origen in ('ARQUEO', 'GASTO_RECHAZADO')),
  caja_gasto_id bigint null references caja_gasto(id),
  monto numeric not null check (monto > 0),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'REPUESTO', 'CONDONADO')),
  creado_en timestamptz not null default now(),
  resuelto_por text null,
  resuelto_en timestamptz null,
  nota text null
);

create index if not exists caja_faltante_sesion_idx on caja_faltante (sesion_caja_id);
create index if not exists caja_faltante_cajero_idx on caja_faltante (cajero_id);
create index if not exists caja_faltante_estado_idx on caja_faltante (estado);

alter table caja_faltante enable row level security;
revoke all on caja_faltante from anon;
drop policy if exists caja_faltante_auth_all on caja_faltante;
create policy caja_faltante_auth_all on caja_faltante for all to authenticated using (true) with check (true);

-- ============================================================================
-- A8a. Helper interno: suma y valida un objeto de denominaciones.
-- Compartido por abrir_turno / cerrar_turno / registrar_arqueo_sorpresa (A5) para
-- no triplicar la misma validación de "billetes/monedas válidos, cantidades enteras
-- >= 0" en tres funciones.
-- ============================================================================

drop function if exists public._total_denominaciones(jsonb);

create function public._total_denominaciones(p_denominaciones jsonb) returns numeric
language plpgsql
as $function$
declare
  v_key text; v_val jsonb; v_qty numeric; v_total numeric := 0;
  v_validas text[] := array['200','100','50','20','10','5','2','1','0.5'];
begin
  if p_denominaciones is null or jsonb_typeof(p_denominaciones) <> 'object' then
    raise exception 'denominaciones debe ser un objeto {"200": cantidad, ...}';
  end if;
  for v_key, v_val in select * from jsonb_each(p_denominaciones) loop
    if not (v_key = any(v_validas)) then
      raise exception 'Denominación desconocida: %. Válidas: %', v_key, array_to_string(v_validas, ', ');
    end if;
    if jsonb_typeof(v_val) <> 'number' then
      raise exception 'Cantidad inválida para %', v_key;
    end if;
    v_qty := (v_val#>>'{}')::numeric;
    if v_qty < 0 or v_qty <> trunc(v_qty) then
      raise exception 'Cantidad inválida para % (debe ser un entero >= 0)', v_key;
    end if;
    v_total := v_total + v_qty * v_key::numeric;
  end loop;
  return v_total;
end;
$function$;

revoke all on function public._total_denominaciones(jsonb) from anon, public;
grant execute on function public._total_denominaciones(jsonb) to authenticated, service_role;

-- ============================================================================
-- A8b. abrir_turno
-- ============================================================================

drop function if exists public.abrir_turno(bigint, jsonb);

create function public.abrir_turno(p_caja_id bigint, p_denominaciones jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol text;
  v_perfil perfil%rowtype;
  v_total numeric;
  v_sesion_id bigint;
  v_prev_id bigint;
  v_prev_cierre_total numeric;
begin
  v_rol := app_rol_actual();
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado para abrir turno';
  end if;
  select * into v_perfil from perfil where id = auth.uid();

  perform 1 from caja where id = p_caja_id and activa;
  if not found then raise exception 'Caja % no existe o está inactiva', p_caja_id; end if;

  if exists (select 1 from sesion_caja where caja_id = p_caja_id and estado = 'ABIERTA') then
    raise exception 'La caja % ya tiene una sesión abierta', p_caja_id;
  end if;

  v_total := _total_denominaciones(p_denominaciones);

  insert into sesion_caja (caja_id, monto_apertura, abierta_por, cajero_id)
  values (p_caja_id, v_total, v_perfil.email, auth.uid())
  returning id into v_sesion_id;

  insert into sesion_caja_conteo (sesion_caja_id, momento, denominaciones, total, contado_por, contado_por_id)
  values (v_sesion_id, 'APERTURA', p_denominaciones, v_total, coalesce(v_perfil.email, 'sistema'), auth.uid());

  -- Relevo (decisión 17/20): la sesión CERRADA o EN_REVISION más reciente de esta
  -- misma caja, si tiene un conteo de CIERRE, define diferencia_relevo = este total
  -- de apertura − ese conteo de cierre. Nunca se muestra el monto anterior al
  -- cajero entrante (ver B2: "nunca el monto anterior, ciego").
  select sc.id into v_prev_id
    from sesion_caja sc
   where sc.caja_id = p_caja_id and sc.id <> v_sesion_id and sc.estado in ('CERRADA', 'EN_REVISION')
   order by coalesce(sc.cerrada_en, sc.abierta_en) desc, sc.id desc
   limit 1;

  if v_prev_id is not null then
    select total into v_prev_cierre_total
      from sesion_caja_conteo
     where sesion_caja_id = v_prev_id and momento = 'CIERRE';
    if v_prev_cierre_total is not null then
      update sesion_caja set diferencia_relevo = v_total - v_prev_cierre_total where id = v_sesion_id;
    end if;
  end if;

  return jsonb_build_object('sesion_id', v_sesion_id);
end;
$function$;

revoke all on function public.abrir_turno(bigint, jsonb) from anon, public;
grant execute on function public.abrir_turno(bigint, jsonb) to authenticated, service_role;

-- ============================================================================
-- A8c. registrar_movimiento_turno (gasto / remesa / inyección)
-- ============================================================================

drop function if exists public.registrar_movimiento_turno(bigint, text, numeric, text, text, text);

create function public.registrar_movimiento_turno(
  p_sesion_id bigint,
  p_subtipo text,
  p_monto numeric,
  p_motivo text,
  p_comprobante_path text default null,
  p_idempotencia text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol text;
  v_ses sesion_caja%rowtype;
  v_perfil perfil%rowtype;
  v_tipo tipo_movimiento_caja;
  v_gasto_id bigint;
  v_mov_id bigint;
begin
  if p_subtipo not in ('GASTO', 'REMESA', 'INYECCION') then
    raise exception 'Subtipo inválido: % (debe ser GASTO, REMESA o INYECCION)', p_subtipo;
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'El motivo es obligatorio'; end if;

  if p_idempotencia is not null then
    if btrim(p_idempotencia) = '' or length(p_idempotencia) > 200 then
      raise exception 'Clave de idempotencia inválida (vacía, en blanco, o mayor a 200 caracteres)';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('mov_turno:' || p_idempotencia, 0));
    select mc.id, mc.caja_gasto_id into v_mov_id, v_gasto_id
      from movimiento_caja mc where mc.idempotencia_clave = p_idempotencia;
    if v_mov_id is not null then
      return jsonb_build_object('movimiento_id', v_mov_id, 'gasto_id', v_gasto_id, 'reintento', true);
    end if;
  end if;

  v_rol := app_rol_actual();
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado';
  end if;

  select * into v_ses from sesion_caja where id = p_sesion_id for update;
  if not found then raise exception 'Sesión % no existe', p_sesion_id; end if;
  if v_ses.estado <> 'ABIERTA' then raise exception 'La sesión % no está abierta', p_sesion_id; end if;

  if v_rol = 'cajero' and v_ses.cajero_id is distinct from auth.uid() then
    raise exception 'Solo podés operar sobre tu propio turno abierto';
  end if;

  select * into v_perfil from perfil where id = auth.uid();

  v_tipo := case when p_subtipo = 'INYECCION' then 'INGRESO' else 'EGRESO' end;

  if p_subtipo = 'GASTO' then
    insert into caja_gasto (sesion_caja_id, monto, motivo, comprobante_path, registrado_por, registrado_por_id)
    values (p_sesion_id, p_monto, btrim(p_motivo), p_comprobante_path, v_perfil.email, auth.uid())
    returning id into v_gasto_id;
  end if;

  -- decisión 18: un gasto baja el efectivo esperado EN EL ACTO (movimiento EGRESO
  -- inmediato) — la aprobación del gerente es posterior y, si rechaza, genera un
  -- faltante (resolver_gasto), nunca "devuelve" el dinero al cajón.
  insert into movimiento_caja (sesion_caja_id, tipo, metodo, monto, nota, creado_por, subtipo, caja_gasto_id, idempotencia_clave)
  values (p_sesion_id, v_tipo, 'EFECTIVO', p_monto, btrim(p_motivo), v_perfil.email, p_subtipo, v_gasto_id, p_idempotencia)
  returning id into v_mov_id;

  return jsonb_build_object('movimiento_id', v_mov_id, 'gasto_id', v_gasto_id);
end;
$function$;

revoke all on function public.registrar_movimiento_turno(bigint, text, numeric, text, text, text) from anon, public;
grant execute on function public.registrar_movimiento_turno(bigint, text, numeric, text, text, text) to authenticated, service_role;

-- ============================================================================
-- A8d. resolver_gasto
-- ============================================================================

drop function if exists public.resolver_gasto(bigint, boolean, text);

create function public.resolver_gasto(p_gasto_id bigint, p_aprobar boolean, p_nota text default null) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gasto caja_gasto%rowtype;
  v_perfil perfil%rowtype;
  v_cajero_id uuid;
  v_faltante_id bigint;
  v_estado text;
begin
  if not app_es_admin() then raise exception 'Solo un gerente puede resolver gastos'; end if;

  select * into v_gasto from caja_gasto where id = p_gasto_id for update;
  if not found then raise exception 'Gasto % no existe', p_gasto_id; end if;
  if v_gasto.estado <> 'PENDIENTE' then raise exception 'El gasto % ya fue resuelto', p_gasto_id; end if;

  select * into v_perfil from perfil where id = auth.uid();
  v_estado := case when p_aprobar then 'APROBADO' else 'RECHAZADO' end;

  update caja_gasto
     set estado = v_estado, resuelto_por = v_perfil.email, resuelto_en = now(), nota_resolucion = p_nota
   where id = p_gasto_id;

  if not p_aprobar then
    select cajero_id into v_cajero_id from sesion_caja where id = v_gasto.sesion_caja_id;
    insert into caja_faltante (sesion_caja_id, cajero_id, origen, caja_gasto_id, monto)
    values (v_gasto.sesion_caja_id, v_cajero_id, 'GASTO_RECHAZADO', p_gasto_id, v_gasto.monto)
    returning id into v_faltante_id;
  end if;

  return jsonb_build_object('gasto_id', p_gasto_id, 'estado', v_estado, 'faltante_id', v_faltante_id);
end;
$function$;

revoke all on function public.resolver_gasto(bigint, boolean, text) from anon, public;
grant execute on function public.resolver_gasto(bigint, boolean, text) to authenticated, service_role;

-- ============================================================================
-- A8e. cerrar_turno
-- ============================================================================

drop function if exists public.cerrar_turno(bigint, jsonb);

create function public.cerrar_turno(p_sesion_id bigint, p_denominaciones jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol text;
  v_ses sesion_caja%rowtype;
  v_perfil perfil%rowtype;
  v_abiertas int;
  v_neto numeric;
  v_esperado numeric;
  v_contado numeric;
  v_dif numeric;
  v_estado estado_sesion_caja;
begin
  v_rol := app_rol_actual();
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado';
  end if;

  select * into v_ses from sesion_caja where id = p_sesion_id for update;
  if not found then raise exception 'Sesión % no existe', p_sesion_id; end if;
  if v_ses.estado <> 'ABIERTA' then raise exception 'La sesión % ya está cerrada', p_sesion_id; end if;

  if v_rol = 'cajero' and v_ses.cajero_id is distinct from auth.uid() then
    raise exception 'Solo podés cerrar tu propio turno';
  end if;

  -- Mismo guard que cerrar_caja: no cerrar con VTD abiertas de este turno.
  select count(*) into v_abiertas from venta where sesion_caja_id = p_sesion_id and estado = 'ABIERTA';
  if v_abiertas > 0 then
    raise exception
      'No se puede cerrar el turno: hay % venta(s) directa(s) de almacén abierta(s) en este turno. Resuélvelas antes de cerrar.',
      v_abiertas;
  end if;

  v_contado := _total_denominaciones(p_denominaciones);

  -- Misma fórmula que cerrar_caja (verificada contra la definición viva de esa
  -- función): apertura + entradas efectivo (VENTA/ANTICIPO/INGRESO) − salidas
  -- efectivo (EGRESO/ANULACION). Nunca cuenta QR ni transferencia.
  select coalesce(sum(case when tipo in ('VENTA', 'ANTICIPO', 'INGRESO') then monto
                           when tipo in ('EGRESO', 'ANULACION') then -monto else 0 end), 0)
    into v_neto
  from movimiento_caja where sesion_caja_id = p_sesion_id and metodo = 'EFECTIVO';
  v_esperado := v_ses.monto_apertura + v_neto;
  v_dif := round(v_contado - v_esperado, 2);

  v_estado := case when abs(v_dif) < 0.01 then 'CERRADA' else 'EN_REVISION' end;

  select * into v_perfil from perfil where id = auth.uid();

  update sesion_caja
     set estado = v_estado, monto_cierre_contado = v_contado, diferencia = v_dif,
         cerrada_por = v_perfil.email, cerrada_en = now()
   where id = p_sesion_id;

  insert into sesion_caja_conteo (sesion_caja_id, momento, denominaciones, total, contado_por, contado_por_id)
  values (p_sesion_id, 'CIERRE', p_denominaciones, v_contado, coalesce(v_perfil.email, 'sistema'), auth.uid());

  if v_dif < -0.01 then
    insert into caja_faltante (sesion_caja_id, cajero_id, origen, monto)
    values (p_sesion_id, v_ses.cajero_id, 'ARQUEO', abs(v_dif));
  end if;

  -- Blind count (decisión no negociable): un cajero nunca recibe esperado/contado/
  -- diferencia en la respuesta, ni acá ni en resumen_turno.
  if v_rol = 'cajero' then
    return jsonb_build_object('sesion_id', p_sesion_id, 'estado', v_estado);
  end if;
  return jsonb_build_object('sesion_id', p_sesion_id, 'estado', v_estado, 'esperado', v_esperado, 'contado', v_contado, 'diferencia', v_dif);
end;
$function$;

revoke all on function public.cerrar_turno(bigint, jsonb) from anon, public;
grant execute on function public.cerrar_turno(bigint, jsonb) to authenticated, service_role;

-- ============================================================================
-- A8f. revisar_turno
-- ============================================================================

drop function if exists public.revisar_turno(bigint, text);

create function public.revisar_turno(p_sesion_id bigint, p_nota text) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_perfil perfil%rowtype; v_ses sesion_caja%rowtype;
begin
  if not app_es_admin() then raise exception 'Solo un gerente puede revisar turnos'; end if;
  select * into v_ses from sesion_caja where id = p_sesion_id for update;
  if not found then raise exception 'Sesión % no existe', p_sesion_id; end if;
  if v_ses.estado <> 'EN_REVISION' then raise exception 'La sesión % no está en revisión', p_sesion_id; end if;
  select * into v_perfil from perfil where id = auth.uid();
  update sesion_caja
     set estado = 'CERRADA', revisada_por = v_perfil.email, revisada_en = now(), nota_revision = p_nota
   where id = p_sesion_id;
  return jsonb_build_object('sesion_id', p_sesion_id, 'estado', 'CERRADA');
end;
$function$;

revoke all on function public.revisar_turno(bigint, text) from anon, public;
grant execute on function public.revisar_turno(bigint, text) to authenticated, service_role;

-- ============================================================================
-- A8g. registrar_arqueo_sorpresa
-- ============================================================================

drop function if exists public.registrar_arqueo_sorpresa(bigint, jsonb);

create function public.registrar_arqueo_sorpresa(p_sesion_id bigint, p_denominaciones jsonb) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ses sesion_caja%rowtype;
  v_perfil perfil%rowtype;
  v_contado numeric;
  v_neto numeric;
  v_esperado numeric;
  v_dif numeric;
begin
  if not app_es_admin() then raise exception 'Solo un gerente puede registrar un arqueo sorpresa'; end if;

  select * into v_ses from sesion_caja where id = p_sesion_id;
  if not found then raise exception 'Sesión % no existe', p_sesion_id; end if;
  if v_ses.estado <> 'ABIERTA' then raise exception 'La sesión % no está abierta', p_sesion_id; end if;

  v_contado := _total_denominaciones(p_denominaciones);
  select coalesce(sum(case when tipo in ('VENTA', 'ANTICIPO', 'INGRESO') then monto
                           when tipo in ('EGRESO', 'ANULACION') then -monto else 0 end), 0)
    into v_neto
  from movimiento_caja where sesion_caja_id = p_sesion_id and metodo = 'EFECTIVO';
  v_esperado := v_ses.monto_apertura + v_neto;
  v_dif := round(v_contado - v_esperado, 2);

  select * into v_perfil from perfil where id = auth.uid();
  -- No cambia el estado de la sesión (a diferencia de cerrar_turno) — es un chequeo
  -- puntual, el turno sigue abierto y operando después de esto.
  insert into sesion_caja_conteo (sesion_caja_id, momento, denominaciones, total, contado_por, contado_por_id)
  values (p_sesion_id, 'SORPRESA', p_denominaciones, v_contado, coalesce(v_perfil.email, 'sistema'), auth.uid());

  return jsonb_build_object('esperado', v_esperado, 'contado', v_contado, 'diferencia', v_dif);
end;
$function$;

revoke all on function public.registrar_arqueo_sorpresa(bigint, jsonb) from anon, public;
grant execute on function public.registrar_arqueo_sorpresa(bigint, jsonb) to authenticated, service_role;

-- ============================================================================
-- A8h. resumen_turno — modelo de lectura único para la UI
-- ============================================================================

drop function if exists public.resumen_turno(bigint);

create function public.resumen_turno(p_sesion_id bigint) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rol text;
  v_ses sesion_caja%rowtype;
  v_ventas jsonb; v_anticipos jsonb; v_anulaciones jsonb; v_gastos jsonb;
  v_remesas numeric; v_inyecciones numeric; v_cantidad_ventas int;
  v_pendientes int; v_esperado numeric; v_neto numeric; v_rechazados jsonb;
begin
  v_rol := app_rol_actual();
  if v_rol is null then raise exception 'No autorizado'; end if;

  select * into v_ses from sesion_caja where id = p_sesion_id;
  if not found then raise exception 'Sesión % no existe', p_sesion_id; end if;

  if v_rol = 'cajero' and v_ses.cajero_id is distinct from auth.uid() then
    raise exception 'Solo podés ver tu propio turno';
  elsif v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado';
  end if;

  select coalesce(jsonb_object_agg(metodo, monto), '{}'::jsonb) into v_ventas
    from (select metodo::text as metodo, sum(monto) as monto from movimiento_caja
           where sesion_caja_id = p_sesion_id and tipo = 'VENTA' group by metodo) t;

  select coalesce(jsonb_object_agg(metodo, monto), '{}'::jsonb) into v_anticipos
    from (select metodo::text as metodo, sum(monto) as monto from movimiento_caja
           where sesion_caja_id = p_sesion_id and tipo = 'ANTICIPO' group by metodo) t;

  select coalesce(jsonb_object_agg(metodo, monto), '{}'::jsonb) into v_anulaciones
    from (select metodo::text as metodo, sum(monto) as monto from movimiento_caja
           where sesion_caja_id = p_sesion_id and tipo = 'ANULACION' group by metodo) t;

  select coalesce(jsonb_object_agg(lower(estado), monto), '{}'::jsonb) into v_gastos
    from (select g.estado, sum(g.monto) as monto from caja_gasto g
           where g.sesion_caja_id = p_sesion_id group by g.estado) t;

  select coalesce(sum(monto), 0) into v_remesas from movimiento_caja
   where sesion_caja_id = p_sesion_id and subtipo = 'REMESA';
  select coalesce(sum(monto), 0) into v_inyecciones from movimiento_caja
   where sesion_caja_id = p_sesion_id and subtipo = 'INYECCION';

  select count(*) into v_cantidad_ventas from venta where sesion_caja_id = p_sesion_id and estado = 'COMPLETADA';

  select count(*) into v_pendientes from venta_pago vp
    join venta v on v.id = vp.venta_id
   where v.sesion_caja_id = p_sesion_id and vp.estado_verificacion = 'PENDIENTE';

  -- Brief Caja-2 extiende esta clave (pagos RECHAZADOs vía verificar_pago_manual);
  -- se deja poblada ya en Caja-1 para no tener que tocar de nuevo esta función solo
  -- por agregar la clave — hoy siempre da '[]' porque nada todavía marca RECHAZADO.
  select coalesce(jsonb_agg(jsonb_build_object('venta_id', v.id, 'numero', v.numero, 'metodo', vp.metodo, 'monto', vp.monto)), '[]'::jsonb)
    into v_rechazados
    from venta_pago vp join venta v on v.id = vp.venta_id
   where v.sesion_caja_id = p_sesion_id and vp.estado_verificacion = 'RECHAZADO';

  if v_rol in ('gerente', 'admin') then
    select coalesce(sum(case when tipo in ('VENTA', 'ANTICIPO', 'INGRESO') then monto
                             when tipo in ('EGRESO', 'ANULACION') then -monto else 0 end), 0)
      into v_neto
    from movimiento_caja where sesion_caja_id = p_sesion_id and metodo = 'EFECTIVO';
    v_esperado := v_ses.monto_apertura + v_neto;
  else
    v_esperado := null;
  end if;

  return jsonb_build_object(
    'apertura', v_ses.monto_apertura,
    'ventas', v_ventas,
    'anticipos', v_anticipos,
    'anulaciones', v_anulaciones,
    'gastos', v_gastos,
    'remesas', v_remesas,
    'inyecciones', v_inyecciones,
    'cantidad_ventas', v_cantidad_ventas,
    'pagos_pendientes_verificacion', v_pendientes,
    'pagos_rechazados', v_rechazados,
    'diferencia_relevo', v_ses.diferencia_relevo,
    'esperado_efectivo', v_esperado
  );
end;
$function$;

revoke all on function public.resumen_turno(bigint) from anon, public;
grant execute on function public.resumen_turno(bigint) to authenticated, service_role;

-- ============================================================================
-- A8i. faltantes_resolver
-- ============================================================================

drop function if exists public.faltantes_resolver(bigint, text, text);

create function public.faltantes_resolver(p_faltante_id bigint, p_estado text, p_nota text) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_perfil perfil%rowtype;
begin
  if not app_es_admin() then raise exception 'Solo un gerente puede resolver faltantes'; end if;
  if p_estado not in ('REPUESTO', 'CONDONADO') then raise exception 'Estado inválido: %', p_estado; end if;
  perform 1 from caja_faltante where id = p_faltante_id and estado = 'PENDIENTE';
  if not found then raise exception 'Faltante % no existe o ya fue resuelto', p_faltante_id; end if;
  select * into v_perfil from perfil where id = auth.uid();
  update caja_faltante
     set estado = p_estado, resuelto_por = v_perfil.email, resuelto_en = now(), nota = p_nota
   where id = p_faltante_id;
  return jsonb_build_object('faltante_id', p_faltante_id, 'estado', p_estado);
end;
$function$;

revoke all on function public.faltantes_resolver(bigint, text, text) from anon, public;
grant execute on function public.faltantes_resolver(bigint, text, text) to authenticated, service_role;

-- ============================================================================
-- A1b + A2 + A3. _registrar_venta_nucleo — numeración VTA, recibido y verificación
-- de pago. Firma sin cambios (mismos 9 parámetros) — registrar_venta y
-- registrar_venta_forzada son wrappers finos que solo pasan sus argumentos, así que
-- no necesitan tocarse: heredan `numero` en el jsonb de retorno automáticamente.
-- CREATE OR REPLACE, no DROP: la firma no cambia.
-- ============================================================================

create or replace function public._registrar_venta_nucleo(p_lineas jsonb, p_pagos jsonb, p_sesion_caja_id bigint, p_cliente_id bigint, p_descuento_total numeric, p_usuario text, p_idempotencia text, p_forzar_reserva boolean, p_motivo_forzado text)
 returns jsonb
 language plpgsql
as $function$
declare
  v_venta_id bigint; v_header_ubic bigint; v_linea jsonb;
  v_prod bigint; v_cant numeric; v_cant_pres numeric; v_factor numeric;
  v_unit numeric; v_lista numeric; v_pres bigint; v_pres_base bigint;
  v_forzada bigint; v_st_forzada numeric; v_st_tienda numeric; v_st_almacen numeric;
  v_suc bigint; v_nombre_suc text; v_restante numeric; v_toma numeric;
  v_primer_kid bigint; v_kid bigint; v_ub record;
  v_sub numeric; v_subtotal numeric := 0; v_total numeric; v_pagado numeric; v_pago jsonb;
  v_previa jsonb;
  v_libre boolean; v_ubic_sobregiro bigint;
  v_ix int := 0;
  v_vendible numeric; v_reserva_motivo text; v_exceso numeric;
  -- Brief Caja-1: numeración propia VTA-2026-NNNNN (A1) y recibido/estado de
  -- verificación por pago (A2/A3).
  v_numero text; v_anio int;
  v_metodo metodo_pago; v_recibido numeric; v_estado_verif text;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array no vacío';
  end if;

  if p_forzar_reserva and (p_motivo_forzado is null or btrim(p_motivo_forzado) = '') then
    raise exception 'El motivo es obligatorio para vender por encima de la reserva';
  end if;

  if p_idempotencia is not null then
    if btrim(p_idempotencia) = '' or length(p_idempotencia) > 200 then
      raise exception 'Clave de idempotencia inválida (vacía, en blanco, o mayor a 200 caracteres)';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('venta:' || p_idempotencia, 0));
    select jsonb_build_object('venta_id', v.id, 'numero', v.numero, 'subtotal', v.subtotal,
             'descuento_total', v.descuento_total, 'total', v.total, 'reintento', true)
      into v_previa
      from venta v
     where v.idempotencia_clave = p_idempotencia;
    if v_previa is not null then
      return v_previa;
    end if;
  end if;

  perform 1 from sesion_caja where id = p_sesion_caja_id and estado = 'ABIERTA';
  if not found then raise exception 'No hay una sesión de caja abierta (%).', p_sesion_caja_id; end if;

  select id into v_header_ubic from ubicacion where sucursal_id = 2 order by id limit 1;
  if v_header_ubic is null then select id into v_header_ubic from ubicacion order by id limit 1; end if;

  -- A1: numeración gap-free — se asigna en la MISMA transacción que la venta, así
  -- que un rollback más abajo (stock insuficiente, pago que no cuadra, etc.) también
  -- revierte el incremento del contador. Mismo patrón que abrir_venta (serie VTD).
  v_anio := extract(year from now() at time zone 'America/La_Paz')::int;
  v_numero := formato_numero('VTA', v_anio, siguiente_numero('VTA', v_anio));

  insert into venta (numero, cliente_id, ubicacion_id, estado, creado_por, sesion_caja_id, idempotencia_clave)
  values (v_numero, p_cliente_id, v_header_ubic, 'ABIERTA', p_usuario, p_sesion_caja_id, p_idempotencia)
  returning id into v_venta_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_ix := v_ix + 1;

    v_prod  := (v_linea->>'producto_id')::bigint;
    v_unit  := (v_linea->>'precio_unitario')::numeric;
    v_lista := coalesce((v_linea->>'precio_lista')::numeric, v_unit);
    v_pres  := (v_linea->>'presentacion_id')::bigint;
    if v_prod is null or v_unit is null then
      raise exception 'Línea inválida (producto_id/precio_unitario)';
    end if;

    select id into v_pres_base from presentacion
     where producto_id = v_prod and es_base = true and coalesce(activo, true) = true limit 1;
    if v_pres_base is null then raise exception 'Producto % sin presentación base', v_prod; end if;

    if v_pres is not null then
      select factor_unidad_base into v_factor from presentacion
       where id = v_pres and producto_id = v_prod and coalesce(activo, true);
      if v_factor is null then
        raise exception 'La presentación % no pertenece al producto % (o está inactiva)', v_pres, v_prod;
      end if;
      v_cant_pres := (v_linea->>'cantidad_presentacion')::numeric;
      if v_cant_pres is null or v_cant_pres <= 0 then
        raise exception 'cantidad_presentacion debe ser positiva';
      end if;
      v_cant := v_cant_pres * v_factor;
    else
      v_pres := v_pres_base;
      v_cant := coalesce((v_linea->>'cantidad_base')::numeric, (v_linea->>'cantidad')::numeric);
      v_cant_pres := v_cant;
    end if;
    if v_cant is null or v_cant <= 0 then raise exception 'cantidad debe ser positiva'; end if;

    -- ── COMPUERTA 1: origen forzado por el POS ───────────────────────────────
    v_forzada := (v_linea->>'sucursal_origen_id')::bigint;
    if v_forzada is not null then
      v_libre := coalesce(permite_sobregiro_sucursal(v_prod, v_forzada), false);
      select coalesce(sum(sa.cantidad_base), 0) into v_st_forzada
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_forzada;
      if v_st_forzada < v_cant and not v_libre then
        select nombre into v_nombre_suc from sucursal where id = v_forzada;
        raise exception 'Stock insuficiente en % para el producto % (necesita %, hay %)',
          coalesce(v_nombre_suc, 'sucursal ' || v_forzada), v_prod, v_cant, v_st_forzada;
      end if;
      v_suc := v_forzada;
    else
      -- ── COMPUERTA 2: elección automática de sucursal ───────────────────────
      select coalesce(sum(sa.cantidad_base), 0) into v_st_tienda
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = 2;
      select coalesce(sum(sa.cantidad_base), 0) into v_st_almacen
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = 1;
      if v_st_tienda >= v_cant then v_suc := 2;
      elsif v_st_almacen >= v_cant then v_suc := 1;
      elsif coalesce(permite_sobregiro_sucursal(v_prod, 2), false) then
        v_suc := 2;
      else
        raise exception 'Stock insuficiente para producto % (necesita %, Tienda %, Almacén %)',
          v_prod, v_cant, v_st_tienda, v_st_almacen;
      end if;
      v_libre := coalesce(permite_sobregiro_sucursal(v_prod, v_suc), false);
    end if;

    -- ── COMPUERTA 2.5: protección de reservas ────────────────────────────────
    select vendible, motivo into v_vendible, v_reserva_motivo
      from saldo_vendible(array[v_prod], v_suc)
     limit 1;

    if v_cant > coalesce(v_vendible, 0) then
      v_exceso := v_cant - coalesce(v_vendible, 0);
      if not p_forzar_reserva then
        raise exception 'Producto % está reservado: % unidad(es) comprometidas para % en esta sucursal (vendible real: %)',
          v_prod, v_exceso, coalesce(v_reserva_motivo, 'otro pedido'), coalesce(v_vendible, 0)
          using errcode = 'check_violation';
      else
        insert into venta_sobre_reserva (venta_id, producto_id, cantidad_base, pedidos_afectados, motivo, usuario)
        values (v_venta_id, v_prod, v_exceso, v_reserva_motivo, p_motivo_forzado, p_usuario);
      end if;
    end if;

    -- ── COMPUERTA 3: reparto entre ubicaciones ───────────────────────────────
    v_restante := v_cant; v_primer_kid := null;
    for v_ub in
      select sa.ubicacion_id, sa.cantidad_base
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_suc and sa.cantidad_base > 0
       order by sa.cantidad_base desc
    loop
      exit when v_restante <= 0;
      v_toma := least(v_restante, v_ub.cantidad_base);
      v_kid := registrar_salida(v_pres_base, v_ub.ubicacion_id, v_toma,
        'Venta #' || v_venta_id, p_usuario, current_date,
        'venta:' || v_venta_id || ':l' || v_ix || ':p' || v_prod || ':u' || v_ub.ubicacion_id, false);
      if v_primer_kid is null then v_primer_kid := v_kid; end if;
      v_restante := v_restante - v_toma;
    end loop;

    if v_restante > 0 then
      if not v_libre then
        raise exception 'Stock insuficiente (carrera) producto %', v_prod;
      end if;
      select sa.ubicacion_id into v_ubic_sobregiro
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_prod and u.sucursal_id = v_suc
       order by sa.cantidad_base desc limit 1;
      if v_ubic_sobregiro is null then
        select id into v_ubic_sobregiro from ubicacion
         where sucursal_id = v_suc order by id limit 1;
      end if;
      if v_ubic_sobregiro is null then
        raise exception 'La sucursal % no tiene ninguna ubicación configurada', v_suc;
      end if;

      v_kid := registrar_salida(v_pres_base, v_ubic_sobregiro, v_restante,
        'Venta #' || v_venta_id, p_usuario, current_date,
        'venta:' || v_venta_id || ':l' || v_ix || ':p' || v_prod || ':sobregiro', true);
      if v_primer_kid is null then v_primer_kid := v_kid; end if;
      v_restante := 0;
    end if;

    v_sub := round(v_unit * v_cant_pres, 2);
    insert into venta_linea (venta_id, producto_id, presentacion_id, cantidad,
                             cantidad_presentacion, precio_lista, precio_unitario,
                             kardex_transaccion_id)
    values (v_venta_id, v_prod, v_pres, v_cant, v_cant_pres, v_lista, v_unit, v_primer_kid);
    v_subtotal := v_subtotal + v_sub;
  end loop;

  v_total := round(v_subtotal - coalesce(p_descuento_total, 0), 2);
  select coalesce(sum((p->>'monto')::numeric), 0) into v_pagado from jsonb_array_elements(p_pagos) p;
  if round(v_pagado, 2) <> v_total then
    raise exception 'El pago (%) no coincide con el total (%)', v_pagado, v_total;
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := (v_pago->>'metodo')::metodo_pago;

    -- A2: "recibido" (solo tiene sentido en EFECTIVO, pero se valida siempre que
    -- venga) nunca entra en la suma de p_pagos — el chequeo de arriba ya corrió.
    v_recibido := (v_pago->>'recibido')::numeric;
    if v_recibido is not null and v_recibido < (v_pago->>'monto')::numeric then
      raise exception 'El monto recibido (%) no puede ser menor al monto del pago (%)', v_recibido, (v_pago->>'monto')::numeric;
    end if;

    -- A3: QR/TRANSFERENCIA quedan PENDIENTE de verificación (Caja-2 los concilia);
    -- EFECTIVO (y cualquier otro método que llegue por acá) no aplica.
    v_estado_verif := case when v_metodo in ('QR', 'TRANSFERENCIA') then 'PENDIENTE' else 'NO_APLICA' end;

    insert into venta_pago (venta_id, metodo, monto, recibido, referencia, estado_verificacion)
    values (v_venta_id, v_metodo, (v_pago->>'monto')::numeric, v_recibido, v_pago->>'referencia', v_estado_verif);
    insert into movimiento_caja (sesion_caja_id, tipo, metodo, monto, venta_id, creado_por)
    values (p_sesion_caja_id, 'VENTA', v_metodo, (v_pago->>'monto')::numeric, v_venta_id, p_usuario);
  end loop;
  update venta set subtotal = v_subtotal, descuento_total = coalesce(p_descuento_total, 0),
                   total = v_total, estado = 'COMPLETADA', completado_en = now()
   where id = v_venta_id;
  return jsonb_build_object('venta_id', v_venta_id, 'numero', v_numero, 'subtotal', v_subtotal,
                            'descuento_total', coalesce(p_descuento_total, 0), 'total', v_total);
end;
$function$;

revoke all on function public._registrar_venta_nucleo(jsonb, jsonb, bigint, bigint, numeric, text, text, boolean, text) from anon, public;
grant execute on function public._registrar_venta_nucleo(jsonb, jsonb, bigint, bigint, numeric, text, text, boolean, text) to authenticated, service_role;

-- ============================================================================
-- Annulment rights (decisión 23) — solo gerente/admin anulan. CREATE OR REPLACE
-- completo (firma sin cambios: app_puede_revertir_venta(bigint, text)) — se copia
-- tal cual la definición viva y se le agrega únicamente el corte para p_motivo =
-- 'anular'. Cualquier otro motivo queda exactamente igual que hoy.
-- ============================================================================

create or replace function public.app_puede_revertir_venta(p_venta_id bigint, p_motivo text default 'revertir'::text)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_rol       text;
  v_venta     venta%rowtype;
  v_ses       sesion_caja%rowtype;
  v_email     text;
begin
  v_rol := app_rol_actual();

  -- Sin perfil = service_role o backend. Autorizado (ver nota arriba).
  if v_rol is null then
    return null;
  end if;

  -- Admin y gerente pueden siempre.
  if v_rol in ('admin', 'gerente') then
    return null;
  end if;

  if v_rol <> 'cajero' then
    return format('El rol %s no puede %s ventas.', v_rol, p_motivo);
  end if;

  -- Decisión 23: anular es exclusivo de gerente/admin — un cajero jamás anula,
  -- ni siquiera dentro de su propio turno. Corte incondicional, antes de llegar
  -- a las validaciones de "propio turno" de más abajo (que siguen aplicando tal
  -- cual para cualquier otro motivo).
  if p_motivo = 'anular' then
    return 'Solo un gerente puede anular ventas.';
  end if;

  -- ── A partir de acá, es cajero con un motivo != 'anular': solo dentro de su propio turno ──
  select * into v_venta from venta where id = p_venta_id;
  if not found then
    return format('La venta %s no existe.', p_venta_id);
  end if;

  if v_venta.sesion_caja_id is null then
    return format(
      'La venta %s no está asociada a ninguna sesión de caja: requiere gerente.',
      p_venta_id);
  end if;

  select * into v_ses from sesion_caja where id = v_venta.sesion_caja_id;

  if v_ses.estado <> 'ABIERTA' then
    return format(
      'El turno en que se cobró la venta %s ya cerró: requiere gerente.',
      p_venta_id);
  end if;

  select email into v_email from perfil where id = auth.uid();

  if v_ses.abierta_por is distinct from v_email then
    return format(
      'La venta %s pertenece al turno de otro cajero (%s): requiere gerente.',
      p_venta_id, coalesce(v_ses.abierta_por, 'desconocido'));
  end if;

  return null;
end;
$function$;

revoke all on function public.app_puede_revertir_venta(bigint, text) from anon, public;
grant execute on function public.app_puede_revertir_venta(bigint, text) to authenticated, service_role;

-- ============================================================================
-- B1 (Reportes): v_reporte_ventas necesita `numero` para que la lista de ventas del
-- reporte muestre VTA-2026-NNNNN / VTD-2026-NNNNN en vez de un id crudo. Mismo cuerpo
-- que la vista viva (verificado con pg_get_viewdef) — `numero` se agrega al FINAL de
-- la lista de columnas a propósito: CREATE OR REPLACE VIEW no permite reordenar ni
-- insertar en medio de las columnas existentes (solo agregar al final), verificado
-- contra la base viva.
-- ============================================================================

create or replace view v_reporte_ventas as
 SELECT v.id AS venta_id,
    v.completado_en::date AS fecha,
    v.creado_por AS vendedor,
    v.cliente_id,
    c.nombre AS cliente,
    v.subtotal,
    v.descuento_total,
    v.total,
    v.sesion_caja_id,
    ( SELECT string_agg(DISTINCT vp.metodo::text, '+'::text) AS string_agg
           FROM venta_pago vp
          WHERE vp.venta_id = v.id) AS metodos,
    v.numero
   FROM venta v
     LEFT JOIN cliente c ON c.id = v.cliente_id
  WHERE v.estado = 'COMPLETADA'::estado_venta;

-- ============================================================================
-- Legacy: abrir_caja / cerrar_caja / registrar_movimiento se dejan intactas en
-- esta migración — el frontend actualmente desplegado las sigue usando hasta que
-- este PR se mergee y despliegue. TODO cleanup: una vez confirmado el despliegue
-- del nuevo CashPage (abrir_turno/cerrar_turno/registrar_movimiento_turno), aplicar
-- en una migración POSTERIOR:
--
--   revoke all on function public.abrir_caja(bigint, numeric, text) from anon, public, authenticated, service_role;
--   revoke all on function public.cerrar_caja(bigint, numeric, text) from anon, public, authenticated, service_role;
--   revoke all on function public.registrar_movimiento(bigint, tipo_movimiento_caja, numeric, metodo_pago, text, text) from anon, public, authenticated, service_role;
--
-- (o directamente DROP FUNCTION, si para entonces se confirma que nada más las llama).

-- ============================================================================
-- Verificación (correr después de aplicar, antes y en producción)
-- ============================================================================

-- select numero, count(*) from venta where numero like 'VTA-%' group by 1 having count(*) > 1; -- debe ser 0 filas (unicidad)
-- select count(*) from venta where numero is null; -- debe ser 0
-- select * from contador_documento where tipo = 'VTA'; -- ultimo_valor = 15 (o el total de VTA ya emitidas)
-- select estado_verificacion, count(*) from venta_pago group by 1; -- QR/TRANSFERENCIA viejos deben quedar VERIFICADO
-- select proname from pg_proc where proname in ('abrir_turno','registrar_movimiento_turno','resolver_gasto','cerrar_turno','revisar_turno','registrar_arqueo_sorpresa','resumen_turno','faltantes_resolver'); -- 8 filas
-- select p.proname, r.grantee from information_schema.routine_privileges r join pg_proc p on p.proname = r.routine_name where r.routine_name in ('abrir_turno','cerrar_turno','resumen_turno') and r.grantee in ('anon','public'); -- 0 filas
