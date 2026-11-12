-- ============================================================================
-- 20261112110000_piso_turno_reclamos.sql
-- Atención en piso (celular): turno con asistencia, «Ventas de caja · Es mía»
-- y «Venta no realizada» con motivo por producto.
-- Requiere: 20261111233000_reponedor_traslados_y_cuenta.sql y
--           20261112100000_compras_demanda_ideas.sql (aplicadas).
--
-- Decisiones (Ness con el cliente, 2026-11-12):
--   · Turno: lo marcan reponedor y vendedor. Sirve también de asistencia.
--     Si no lo cierran, se cierra solo al final del día (23:59:59 La Paz) y
--     queda «AUTOMATICO» (sin salida). El gerente corrige horas con motivo.
--     Rony (gerente) ve el reporte.
--   · «Es mía»: el reponedor reclama una venta que caja cobró sin vendedor.
--     Solo de su sucursal, estando en turno y dentro de 30 min. Puede
--     deshacer su reclamo en 5 min. Una venta, un dueño. Si hay conflicto
--     decide caja (caja_asignar_vendedor).
--   · El reclamo va en tabla aparte: NO se toca public.venta (sus triggers de
--     caja/VTD, saldo y comisión quedan igual). Las comisiones no cambian.
--   · El reponedor ve solo lo mínimo: monto, primer producto, hora y ticket.
--     Nunca cliente, pagos, cajero ni ventas reclamadas por otros.
--   · Venta no realizada: varios productos, un motivo por producto:
--       NO_HAY   → demanda (misma idea que «Lo que nos piden»);
--       MUY_CARO → señal para «Precios por revisar» (sin idea);
--       OTRO     → con una palabra de motivo (sin idea).
--
-- No cambia: pedido_vendedor y su cobro, anular, traslados, comisiones,
-- anotar_demanda (sigue funcionando y anota motivo NO_HAY).
-- Ensayo: supabase/ensayos/20261112110000_piso_turno_reclamos_ENSAYO.sql
-- ============================================================================

begin;

-- 1. Turno de piso -------------------------------------------------------------------
create table public.piso_turno (
  id          bigint generated always as identity primary key,
  perfil_id   uuid not null references public.perfil(id),
  sucursal_id bigint not null references public.sucursal(id),
  fecha       date not null,                       -- día de La Paz en que empezó
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  cierre      text check (cierre in ('MANUAL', 'AUTOMATICO', 'GERENTE')),
  corregido   boolean not null default false,
  creado_en   timestamptz not null default now(),
  constraint piso_turno_fin_con_cierre check ((fin is null) = (cierre is null)),
  constraint piso_turno_orden check (fin is null or fin >= inicio)
);
-- Un solo turno abierto por persona.
create unique index piso_turno_abierto_uq on public.piso_turno (perfil_id) where fin is null;
create index piso_turno_fecha_idx on public.piso_turno (fecha, perfil_id);

create table public.piso_turno_correccion (
  id            bigint generated always as identity primary key,
  turno_id      bigint not null references public.piso_turno(id),
  inicio_antes  timestamptz not null,
  fin_antes     timestamptz,
  inicio_nuevo  timestamptz not null,
  fin_nuevo     timestamptz not null,
  motivo        text not null check (btrim(motivo) <> ''),
  corregido_por uuid not null references public.perfil(id),
  corregido_en  timestamptz not null default now()
);

-- 2. Reclamos de ventas de caja ---------------------------------------------------------
create table public.venta_reclamo (
  id             bigint generated always as identity primary key,
  venta_id       bigint not null references public.venta(id),
  perfil_id      uuid not null references public.perfil(id),
  turno_id       bigint references public.piso_turno(id),
  origen         text not null check (origen in ('RECLAMO', 'CAJA')),
  asignado_por   uuid references public.perfil(id),
  motivo         text,
  reclamado_en   timestamptz not null default now(),
  anulado_en     timestamptz,
  anulado_por    uuid references public.perfil(id),
  anulado_motivo text,
  constraint venta_reclamo_caja_con_quien check (origen <> 'CAJA' or asignado_por is not null),
  constraint venta_reclamo_anulado check ((anulado_en is null) = (anulado_por is null))
);
-- Una venta, un dueño vigente.
create unique index venta_reclamo_vigente_uq on public.venta_reclamo (venta_id) where anulado_en is null;
create index venta_reclamo_perfil_idx on public.venta_reclamo (perfil_id, reclamado_en desc) where anulado_en is null;

-- 3. Lectura: cada uno lo suyo; caja y gerencia todo --------------------------------------
create or replace function public.app_es_caja_o_gerencia()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.app_rol_actual() in ('cajero', 'supervisor', 'gerente', 'admin'), false);
$function$;
revoke all on function public.app_es_caja_o_gerencia() from anon, public;
grant execute on function public.app_es_caja_o_gerencia() to authenticated, service_role;

alter table public.piso_turno enable row level security;
create policy piso_turno_lectura on public.piso_turno for select to authenticated
  using (perfil_id = auth.uid() or coalesce(public.app_rol_actual() in ('supervisor', 'gerente', 'admin'), false));
alter table public.piso_turno_correccion enable row level security;
create policy piso_turno_correccion_lectura on public.piso_turno_correccion for select to authenticated
  using (coalesce(public.app_rol_actual() in ('supervisor', 'gerente', 'admin'), false));
alter table public.venta_reclamo enable row level security;
create policy venta_reclamo_lectura on public.venta_reclamo for select to authenticated
  using (perfil_id = auth.uid() or public.app_es_caja_o_gerencia());

-- Todo se escribe por funciones.
revoke all on table public.piso_turno, public.piso_turno_correccion, public.venta_reclamo from anon, authenticated;
grant select on table public.piso_turno, public.piso_turno_correccion, public.venta_reclamo to authenticated;

-- 4. Turno: cerrar vencidos, iniciar, finalizar, actual ------------------------------------
-- Cierra los turnos que quedaron abiertos de un día anterior: fin = 23:59:59 de ese día.
create or replace function public.piso_turno_cerrar_vencidos(p_perfil_id uuid default null)
 returns int
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_n int;
begin
  update piso_turno
     set fin = ((fecha + 1)::timestamp - interval '1 second') at time zone 'America/La_Paz',
         cierre = 'AUTOMATICO'
   where fin is null
     and fecha < (now() at time zone 'America/La_Paz')::date
     and (p_perfil_id is null or perfil_id = p_perfil_id);
  get diagnostics v_n = row_count;
  return v_n;
end $function$;
revoke all on function public.piso_turno_cerrar_vencidos(uuid) from anon, public, authenticated;
grant execute on function public.piso_turno_cerrar_vencidos(uuid) to service_role;

-- Resumen del turno abierto de quien llama ({turno_id: null} si no hay).
create or replace function public.piso_turno_actual()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   piso_turno%rowtype;
  v_hoy date := (now() at time zone 'America/La_Paz')::date;
begin
  if not exists (select 1 from perfil where id = v_uid and activo) then
    raise exception 'Se requiere un perfil activo' using errcode = '42501';
  end if;
  perform piso_turno_cerrar_vencidos(v_uid);
  select * into v_t from piso_turno where perfil_id = v_uid and fin is null;
  if not found then
    return jsonb_build_object('turno_id', null);
  end if;
  return jsonb_build_object(
    'turno_id', v_t.id,
    'inicio', v_t.inicio,
    'sucursal_id', v_t.sucursal_id,
    -- Cobradas en el turno: las que armó y caja cobró, más las que reclamó.
    'cobradas',
      (select count(*) from pedido_vendedor p
        where p.vendedor_id = v_uid and p.estado = 'COBRADO' and p.cobrado_en >= v_t.inicio)
      + (select count(*) from venta_reclamo r join venta v on v.id = r.venta_id
          where r.perfil_id = v_uid and r.anulado_en is null and r.reclamado_en >= v_t.inicio
            and v.estado = 'COMPLETADA'),
    'por_cobrar',
      (select count(*) from pedido_vendedor p
        where p.vendedor_id = v_uid and p.fecha = v_hoy and p.estado in ('ENVIADO', 'EN_CAJA')),
    'no_realizadas',
      (select count(distinct d.visita) from demanda_cliente d where d.turno_id = v_t.id),
    'por_reclamar',
      (select count(*) from _ventas_reclamables(v_t.sucursal_id)));
end $function$;

-- Ventas que se pueden reclamar en una sucursal (uso interno).
create or replace function public._ventas_reclamables(p_sucursal_id bigint)
 returns table (venta_id bigint, numero text, total numeric, completado_en timestamptz, producto text, n_productos bigint)
 language sql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
  select v.id, v.numero, v.total, v.completado_en,
         (select coalesce(pr.nombre, vl.descripcion) from venta_linea vl
            left join producto pr on pr.id = vl.producto_id
           where vl.venta_id = v.id order by vl.id limit 1),
         (select count(*) from venta_linea vl where vl.venta_id = v.id)
    from venta v
    join ubicacion u on u.id = v.ubicacion_id
   where u.sucursal_id = p_sucursal_id
     and v.estado = 'COMPLETADA'
     and v.vendedor_id is null
     and v.completado_en >= now() - interval '30 minutes'
     and not exists (select 1 from venta_reclamo r where r.venta_id = v.id and r.anulado_en is null)
     and not exists (select 1 from pedido_vendedor p where p.venta_id = v.id)
   order by v.completado_en desc;
$function$;
revoke all on function public._ventas_reclamables(bigint) from anon, public, authenticated;

revoke all on function public.piso_turno_actual() from anon, public;
grant execute on function public.piso_turno_actual() to authenticated, service_role;

create or replace function public.piso_turno_iniciar(p_sucursal_id bigint default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_perfil perfil%rowtype;
  v_suc    bigint;
begin
  select * into v_perfil from perfil where id = auth.uid() and activo;
  if not found then raise exception 'Se requiere un perfil activo' using errcode = '42501'; end if;
  if v_perfil.rol not in ('reponedor', 'vendedor') then
    raise exception 'El turno de piso es para reponedores y vendedores' using errcode = '42501';
  end if;
  v_suc := coalesce(p_sucursal_id, v_perfil.sucursal_id);
  if v_suc is null then
    raise exception 'Elige la sucursal donde atiendes';
  end if;
  if not exists (select 1 from sucursal where id = v_suc and activo and tipo <> 'virtual') then
    raise exception 'Selecciona una sucursal física activa';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('piso_turno:' || v_perfil.id::text, 0));
  perform piso_turno_cerrar_vencidos(v_perfil.id);
  if not exists (select 1 from piso_turno where perfil_id = v_perfil.id and fin is null) then
    insert into piso_turno (perfil_id, sucursal_id, fecha)
    values (v_perfil.id, v_suc, (now() at time zone 'America/La_Paz')::date);
  end if;
  return piso_turno_actual();
end $function$;
revoke all on function public.piso_turno_iniciar(bigint) from anon, public;
grant execute on function public.piso_turno_iniciar(bigint) to authenticated, service_role;

create or replace function public.piso_turno_finalizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_id bigint; v_inicio timestamptz;
begin
  update piso_turno set fin = now(), cierre = 'MANUAL'
   where perfil_id = auth.uid() and fin is null
  returning id, inicio into v_id, v_inicio;
  if v_id is null then raise exception 'No tienes un turno abierto'; end if;
  return jsonb_build_object('turno_id', v_id, 'inicio', v_inicio, 'fin', now());
end $function$;
revoke all on function public.piso_turno_finalizar() from anon, public;
grant execute on function public.piso_turno_finalizar() to authenticated, service_role;

-- 5. Asistencia: corregir y reportar ----------------------------------------------------------
create or replace function public.piso_turno_corregir(p_turno_id bigint, p_inicio timestamptz, p_fin timestamptz, p_motivo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_t piso_turno%rowtype;
begin
  if coalesce(app_rol_actual() not in ('gerente', 'admin'), true) then
    raise exception 'Solo el gerente corrige horas' using errcode = '42501';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'El motivo es obligatorio'; end if;
  if p_inicio is null or p_fin is null or p_fin < p_inicio then raise exception 'Horas no válidas'; end if;
  select * into v_t from piso_turno where id = p_turno_id for update;
  if not found then raise exception 'El turno % no existe', p_turno_id; end if;
  insert into piso_turno_correccion (turno_id, inicio_antes, fin_antes, inicio_nuevo, fin_nuevo, motivo, corregido_por)
  values (v_t.id, v_t.inicio, v_t.fin, p_inicio, p_fin, left(btrim(p_motivo), 300), auth.uid());
  update piso_turno set inicio = p_inicio, fin = p_fin, cierre = 'GERENTE', corregido = true where id = v_t.id;
  return jsonb_build_object('turno_id', v_t.id, 'inicio', p_inicio, 'fin', p_fin);
end $function$;
revoke all on function public.piso_turno_corregir(bigint, timestamptz, timestamptz, text) from anon, public;
grant execute on function public.piso_turno_corregir(bigint, timestamptz, timestamptz, text) to authenticated, service_role;

create or replace function public.piso_asistencia(p_desde date, p_hasta date)
 returns table (turno_id bigint, perfil_id uuid, nombre text, rol text, sucursal text, fecha date,
                inicio timestamptz, fin timestamptz, horas numeric, cierre text, corregido boolean)
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if coalesce(app_rol_actual() not in ('supervisor', 'gerente', 'admin'), true) then
    raise exception 'Solo gerencia ve la asistencia' using errcode = '42501';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 92 then raise exception 'Rango no válido (máximo 92 días)'; end if;
  return query
  select t.id, t.perfil_id, p.nombre, p.rol::text, s.nombre::text, t.fecha, t.inicio, t.fin,
         case when t.fin is null then null else round(extract(epoch from (t.fin - t.inicio)) / 3600, 2) end,
         t.cierre, t.corregido
    from piso_turno t
    join perfil p on p.id = t.perfil_id
    join sucursal s on s.id = t.sucursal_id
   where t.fecha between p_desde and p_hasta
   order by t.fecha desc, p.nombre, t.inicio;
end $function$;
revoke all on function public.piso_asistencia(date, date) from anon, public;
grant execute on function public.piso_asistencia(date, date) to authenticated, service_role;

-- 6. Ventas de caja: listar, reclamar, deshacer --------------------------------------------------
create or replace function public.ventas_por_reclamar()
 returns table (venta_id bigint, numero text, total numeric, completado_en timestamptz, producto text, n_productos bigint)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_t piso_turno%rowtype;
begin
  perform piso_turno_cerrar_vencidos(auth.uid());   -- un turno olvidado de ayer no cuenta
  select * into v_t from piso_turno where perfil_id = auth.uid() and fin is null;
  if not found then raise exception 'Inicia tu turno para ver las ventas de caja' using errcode = '42501'; end if;
  return query select * from _ventas_reclamables(v_t.sucursal_id);
end $function$;
revoke all on function public.ventas_por_reclamar() from anon, public;
grant execute on function public.ventas_por_reclamar() to authenticated, service_role;

create or replace function public.reclamar_venta(p_venta_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_t piso_turno%rowtype; v_id bigint;
begin
  if coalesce(app_rol_actual() not in ('reponedor', 'vendedor'), true) then
    raise exception 'Solo reponedores y vendedores reclaman ventas' using errcode = '42501';
  end if;
  perform piso_turno_cerrar_vencidos(auth.uid());   -- un turno olvidado de ayer no cuenta
  select * into v_t from piso_turno where perfil_id = auth.uid() and fin is null;
  if not found then raise exception 'Inicia tu turno para reclamar ventas' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('venta_reclamo:' || p_venta_id::text, 0));
  if not exists (select 1 from _ventas_reclamables(v_t.sucursal_id) r where r.venta_id = p_venta_id) then
    raise exception 'Esta venta ya no se puede reclamar (ya tiene dueño, pasaron los 30 minutos o es de otra sucursal)';
  end if;
  insert into venta_reclamo (venta_id, perfil_id, turno_id, origen)
  values (p_venta_id, auth.uid(), v_t.id, 'RECLAMO')
  returning id into v_id;
  return jsonb_build_object('reclamo_id', v_id, 'venta_id', p_venta_id, 'deshacer_hasta', now() + interval '5 minutes');
end $function$;
revoke all on function public.reclamar_venta(bigint) from anon, public;
grant execute on function public.reclamar_venta(bigint) to authenticated, service_role;

create or replace function public.deshacer_reclamo(p_venta_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_r venta_reclamo%rowtype;
begin
  select * into v_r from venta_reclamo
   where venta_id = p_venta_id and anulado_en is null and perfil_id = auth.uid() and origen = 'RECLAMO'
   for update;
  if not found then raise exception 'No tienes un reclamo vigente sobre esta venta'; end if;
  if v_r.reclamado_en < now() - interval '5 minutes' then
    raise exception 'Pasaron los 5 minutos: pide a caja que lo corrija';
  end if;
  update venta_reclamo set anulado_en = now(), anulado_por = auth.uid(), anulado_motivo = 'Deshecho por quien lo reclamó'
   where id = v_r.id;
  return jsonb_build_object('venta_id', p_venta_id, 'deshecho', true);
end $function$;
revoke all on function public.deshacer_reclamo(bigint) from anon, public;
grant execute on function public.deshacer_reclamo(bigint) to authenticated, service_role;

-- 7. Caja: ver y corregir de quién es una venta ------------------------------------------------
create or replace function public.caja_reclamos(p_venta_ids bigint[])
 returns table (venta_id bigint, perfil_id uuid, nombre text, origen text, reclamado_en timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not app_es_caja_o_gerencia() then
    raise exception 'Solo caja y gerencia ven los reclamos' using errcode = '42501';
  end if;
  return query
  select r.venta_id, r.perfil_id, p.nombre, r.origen, r.reclamado_en
    from venta_reclamo r join perfil p on p.id = r.perfil_id
   where r.venta_id = any(p_venta_ids) and r.anulado_en is null;
end $function$;
revoke all on function public.caja_reclamos(bigint[]) from anon, public;
grant execute on function public.caja_reclamos(bigint[]) to authenticated, service_role;

-- p_perfil_id null = dejar la venta sin dueño. Cambiar un dueño existente exige motivo.
create or replace function public.caja_asignar_vendedor(p_venta_id bigint, p_perfil_id uuid, p_motivo text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rol text := app_rol_actual();
  v_v venta%rowtype; v_r venta_reclamo%rowtype; v_motivo text := nullif(btrim(p_motivo), '');
begin
  if not app_es_caja_o_gerencia() then
    raise exception 'Solo caja y gerencia asignan ventas' using errcode = '42501';
  end if;
  select * into v_v from venta where id = p_venta_id;
  if not found then raise exception 'La venta % no existe', p_venta_id; end if;
  if v_v.estado <> 'COMPLETADA' then raise exception 'Solo se asignan ventas cobradas'; end if;
  if exists (select 1 from pedido_vendedor where venta_id = p_venta_id) then
    raise exception 'Esta venta vino de un pedido de vendedor: ya tiene dueño';
  end if;
  if v_rol = 'cajero' and (v_v.completado_en at time zone 'America/La_Paz')::date <> (now() at time zone 'America/La_Paz')::date then
    raise exception 'Caja solo corrige ventas de hoy; para días anteriores, el gerente';
  end if;
  if p_perfil_id is not null and not exists (
       select 1 from perfil where id = p_perfil_id and activo and rol in ('reponedor', 'vendedor')) then
    raise exception 'Solo se asigna a un reponedor o vendedor activo';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('venta_reclamo:' || p_venta_id::text, 0));
  select * into v_r from venta_reclamo where venta_id = p_venta_id and anulado_en is null for update;
  if found then
    if v_r.perfil_id = p_perfil_id then
      return jsonb_build_object('venta_id', p_venta_id, 'perfil_id', p_perfil_id, 'cambio', false);
    end if;
    if v_motivo is null then raise exception 'Para cambiar el dueño de una venta, escribe el motivo'; end if;
    update venta_reclamo set anulado_en = now(), anulado_por = auth.uid(), anulado_motivo = left(v_motivo, 300)
     where id = v_r.id;
  end if;
  if p_perfil_id is not null then
    insert into venta_reclamo (venta_id, perfil_id, origen, asignado_por, motivo)
    values (p_venta_id, p_perfil_id, 'CAJA', auth.uid(), left(v_motivo, 300));
  end if;
  return jsonb_build_object('venta_id', p_venta_id, 'perfil_id', p_perfil_id, 'cambio', true);
end $function$;
revoke all on function public.caja_asignar_vendedor(bigint, uuid, text) from anon, public;
grant execute on function public.caja_asignar_vendedor(bigint, uuid, text) to authenticated, service_role;

-- A quién puede asignar caja una venta: reponedores y vendedores activos (sin email ni sucursal).
create or replace function public.caja_vendedores_piso()
 returns table (perfil_id uuid, nombre text, en_turno boolean)
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not app_es_caja_o_gerencia() then
    raise exception 'Solo caja y gerencia' using errcode = '42501';
  end if;
  return query
  select p.id, p.nombre, exists (select 1 from piso_turno t where t.perfil_id = p.id and t.fin is null
                                   and t.fecha = (now() at time zone 'America/La_Paz')::date)
    from perfil p
   where p.activo and p.rol in ('reponedor', 'vendedor')
   order by 3 desc, p.nombre;
end $function$;
revoke all on function public.caja_vendedores_piso() from anon, public;
grant execute on function public.caja_vendedores_piso() to authenticated, service_role;

-- 8. Venta no realizada --------------------------------------------------------------------------
alter table public.demanda_cliente alter column idea_id drop not null;
alter table public.demanda_cliente
  add column motivo       text not null default 'NO_HAY' check (motivo in ('NO_HAY', 'MUY_CARO', 'OTRO')),
  add column motivo_texto text,
  add column visita       uuid,
  add column turno_id     bigint references public.piso_turno(id);
alter table public.demanda_cliente
  add constraint demanda_idea_solo_no_hay check ((motivo = 'NO_HAY') = (idea_id is not null)),
  add constraint demanda_otro_con_texto check (motivo <> 'OTRO' or nullif(btrim(motivo_texto), '') is not null);
create index demanda_cliente_turno_idx on public.demanda_cliente (turno_id) where turno_id is not null;
create index demanda_cliente_muy_caro_idx on public.demanda_cliente (producto_id, anotado_en desc) where motivo = 'MUY_CARO';

-- p_lineas: [{producto_id?, descripcion?, cantidad?, unidad?, motivo, motivo_texto?}, …] (1 a 20)
-- El contacto, el aviso y la foto se guardan en las líneas NO_HAY.
create or replace function public.registrar_venta_no_realizada(
  p_lineas          jsonb,
  p_canal           text default 'TIENDA',
  p_contacto_nombre text default null,
  p_contacto_tel    text default null,
  p_quiere_aviso    boolean default false,
  p_foto_path       text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_perfil perfil%rowtype;
  v_turno  bigint;
  v_visita uuid := gen_random_uuid();
  v_l jsonb; v_ix int := 0;
  v_prod bigint; v_desc text; v_motivo text; v_texto text; v_cant numeric; v_unidad text;
  v_r jsonb; v_id bigint;
  v_lineas jsonb := '[]'::jsonb;
  v_hay_no_hay boolean := false;
begin
  select * into v_perfil from perfil where id = auth.uid() and activo;
  if not found then raise exception 'Se requiere un perfil activo' using errcode = '42501'; end if;
  perform piso_turno_cerrar_vencidos(v_perfil.id);   -- un turno olvidado de ayer no cuenta
  select id into v_turno from piso_turno where perfil_id = v_perfil.id and fin is null;
  if v_turno is null and v_perfil.rol in ('reponedor', 'vendedor') then
    raise exception 'Inicia tu turno para anotar ventas no realizadas' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un producto';
  end if;
  if jsonb_array_length(p_lineas) > 20 then raise exception 'Hasta 20 productos por venta no realizada'; end if;

  for v_l in select * from jsonb_array_elements(p_lineas) loop
    v_ix := v_ix + 1;
    v_prod   := nullif(v_l ->> 'producto_id', '')::bigint;
    v_desc   := nullif(btrim(v_l ->> 'descripcion'), '');
    v_motivo := coalesce(v_l ->> 'motivo', '');
    v_texto  := nullif(btrim(v_l ->> 'motivo_texto'), '');
    v_cant   := nullif(v_l ->> 'cantidad', '')::numeric;
    v_unidad := coalesce(nullif(v_l ->> 'unidad', ''), 'UNIDADES');
    if v_motivo not in ('NO_HAY', 'MUY_CARO', 'OTRO') then
      raise exception 'Producto %: elige por qué no lo llevó (No hay, Muy caro u Otro)', v_ix;
    end if;
    if v_motivo = 'OTRO' and v_texto is null then
      raise exception 'Producto %: escribe en una palabra el motivo', v_ix;
    end if;

    if v_motivo = 'NO_HAY' then
      v_hay_no_hay := true;
      v_r := anotar_demanda(v_prod, v_desc, p_canal, v_cant, v_unidad, p_contacto_nombre, p_contacto_tel,
                            coalesce(p_quiere_aviso, false), p_foto_path);
      v_id := (v_r ->> 'demanda_id')::bigint;
      update demanda_cliente set visita = v_visita, turno_id = v_turno where id = v_id;
      v_lineas := v_lineas || jsonb_build_object('demanda_id', v_id, 'motivo', v_motivo,
                    'idea_id', v_r -> 'idea_id', 'veces_semana', v_r -> 'veces_semana');
    else
      if v_prod is null and v_desc is null then
        raise exception 'Producto %: indica el producto o descríbelo', v_ix;
      end if;
      if v_prod is not null and not exists (select 1 from producto where id = v_prod) then
        raise exception 'Producto %: no existe en el catálogo', v_ix;
      end if;
      if v_cant is not null and v_cant <= 0 then raise exception 'Producto %: la cantidad debe ser mayor a cero', v_ix; end if;
      if v_unidad not in ('UNIDADES', 'HOJAS', 'PAQUETES', 'CAJAS') then raise exception 'Producto %: unidad no válida', v_ix; end if;
      if p_canal is null or p_canal not in ('TIENDA', 'MAYOR') then raise exception 'Canal no válido: TIENDA o MAYOR'; end if;
      insert into demanda_cliente (producto_id, descripcion, cantidad_aprox, unidad, canal, sucursal_id,
                                   anotado_por, motivo, motivo_texto, visita, turno_id)
      values (v_prod, left(v_desc, 300), v_cant, v_unidad, p_canal, v_perfil.sucursal_id,
              v_perfil.id, v_motivo, left(v_texto, 60), v_visita, v_turno)
      returning id into v_id;
      v_lineas := v_lineas || jsonb_build_object('demanda_id', v_id, 'motivo', v_motivo);
    end if;
  end loop;

  if coalesce(p_quiere_aviso, false) and not v_hay_no_hay then
    raise exception 'El aviso al cliente solo aplica a productos que no había';
  end if;
  return jsonb_build_object('visita', v_visita, 'lineas', v_lineas);
end $function$;
revoke all on function public.registrar_venta_no_realizada(jsonb, text, text, text, boolean, text) from anon, public;
grant execute on function public.registrar_venta_no_realizada(jsonb, text, text, text, boolean, text) to authenticated, service_role;

-- 9. mi_cuenta_vendedor: + ventas reclamadas ----------------------------------------------------
-- Misma firma. Las claves que ya usa el Seller no cambian; se agregan
-- 'reclamadas', 'reclamado_total' y 'reclamos' (sin cajero ni cliente).
create or replace function public.mi_cuenta_vendedor(p_desde date default null, p_hasta date default null, p_perfil uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_rol   text := app_rol_actual();
  v_hoy   date := (now() at time zone 'America/La_Paz')::date;
  v_desde date := coalesce(p_desde, v_hoy);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_quien uuid := coalesce(p_perfil, v_uid);
  v_res   jsonb;
  v_rec   jsonb;
begin
  if v_rol is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v_quien <> v_uid and v_rol not in ('gerente', 'admin') then
    raise exception 'Solo puedes ver tu propia cuenta' using errcode = '42501';
  end if;
  if v_hasta < v_desde or v_hasta - v_desde > 62 then
    raise exception 'Rango de fechas no válido (máximo 62 días)';
  end if;
  with ped as (
    select p.id, p.numero_dia, p.fecha, p.estado, p.total, p.cobrado_en,
           p.anulado_origen, p.anulado_motivo, ve.total as total_venta,
           coalesce((select round(sum(l.cantidad_final * l.precio_final), 2)
                       from pedido_vendedor_linea l
                      where l.pedido_id = p.id and l.resultado = 'COBRADA'), 0) as parte,
           (select count(*) from pedido_vendedor_linea l
             where l.pedido_id = p.id and l.resultado = 'COBRADA'
               and l.precio_final is distinct from l.precio_unitario) as corregidas,
           (select count(*) from pedido_vendedor_linea l
             where l.pedido_id = p.id and l.resultado = 'QUITADA') as quitadas,
           (select count(*) from venta_linea vl
             where vl.venta_id = p.venta_id
               and not exists (select 1 from pedido_vendedor_linea l
                                where l.pedido_id = p.id and l.venta_linea_id = vl.id)) as agregados
      from pedido_vendedor p
      left join venta ve on ve.id = p.venta_id
     where p.vendedor_id = v_quien and p.fecha between v_desde and v_hasta
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'parte', coalesce(sum(parte) filter (where estado = 'COBRADO'), 0),
    'cobradas', count(*) filter (where estado = 'COBRADO'),
    'por_cobrar', count(*) filter (where estado in ('ENVIADO', 'EN_CAJA')),
    'guardadas', count(*) filter (where estado = 'ARMANDO'),
    'anuladas', count(*) filter (where estado = 'ANULADO'),
    'pedidos', coalesce(jsonb_agg(jsonb_build_object(
        'pedido_id', id, 'numero_dia', numero_dia, 'fecha', fecha, 'estado', estado,
        'total_enviado', total, 'cobrado_en', cobrado_en,
        'parte', case when estado = 'COBRADO' then parte end,
        'agregado_caja', case when estado = 'COBRADO' then greatest(coalesce(total_venta, 0) - parte, 0) end,
        'precios_corregidos', corregidas, 'lineas_quitadas', quitadas,
        'productos_agregados_caja', case when estado = 'COBRADO' then agregados end,
        'anulado_origen', anulado_origen, 'anulado_motivo', anulado_motivo)
      order by id desc), '[]'::jsonb))
    into v_res
    from ped;

  -- Reclamadas: ventas de caja que son suyas (por «Es mía» o porque caja se la asignó).
  select jsonb_build_object(
    'reclamadas', count(*) filter (where v.estado = 'COMPLETADA'),
    'reclamado_total', coalesce(sum(v.total) filter (where v.estado = 'COMPLETADA'), 0),
    'reclamos', coalesce(jsonb_agg(jsonb_build_object(
        'venta_id', v.id, 'numero', v.numero, 'total', v.total, 'estado', v.estado,
        'completado_en', v.completado_en, 'origen', r.origen,
        'producto', (select coalesce(pr.nombre, vl.descripcion) from venta_linea vl
                       left join producto pr on pr.id = vl.producto_id
                      where vl.venta_id = v.id order by vl.id limit 1),
        'n_productos', (select count(*) from venta_linea vl where vl.venta_id = v.id))
      order by v.completado_en desc), '[]'::jsonb))
    into v_rec
    from venta_reclamo r
    join venta v on v.id = r.venta_id
   where r.perfil_id = v_quien and r.anulado_en is null
     and (v.completado_en at time zone 'America/La_Paz')::date between v_desde and v_hasta;

  return v_res || v_rec;
end;
$function$;
revoke all on function public.mi_cuenta_vendedor(date, date, uuid) from anon, public;
grant execute on function public.mi_cuenta_vendedor(date, date, uuid) to authenticated, service_role;

-- 10. Cierre automático diario (00:05 La Paz = 04:05 UTC) -----------------------------------------
select cron.schedule('piso_turno_cierre_auto', '5 4 * * *', $$select public.piso_turno_cerrar_vencidos()$$);

commit;
