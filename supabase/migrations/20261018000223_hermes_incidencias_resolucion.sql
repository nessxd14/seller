-- Prioridades altas. Sin corrección automática de datos históricos.
alter table hermes.pago add column devuelto_monto numeric(14,2) not null default 0
  check (devuelto_monto>=0 and devuelto_monto<=monto);

create table hermes.resolucion_operacion (
 id uuid primary key, idempotencia_clave text not null unique,
 cliente_id bigint not null references hermes.cliente(id), pedido_id bigint not null references public.pedido(id),
 tipo text not null check(tipo in ('CANCELACION_RESUELTA','REMANENTE_CANCELADO')),
 motivo text not null check(motivo ~ '[^[:space:]]'), usuario_id uuid not null, usuario text not null,
 solicitud jsonb not null, resultado jsonb not null, antes jsonb not null, creado_en timestamptz not null default now()
);
create index resolucion_pedido_historial on hermes.resolucion_operacion(pedido_id,creado_en,id);
create index resolucion_cliente_historial on hermes.resolucion_operacion(cliente_id,creado_en,id);
create table hermes.resolucion_pago (
 operacion_id uuid not null references hermes.resolucion_operacion(id) deferrable initially deferred,
 pago_id bigint not null references hermes.pago(id), monto numeric(14,2) not null check(monto>0),
 opcion text not null check(opcion in ('SALDO_FAVOR','REASIGNACION','DEVOLUCION')),
 estado_anterior hermes.estado_pago not null, aplicaciones_antes jsonb not null,
 partida_destino_id bigint references hermes.partida_abierta(id), sesion_caja_id bigint references public.sesion_caja(id),
 referencia text, usuario_id uuid not null, creado_tx bigint not null default txid_current(),
 primary key(operacion_id,pago_id)
);
create index resolucion_pago_origen on hermes.resolucion_pago(pago_id);
create index resolucion_pago_destino on hermes.resolucion_pago(partida_destino_id) where partida_destino_id is not null;
create index resolucion_pago_turno on hermes.resolucion_pago(sesion_caja_id) where sesion_caja_id is not null;
-- Conserva las acciones ya admitidas y añade la nueva resolución parcial.
do $$ declare expresion text; begin
 select pg_get_expr(conbin,conrelid) into expresion from pg_constraint where conrelid='public.pedido_evento'::regclass and conname='pedido_evento_accion_check';
 if expresion is not null then
  if expresion not like '%accion%ANY%ARRAY%' then raise exception 'Revisar el contrato de acciones de pedido_evento antes de habilitar el remanente'; end if;
  alter table public.pedido_evento drop constraint pedido_evento_accion_check;
  execute format('alter table public.pedido_evento add constraint pedido_evento_accion_check check ((%s) or accion=''REMANENTE_CANCELADO'')',expresion);
 end if;
end $$;
create or replace function hermes.autor_evento_pedido() returns trigger language plpgsql security invoker set search_path=pg_catalog,public,hermes as $$
begin
 if new.accion in ('ANULADO','RESTAURADO','LINEA_RECHAZADA','PEDIDO_RECHAZADO','REMANENTE_CANCELADO') then
  if current_user<>'postgres' then raise exception 'Registra este evento mediante su operación autorizada' using errcode='42501'; end if;
  if new.motivo is null or new.motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
  new.usuario:=hermes.actor_operacion();new.usuario_id:=auth.uid();new.creado_en:=now();
  new.sistema:=case when new.accion='REMANENTE_CANCELADO' then 'HERMES' when new.accion in ('LINEA_RECHAZADA','PEDIDO_RECHAZADO') then 'ALMACEN' else 'SELLER' end;
 end if;
 return new;
end $$;
create or replace function hermes.conservar_evento_pedido() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.usuario_id is not null or old.accion in ('ANULADO','RESTAURADO','LINEA_RECHAZADA','PEDIDO_RECHAZADO','REMANENTE_CANCELADO') then
  raise exception 'El historial conserva sus motivos y autores. Registra una nueva operación para corregirlo.' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function hermes.autor_evento_pedido(),hermes.conservar_evento_pedido() from public,anon,authenticated,service_role;
alter table hermes.resolucion_operacion enable row level security;
alter table hermes.resolucion_pago enable row level security;
revoke all on hermes.resolucion_operacion,hermes.resolucion_pago from public,anon,authenticated,service_role;
grant select on hermes.resolucion_operacion,hermes.resolucion_pago to authenticated;
create policy resolucion_lectura on hermes.resolucion_operacion for select to authenticated using(public.hermes_tiene_acceso());
create policy resolucion_pago_lectura on hermes.resolucion_pago for select to authenticated using(public.hermes_tiene_acceso());
create function hermes.conservar_resolucion() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'La resolución conserva sus movimientos, motivo y responsable' using errcode='42501'; end $$;
revoke all on function hermes.conservar_resolucion() from public,anon,authenticated,service_role;
create trigger conservar_resolucion before update or delete on hermes.resolucion_operacion for each row execute function hermes.conservar_resolucion();
create trigger conservar_resolucion_pago before update or delete on hermes.resolucion_pago for each row execute function hermes.conservar_resolucion();

create function hermes.exigir_resolutor() returns text language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
begin
 if auth.uid() is null or coalesce(hermes.rol_actual(),'') not in ('admin','gerente') then
  raise exception 'Solo administrador o gerente con acceso a Hermes puede resolver incidencias' using errcode='42501'; end if;
 return hermes.actor_operacion();
end $$;
create function hermes.cantidad_despachada_vigente(p_id bigint) returns numeric language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare l public.pedido_linea%rowtype; n numeric;
begin
 select * into l from public.pedido_linea where id=p_id;
 if l.estado='COMPRADO_DIRECTO' then return l.cantidad_base; end if;
 if not exists(select 1 from public.pedido_despacho_evento where pedido_linea_id=p_id) then
  return case when l.estado='DESPACHADA' then greatest(coalesce(l.cantidad_despachada,0),l.cantidad_base) else greatest(coalesce(l.cantidad_despachada,0),0) end; end if;
 select coalesce(sum(case when e.revertido then 0
  when exists(select 1 from public.pedido_despacho_movimiento m where m.evento_id=e.id) then
    least(e.cantidad_base,coalesce((select sum(greatest(m.cantidad_base-m.cantidad_revertida,0)) from public.pedido_despacho_movimiento m where m.evento_id=e.id),0))
  else e.cantidad_base end),0) into n from public.pedido_despacho_evento e where e.pedido_linea_id=p_id;
 return n;
end $$;
create function hermes.version_resolucion(p_id bigint) returns text language sql stable security definer set search_path=pg_catalog,hermes,public as $$
 select md5(jsonb_build_object('pedido',(select to_jsonb(p) from public.pedido p where p.id=p_id),
 'lineas',(select jsonb_agg(to_jsonb(l) order by l.id) from public.pedido_linea l where l.pedido_id=p_id),
 'cartera',(select jsonb_agg(to_jsonb(pa) order by pa.id) from hermes.partida_abierta pa join public.pedido p on p.cliente_id=(select pos_cliente_id from hermes.cliente where id=pa.cliente_id) where p.id=p_id),
 'pagos',(select jsonb_agg(to_jsonb(pg) order by pg.id) from hermes.pago pg join hermes.cliente c on c.id=pg.cliente_id join public.pedido p on p.cliente_id=c.pos_cliente_id where p.id=p_id),
 'aplicaciones',(select jsonb_agg(to_jsonb(a) order by a.id) from hermes.pago_aplicacion a join hermes.pago pg on pg.id=a.pago_id join hermes.cliente c on c.id=pg.cliente_id join public.pedido p on p.cliente_id=c.pos_cliente_id where p.id=p_id),
 'usos',(select jsonb_agg(to_jsonb(u) order by u.id) from public.saldo_cliente_uso u join public.pedido p on p.cliente_id=u.cliente_id where p.id=p_id),
 'despachos',(select jsonb_agg(to_jsonb(e) order by e.id) from public.pedido_despacho_evento e join public.pedido_linea l on l.id=e.pedido_linea_id where l.pedido_id=p_id),
 'reversiones',(select jsonb_agg(to_jsonb(m) order by m.id) from public.pedido_despacho_movimiento m join public.pedido_despacho_evento e on e.id=m.evento_id join public.pedido_linea l on l.id=e.pedido_linea_id where l.pedido_id=p_id),
 'movimientos',(select jsonb_agg(jsonb_build_object('id',m.id,'monto',m.monto,'partida',m.partida_id,'pago',m.pago_id) order by m.id) from hermes.movimiento_cuenta m join hermes.cliente c on c.id=m.cliente_id join public.pedido p on p.cliente_id=c.pos_cliente_id where p.id=p_id))::text)
$$;
revoke all on function hermes.exigir_resolutor(),hermes.cantidad_despachada_vigente(bigint),hermes.version_resolucion(bigint) from public,anon,authenticated,service_role;

-- El permiso excepcional para verificar un origen cancelado procede de un registro
-- privado de la misma transacción, no de un parámetro o variable que el cliente pueda falsificar.
create or replace function hermes.validar_confirmacion_pedido_vigente() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin
 if new.estado in ('CONFIRMADO','ACREDITADO') then
  if exists(select 1 from hermes.pago_aplicacion a join hermes.partida_abierta pa on pa.id=a.partida_id
    left join public.pedido p on p.id=pa.pedido_id where a.pago_id=new.id and (pa.estado in ('ANULADA','CANCELADA') or p.estado='CANCELADO')) then
   raise exception 'El reparto contiene una operación cancelada. Resuelve el destino del pago.'; end if;
  if exists(select 1 from public.movimiento_caja m join public.pedido p on p.id=m.pedido_id
    where new.idempotencia_clave='pos-pago-mov-'||m.id and p.estado='CANCELADO')
   and not exists(select 1 from hermes.resolucion_pago r where r.pago_id=new.id and r.estado_anterior='PROPUESTO'
     and r.usuario_id=auth.uid() and r.creado_tx=txid_current()) then
   raise exception 'El pago corresponde a un pedido cancelado. Resuelve su destino antes de confirmar.'; end if;
 end if;
 return new;
end $$;
revoke all on function hermes.validar_confirmacion_pedido_vigente() from public,anon,authenticated,service_role;

create function hermes.resolver_pago_interno(p_op uuid,p_pago bigint,p_liberaciones jsonb,p_incluir_libre boolean,
 p_opcion text,p_destino bigint,p_turno bigint,p_medio text,p_referencia text,p_recepcion boolean,p_devuelto boolean,p_actor text,p_pedido bigint)
returns numeric language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
#variable_conflict use_column
declare pg hermes.pago%rowtype; a record; actual numeric; liberar numeric:=0; importe numeric; libre numeric; usos numeric;
 apps jsonb; s public.sesion_caja%rowtype; disponible numeric; d hermes.partida_abierta%rowtype; metodo public.metodo_pago;
begin
 select * into pg from hermes.pago where id=p_pago for update;
 if not found or pg.estado not in ('PROPUESTO','CONFIRMADO','ACREDITADO') then raise exception 'Pago no disponible para resolución'; end if;
 if pg.monto<=0 or pg.monto::text in ('NaN','Infinity','-Infinity') then raise exception 'El importe del pago requiere revisión'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('partida_id',partida_id,'monto',monto) order by partida_id),'[]') into apps from hermes.pago_aplicacion where pago_id=p_pago;
 select coalesce(sum(f.monto),0) into usos from hermes.saldo_uso_fuente f join public.saldo_cliente_uso u on u.id=f.uso_id
  join hermes.movimiento_cuenta m on m.id=f.movimiento_id where m.pago_id=p_pago and u.anulado_en is null;
 if coalesce((select sum(monto) from hermes.pago_aplicacion where pago_id=p_pago),0)+usos+pg.devuelto_monto>pg.monto then
  raise exception 'El reparto supera el dinero recibido. Corrige esa diferencia antes de resolver'; end if;
 select greatest(pg.monto-pg.devuelto_monto-coalesce(sum(monto),0)-usos,0) into libre from hermes.pago_aplicacion where pago_id=p_pago;
 for a in select (x->>'partida_id')::bigint partida_id,(x->>'monto')::numeric monto from jsonb_array_elements(p_liberaciones) x loop
  select monto into actual from hermes.pago_aplicacion where pago_id=p_pago and partida_id=a.partida_id for update;
  if a.monto<=0 or a.monto::text in ('NaN','Infinity','-Infinity') or actual is null or a.monto>actual then raise exception 'El reparto cambió; actualiza la incidencia'; end if;
  liberar:=liberar+a.monto;
 end loop;
 importe:=liberar+case when p_incluir_libre then libre else 0 end;
 if importe<=0 then return 0; end if;
 if p_opcion not in ('SALDO_FAVOR','REASIGNACION','DEVOLUCION') then raise exception 'Elige un destino válido para el dinero'; end if;
 if pg.estado='PROPUESTO' and not coalesce(p_recepcion,false) then raise exception 'Confirma la recepción del dinero antes de resolver la propuesta'; end if;
 if p_opcion='DEVOLUCION' then
  if not coalesce(p_devuelto,false) or p_referencia is null or p_referencia !~ '[^[:space:]]' then raise exception 'La devolución requiere confirmación de realización y referencia'; end if;
  metodo:=p_medio::public.metodo_pago;
  if metodo is null then raise exception 'Selecciona el medio de devolución'; end if;
  select * into s from public.sesion_caja where id=p_turno for update;
  if not found or s.estado::text<>'ABIERTA' then raise exception 'Selecciona un turno de caja abierto para registrar la devolución'; end if;
  if metodo='EFECTIVO' then
   select s.monto_apertura+coalesce(sum(case when tipo in ('VENTA','ANTICIPO','INGRESO') then monto when tipo in ('EGRESO','ANULACION') then -monto else 0 end),0)
   into disponible from public.movimiento_caja where sesion_caja_id=s.id and metodo='EFECTIVO';
   if importe>disponible then raise exception 'El turno no tiene efectivo suficiente para esta devolución'; end if;
  end if;
 end if;
 insert into hermes.resolucion_pago(operacion_id,pago_id,monto,opcion,estado_anterior,aplicaciones_antes,partida_destino_id,sesion_caja_id,referencia,usuario_id)
 values(p_op,p_pago,importe,p_opcion,pg.estado,apps,case when p_opcion='REASIGNACION' then p_destino end,case when p_opcion='DEVOLUCION' then p_turno end,p_referencia,auth.uid());
 for a in select (x->>'partida_id')::bigint partida_id,(x->>'monto')::numeric monto from jsonb_array_elements(p_liberaciones) x loop
  update hermes.pago_aplicacion set monto=monto-a.monto where pago_id=p_pago and partida_id=a.partida_id and monto>a.monto;
  if not found then delete from hermes.pago_aplicacion where pago_id=p_pago and partida_id=a.partida_id; end if;
  if pg.estado in ('CONFIRMADO','ACREDITADO') then
   insert into hermes.movimiento_cuenta(cliente_id,partida_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
   values(pg.cliente_id,a.partida_id,p_pago,'AJUSTE',a.monto,'resolucion-'||p_op||'-liberar-'||p_pago||'-'||a.partida_id,(now() at time zone 'America/La_Paz')::date,'Reclasificación de pago en resolución',p_actor);
  end if;
 end loop;
 if pg.estado='PROPUESTO' then
  if exists(select 1 from hermes.pago_aplicacion ap join hermes.v_partida_estado v on v.partida_id=ap.partida_id
   left join public.pedido p on p.id=v.pedido_id where ap.pago_id=p_pago and
   (v.cliente_id<>pg.cliente_id or v.estado<>'ABIERTA' or p.estado='CANCELADO' or ap.monto>v.pendiente)) then raise exception 'Hay otras aplicaciones inválidas en el pago; revisa su reparto'; end if;
  update hermes.pago set estado='CONFIRMADO',confirmado_en=now(),confirmado_por=p_actor,no_imputar=not exists(select 1 from hermes.pago_aplicacion where pago_id=p_pago) where id=p_pago;
  for a in select partida_id,monto from hermes.pago_aplicacion where pago_id=p_pago order by partida_id loop
   insert into hermes.movimiento_cuenta(cliente_id,partida_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
   values(pg.cliente_id,a.partida_id,p_pago,'PAGO',-a.monto,'pago-confirmado-'||p_pago||'-'||a.partida_id,(now() at time zone 'America/La_Paz')::date,'Pago verificado durante resolución',p_actor);
  end loop;
  select pg.monto-coalesce(sum(monto),0) into actual from hermes.pago_aplicacion where pago_id=p_pago;
  if actual>0 then
   insert into hermes.movimiento_cuenta(cliente_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
   values(pg.cliente_id,p_pago,'ANTICIPO',-actual,'pago-anticipo-'||p_pago,(now() at time zone 'America/La_Paz')::date,'Saldo liberado al verificar el pago',p_actor);
  end if;
 elsif liberar>0 then
  insert into hermes.movimiento_cuenta(cliente_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
  values(pg.cliente_id,p_pago,'ANTICIPO',-liberar,'resolucion-'||p_op||'-credito-'||p_pago,(now() at time zone 'America/La_Paz')::date,'Pago liberado de su partida',p_actor);
 end if;
 if p_opcion='REASIGNACION' then
  select * into d from hermes.partida_abierta where id=p_destino for update;
  if not found or d.cliente_id<>pg.cliente_id or d.pedido_id=p_pedido or d.estado<>'ABIERTA'
   or exists(select 1 from public.pedido where id=d.pedido_id and estado='CANCELADO')
   or exists(select 1 from public.venta where id=d.venta_id and estado='ANULADA') then raise exception 'El destino debe ser una partida vigente de otro pedido del mismo cliente'; end if;
  select greatest(pendiente-en_revision,0) into disponible from hermes.v_partida_estado where partida_id=p_destino;
  if disponible is null or importe>disponible then raise exception 'El importe supera la deuda disponible del destino'; end if;
  insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values(p_pago,p_destino,importe)
   on conflict(pago_id,partida_id) do update set monto=hermes.pago_aplicacion.monto+excluded.monto;
  update hermes.pago set no_imputar=false where id=p_pago;
  insert into hermes.movimiento_cuenta(cliente_id,partida_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
  values(pg.cliente_id,p_destino,p_pago,'PAGO',-importe,'resolucion-'||p_op||'-destino-'||p_pago,(now() at time zone 'America/La_Paz')::date,'Pago reasignado en resolución',p_actor);
 end if;
 if p_opcion in ('REASIGNACION','DEVOLUCION') then
  insert into hermes.movimiento_cuenta(cliente_id,pago_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
  values(pg.cliente_id,p_pago,'AJUSTE',importe,'resolucion-'||p_op||'-consumo-'||p_pago,(now() at time zone 'America/La_Paz')::date,'Aplicación del saldo liberado: '||p_opcion,p_actor);
 end if;
 if p_opcion='DEVOLUCION' then
  insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,pedido_id,cliente_id,nota,creado_por,idempotencia_clave)
  values(p_turno,'ANULACION',metodo,importe,p_pedido,(select pos_cliente_id from hermes.cliente where id=pg.cliente_id),btrim(p_referencia),p_actor,'hermes-devolucion-'||p_op||'-'||p_pago);
  update hermes.pago set devuelto_monto=devuelto_monto+importe where id=p_pago;
  -- Conserva la recepción confirmada: la salida compensatoria y devuelto_monto
  -- consumen el crédito una sola vez, sin retirar de nuevo su fuente del pool.
 end if;
 return importe;
end $$;
revoke all on function hermes.resolver_pago_interno(uuid,bigint,jsonb,boolean,text,bigint,bigint,text,text,boolean,boolean,text,bigint) from public,anon,authenticated,service_role;

create function hermes.resolver_incidencia_pedido(p_pedido_id bigint,p_tipo text,p_opcion text,p_motivo text,p_version text,p_clave text,
 p_lineas jsonb default '[]',p_destino bigint default null,p_turno bigint default null,p_medio text default null,p_referencia text default null,
 p_recepcion_verificada boolean default false,p_devolucion_realizada boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
#variable_conflict use_column
declare actor text; cid bigint; p public.pedido%rowtype; pa record; l public.pedido_linea%rowtype; x record; pg record;
 anterior jsonb; solicitud jsonb; previo hermes.resolucion_operacion%rowtype; op uuid:=gen_random_uuid(); total_resuelto numeric:=0;
 subtotal_reducido numeric:=0; nuevo_subtotal numeric; nuevo_total numeric; asignado numeric:=0; nuevo_pa numeric; ultimo bigint; ajustable numeric;
 cantidades jsonb; liberaciones jsonb; monto numeric; exceso numeric; aplicaciones jsonb:='{}'; resultado jsonb; fuente boolean; saldo_restaurado numeric:=0;
begin
 actor:=hermes.exigir_resolutor();
 if p_motivo is null or p_motivo !~ '[^[:space:]]' or length(p_motivo)>2000 then raise exception 'Indica un motivo de hasta 2000 caracteres'; end if;
 if coalesce(p_tipo,'') not in ('CANCELACION_RESUELTA','REMANENTE_CANCELADO') or coalesce(p_opcion,'') not in ('SALDO_FAVOR','REASIGNACION','DEVOLUCION') then raise exception 'Operación u opción inválida'; end if;
 if p_clave is null or length(p_clave)<8 or length(p_clave)>200 then raise exception 'Clave de operación inválida'; end if;
 if p_lineas is null or jsonb_typeof(p_lineas)<>'array' then raise exception 'Las cantidades deben ser una lista'; end if;
 solicitud:=jsonb_build_object('pedido',p_pedido_id,'tipo',p_tipo,'opcion',p_opcion,'motivo',btrim(p_motivo),'version',p_version,'lineas',p_lineas,
 'destino',p_destino,'turno',p_turno,'medio',p_medio,'referencia',p_referencia,'recepcion',p_recepcion_verificada,'devolucion',p_devolucion_realizada);
 perform pg_advisory_xact_lock(hashtextextended('hermes-resolucion:'||p_clave,0));
 select * into previo from hermes.resolucion_operacion where idempotencia_clave=p_clave;
 if found then
  if previo.solicitud<>solicitud or previo.usuario_id<>auth.uid() then raise exception 'La clave pertenece a otra resolución'; end if;
  return previo.resultado;
 end if;
 select c.id into cid from hermes.cliente c join public.pedido p on p.cliente_id=c.pos_cliente_id where p.id=p_pedido_id and c.activo;
 if cid is null then raise exception 'El pedido no tiene cuenta activa en Hermes'; end if;
 perform 1 from hermes.cliente where id=cid for update;
 perform 1 from hermes.partida_abierta where cliente_id=cid order by id for update;
 perform 1 from hermes.pago where cliente_id=cid order by id for update;
 select * into p from public.pedido where id=p_pedido_id for update;
 perform 1 from public.pedido_linea where pedido_id=p_pedido_id order by id for update;
 if p_version is null or p_version is distinct from hermes.version_resolucion(p_pedido_id) then raise exception 'La información cambió. Actualiza y revisa la resolución nuevamente'; end if;
 anterior:=jsonb_build_object('pedido',to_jsonb(p),'partidas',(select jsonb_agg(to_jsonb(a) order by id) from hermes.partida_abierta a where pedido_id=p.id),
  'lineas',(select jsonb_agg(to_jsonb(a) order by id) from public.pedido_linea a where pedido_id=p.id));
 if p.total is null or p.total::text in ('NaN','Infinity','-Infinity') or p.total<0 then raise exception 'El importe del pedido requiere revisión'; end if;
 if exists(select 1 from hermes.partida_abierta a where a.pedido_id=p.id and a.cliente_id<>cid) then raise exception 'Una partida no coincide con el cliente del pedido. Revisa el vínculo de origen'; end if;
 if exists(select 1 from hermes.partida_abierta a left join public.venta v on v.id=a.venta_id where a.pedido_id=p.id and a.venta_id is not null and (v.id is null or v.estado<>'ANULADA')) then
  raise exception 'Hay una partida vinculada a una venta vigente o sin origen validable. Resuelve la venta en Seller'; end if;
 if p.recibido_en is not null or exists(select 1 from hermes.partida_abierta where pedido_id=p.id and (fecha_factura is not null or nullif(cuf,'') is not null)) then
  raise exception 'Hay recepción o factura registrada. Resuelve ese documento antes de modificar el pedido'; end if;
 if p_tipo='CANCELACION_RESUELTA' then
  if exists(select 1 from public.pedido_linea where pedido_id=p.id and hermes.cantidad_despachada_vigente(id)>0)
    or exists(select 1 from hermes.partida_abierta where pedido_id=p.id and fecha_entrega is not null) then raise exception 'Hay entrega vigente. Cancela solo el remanente no entregado'; end if;
 else
  if p.estado='CANCELADO' or coalesce(p.total,0)<=0 then raise exception 'El pedido no está vigente'; end if;
  if jsonb_array_length(p_lineas)=0 or jsonb_array_length(p_lineas)>200 then raise exception 'Selecciona entre una y 200 líneas'; end if;
  if (select count(distinct x->>'linea_id') from jsonb_array_elements(p_lineas) x)<>jsonb_array_length(p_lineas) then raise exception 'No repitas una línea'; end if;
  if exists(select 1 from public.saldo_cliente_uso where pedido_id=p.id and anulado_en is null) then raise exception 'El pedido tiene saldo a favor aplicado; resuelve ese uso antes del ajuste parcial'; end if;
  if (select coalesce(sum(total),0) from hermes.partida_abierta where pedido_id=p.id and estado in ('ABIERTA','PAGADA'))<>p.total then raise exception 'Pedido y partidas tienen importes distintos. Revisa el vínculo antes del ajuste'; end if;
  if exists(select 1 from hermes.partida_abierta a where a.pedido_id=p.id and a.estado in ('ABIERTA','PAGADA') and
   coalesce((select sum(m.monto) from hermes.movimiento_cuenta m where m.partida_id=a.id),0)<>
   a.total-coalesce((select sum(ap.monto) from hermes.pago_aplicacion ap join hermes.pago pg on pg.id=ap.pago_id where ap.partida_id=a.id and pg.estado in ('CONFIRMADO','ACREDITADO')),0)) then
   raise exception 'La partida tiene ajustes contables que requieren revisión antes de reducir su importe'; end if;
  for x in select (j->>'linea_id')::bigint linea_id,(j->>'cantidad')::numeric cantidad from jsonb_array_elements(p_lineas) j loop
   select * into l from public.pedido_linea where id=x.linea_id and pedido_id=p.id;
   if not found or l.estado in ('DESPACHADA','COMPRADO_DIRECTO','RETIRADA','CAMBIADA') or x.cantidad is null or x.cantidad<=0
    or x.cantidad::text in ('NaN','Infinity','-Infinity') or x.cantidad>l.cantidad_base-hermes.cantidad_despachada_vigente(l.id)
    or l.cantidad_base<=0 or l.subtotal is null or l.subtotal<0 then raise exception 'Cantidad no cancelable o línea ya cerrada'; end if;
   subtotal_reducido:=subtotal_reducido+round(l.subtotal*x.cantidad/l.cantidad_base,2);
  end loop;
  if p.subtotal is null or p.subtotal<=0 or p.subtotal::text in ('NaN','Infinity','-Infinity') or p.total>p.subtotal or subtotal_reducido>p.subtotal then raise exception 'Los totales del pedido requieren revisión'; end if;
  nuevo_subtotal:=p.subtotal-subtotal_reducido; nuevo_total:=round(p.total*nuevo_subtotal/p.subtotal,2);
  if nuevo_total::text in ('NaN','Infinity','-Infinity') or nuevo_total<=0 or nuevo_total>=p.total then raise exception 'Para cancelar todo el pedido usa Cancelar y resolver; el ajuste parcial debe reducir un importe positivo'; end if;
  select coalesce(sum(total),0) into ajustable from hermes.partida_abierta where pedido_id=p.id and estado in ('ABIERTA','PAGADA') and fecha_entrega is null;
  if ajustable<p.total-nuevo_total then raise exception 'Separa el remanente de las partidas entregadas antes de reducirlo'; end if;
  perform public.guardar_version_pedido(p.id,'Cancelar remanente: '||btrim(p_motivo),actor);
  for x in select (j->>'linea_id')::bigint linea_id,(j->>'cantidad')::numeric cantidad from jsonb_array_elements(p_lineas) j loop
   select * into l from public.pedido_linea where id=x.linea_id;
   if x.cantidad=l.cantidad_base then update public.pedido_linea set estado='RETIRADA',nota=btrim(p_motivo),modificado_por=actor,modificado_en=now() where id=l.id;
   else update public.pedido_linea set cantidad_base=l.cantidad_base-x.cantidad,
     cantidad_presentacion=case when l.cantidad_presentacion is null then null else round(l.cantidad_presentacion*(l.cantidad_base-x.cantidad)/l.cantidad_base,4) end,
     subtotal=l.subtotal-round(l.subtotal*x.cantidad/l.cantidad_base,2),estado=case when hermes.cantidad_despachada_vigente(l.id)>=l.cantidad_base-x.cantidad then 'DESPACHADA'::public.estado_linea else l.estado end,
     nota=btrim(p_motivo),modificado_por=actor,modificado_en=now() where id=l.id; end if;
  end loop;
  select max(id) into ultimo from hermes.partida_abierta where pedido_id=p.id and estado in ('ABIERTA','PAGADA') and fecha_entrega is null;
  for pa in select * from hermes.partida_abierta where pedido_id=p.id and estado in ('ABIERTA','PAGADA') and fecha_entrega is null order by id loop
   nuevo_pa:=case when pa.id=ultimo then ajustable-(p.total-nuevo_total)-asignado else least(round(pa.total*(ajustable-(p.total-nuevo_total))/ajustable,2),greatest(ajustable-(p.total-nuevo_total)-asignado,0)) end; asignado:=asignado+nuevo_pa;
   if nuevo_pa<pa.total then
    insert into hermes.movimiento_cuenta(cliente_id,partida_id,tipo,monto,idempotencia_clave,fecha_efectiva,motivo,creado_por)
    values(cid,pa.id,'NOTA_CREDITO',nuevo_pa-pa.total,'resolucion-'||op||'-reduccion-'||pa.id,(now() at time zone 'America/La_Paz')::date,btrim(p_motivo),actor);
   end if;
   update hermes.partida_abierta set total=nuevo_pa where id=pa.id;
   select greatest(coalesce(sum(ap.monto),0)-nuevo_pa,0) into exceso from hermes.pago_aplicacion ap join hermes.pago pg on pg.id=ap.pago_id
    where ap.partida_id=pa.id and pg.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO');
   for pg in select ap.* from hermes.pago_aplicacion ap join hermes.pago g on g.id=ap.pago_id where ap.partida_id=pa.id and g.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO') order by case when g.estado='PROPUESTO' then 0 else 1 end,ap.id desc loop
    exit when exceso<=0; monto:=least(exceso,pg.monto); exceso:=exceso-monto;
    aplicaciones:=jsonb_set(aplicaciones,array[pg.pago_id::text],coalesce(aplicaciones->pg.pago_id::text,'[]')||jsonb_build_array(jsonb_build_object('partida_id',pa.id,'monto',monto)));
   end loop;
  end loop;
  update public.pedido set subtotal=nuevo_subtotal,total=nuevo_total,descuento_general=nuevo_subtotal-nuevo_total,alerta_lineas_en=now() where id=p.id;
 end if;
 if p_tipo='CANCELACION_RESUELTA' then
  select coalesce(sum(monto),0) into saldo_restaurado from public.saldo_cliente_uso where pedido_id=p.id and anulado_en is null;
  if saldo_restaurado>0 and p_opcion<>'SALDO_FAVOR' then raise exception 'Primero restaura el saldo aplicado en la cuenta. Su devolución o nueva aplicación requiere revisar la fuente de ese crédito'; end if;
  update public.saldo_cliente_uso set anulado_en=now(),motivo_anulacion=btrim(p_motivo) where pedido_id=p.id and anulado_en is null;
  if exists(select 1 from public.movimiento_caja m where m.pedido_id=p.id and m.tipo in ('ANTICIPO','VENTA') and m.monto>0
    and not exists(select 1 from hermes.pago pg where pg.idempotencia_clave='pos-pago-mov-'||m.id and pg.cliente_id=cid)) then raise exception 'Hay un cobro sin pago vinculado. Revisa la integración antes de cancelar'; end if;
 end if;
 for pg in select * from hermes.pago g where g.cliente_id=cid and g.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO') and
  (aplicaciones ? g.id::text or (p_tipo='CANCELACION_RESUELTA' and
   (exists(select 1 from hermes.pago_aplicacion ap join hermes.partida_abierta pa on pa.id=ap.partida_id where ap.pago_id=g.id and pa.pedido_id=p.id)
    or exists(select 1 from public.movimiento_caja m where m.pedido_id=p.id and g.idempotencia_clave='pos-pago-mov-'||m.id)))) order by g.id loop
  if p_tipo='CANCELACION_RESUELTA' then
   select coalesce(jsonb_agg(jsonb_build_object('partida_id',ap.partida_id,'monto',ap.monto) order by ap.partida_id),'[]') into liberaciones
    from hermes.pago_aplicacion ap join hermes.partida_abierta pa on pa.id=ap.partida_id where ap.pago_id=pg.id and pa.pedido_id=p.id;
   fuente:=exists(select 1 from public.movimiento_caja m where m.pedido_id=p.id and pg.idempotencia_clave='pos-pago-mov-'||m.id);
  else liberaciones:=aplicaciones->pg.id::text; fuente:=false; end if;
  total_resuelto:=total_resuelto+hermes.resolver_pago_interno(op,pg.id,liberaciones,fuente,p_opcion,p_destino,p_turno,p_medio,p_referencia,p_recepcion_verificada,p_devolucion_realizada,actor,p.id);
 end loop;
 if p_opcion<>'SALDO_FAVOR' and total_resuelto<=0 then raise exception 'No hay dinero liberado para la opción elegida'; end if;
 if p_tipo='CANCELACION_RESUELTA' then
  for pa in select id from hermes.partida_abierta where pedido_id=p.id and estado in ('ABIERTA','PAGADA') order by id loop
   perform hermes.baja_partida_interna(pa.id,p_motivo,actor); end loop;
  update public.pedido set estado='CANCELADO' where id=p.id;
  if p.estado<>'CANCELADO' then insert into public.pedido_evento(pedido_id,accion,motivo,estado_previo,usuario) values(p.id,'ANULADO',btrim(p_motivo),p.estado,actor); end if;
 else
  update hermes.partida_abierta set estado='ANULADA',anulada_en=now(),anulada_por=actor,anulada_usuario_id=auth.uid(),motivo_anulacion=btrim(p_motivo)
   where pedido_id=p.id and total=0 and estado in ('ABIERTA','PAGADA');
  perform public.recalcular_estado_pedido(p.id);
  insert into public.pedido_evento(pedido_id,accion,motivo,estado_previo,usuario) values(p.id,'REMANENTE_CANCELADO',btrim(p_motivo),p.estado,actor);
 end if;
 update hermes.partida_abierta pa set estado=case when v.pendiente<=0 then 'PAGADA'::hermes.estado_partida else 'ABIERTA'::hermes.estado_partida end
  from hermes.v_partida_estado v where v.partida_id=pa.id and pa.cliente_id=cid and pa.estado in ('ABIERTA','PAGADA');
 resultado:=jsonb_build_object('operacion_id',op,'pedido_id',p.id,'tipo',p_tipo,'opcion',p_opcion,'dinero_resuelto',(total_resuelto+saldo_restaurado)::text,'saldo_restaurado',saldo_restaurado::text,
  'total_pedido',case when p_tipo='CANCELACION_RESUELTA' then '0.00' else nuevo_total::text end,'reduccion',case when p_tipo='REMANENTE_CANCELADO' then (p.total-nuevo_total)::text else p.total::text end);
 insert into hermes.resolucion_operacion(id,idempotencia_clave,cliente_id,pedido_id,tipo,motivo,usuario_id,usuario,solicitud,resultado,antes)
 values(op,p_clave,cid,p.id,p_tipo,btrim(p_motivo),auth.uid(),actor,solicitud,resultado,anterior);
 return resultado;
end $$;
revoke all on function hermes.resolver_incidencia_pedido(bigint,text,text,text,text,text,jsonb,bigint,bigint,text,text,boolean,boolean) from public,anon,service_role;
grant execute on function hermes.resolver_incidencia_pedido(bigint,text,text,text,text,text,jsonb,bigint,bigint,text,text,boolean,boolean) to authenticated;

-- Una reducción de deuda no es una segunda fuente de dinero. El anticipo liberado
-- es la fuente utilizable y su contrapartida de reducción queda vinculada al pedido.
create or replace function hermes.fuentes_saldo_disponible(p_cliente_id bigint)
returns table(movimiento_id bigint,disponible numeric) language sql stable security definer set search_path=pg_catalog,hermes,public as $$
 with cargos_previos as (
 select coalesce(sum(m.monto),0) monto from hermes.movimiento_cuenta m where m.cliente_id=p_cliente_id and m.monto>0 and m.partida_id is null
 and m.tipo::text in ('SALDO_APERTURA','AJUSTE','CARGO') and not exists(select 1 from public.saldo_cliente_uso s where s.movimiento_id=m.id)
 ), fuentes as (
 select m.id,m.fecha_efectiva,greatest(-m.monto-coalesce(u.aplicado,0),0) fondo from hermes.movimiento_cuenta m
 left join lateral(select sum(f.monto) aplicado from hermes.saldo_uso_fuente f join public.saldo_cliente_uso s on s.id=f.uso_id where f.movimiento_id=m.id and s.anulado_en is null) u on true
 where m.cliente_id=p_cliente_id and m.monto<0 and m.tipo::text in ('SALDO_APERTURA','ANTICIPO','NOTA_CREDITO','AJUSTE')
 and coalesce(m.idempotencia_clave,'') not like 'anulacion-partida-%'
 and not (m.tipo='NOTA_CREDITO' and m.partida_id is not null and m.idempotencia_clave like 'resolucion-%-reduccion-%')
 and not exists(select 1 from public.saldo_cliente_uso s where s.reversion_id=m.id)
 and (m.pago_id is null or exists(select 1 from hermes.pago p where p.id=m.pago_id and p.estado::text in ('CONFIRMADO','ACREDITADO')))
 ), ordenadas as (
 select *,coalesce(sum(fondo) over(order by fecha_efectiva,id rows between unbounded preceding and 1 preceding),0) anterior from fuentes
 ) select id,greatest(fondo-greatest((select monto from cargos_previos)-anterior,0),0) from ordenadas order by fecha_efectiva,id
$$;
revoke all on function hermes.fuentes_saldo_disponible(bigint) from public,anon,authenticated,service_role;

-- Mantiene el importe recibido original y descuenta las devoluciones del anticipo utilizable.
create or replace view hermes.v_anticipo_cliente with(security_invoker=true) as
select p.id pago_id,p.cliente_id,p.monto,coalesce(ap.imputado,0)+coalesce(sf.aplicado,0) imputado,
 p.monto-coalesce(ap.imputado,0)-coalesce(sf.aplicado,0)-p.devuelto_monto saldo_favor,p.no_imputar,p.medio,p.estado,p.referencia,
 p.fecha_recepcion,p.fecha_acreditacion,p.confirmado_en,p.evidencia_id,e.storage_path comprobante_path,e.nombre_original comprobante_nombre,p.evidencia_id is not null tiene_comprobante,p.devuelto_monto
from hermes.pago p left join hermes.evidencia e on e.id=p.evidencia_id
left join(select pago_id,sum(monto) imputado from hermes.pago_aplicacion group by pago_id) ap on ap.pago_id=p.id
left join(select m.pago_id,sum(f.monto) aplicado from hermes.saldo_uso_fuente f join public.saldo_cliente_uso u on u.id=f.uso_id join hermes.movimiento_cuenta m on m.id=f.movimiento_id where u.anulado_en is null and m.pago_id is not null group by m.pago_id) sf on sf.pago_id=p.id
where p.estado in ('CONFIRMADO','ACREDITADO') and p.monto-coalesce(ap.imputado,0)-coalesce(sf.aplicado,0)-p.devuelto_monto>0;
create function hermes.obtener_incidencias(p_busqueda text default '',p_offset integer default 0,p_limite integer default 50,p_solo_incidencias boolean default true)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
declare salida jsonb;
begin
 if auth.uid() is null or not public.hermes_tiene_acceso() then raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
 if p_offset<0 or p_offset>100000 or p_limite<1 or p_limite>100 or p_offset is null or p_limite is null then raise exception 'Página inválida'; end if;
 if not p_solo_incidencias and length(btrim(coalesce(p_busqueda,'')))<2 then raise exception 'Escribe al menos dos caracteres para buscar un pedido'; end if;
 with base as (
  select p.id pedido_id,p.numero,p.estado::text,c.id cliente_id,c.nombre cliente,coalesce(p.total,0)::text importe,
   array_remove(array[
    case when p.estado='CANCELADO' and exists(select 1 from hermes.partida_abierta a where a.pedido_id=p.id and a.estado in ('ABIERTA','PAGADA')) then 'CANCELADO_CON_CARTERA' end,
    case when p.estado<>'CANCELADO' and exists(select 1 from public.pedido_linea l where l.pedido_id=p.id and l.estado='RECHAZADO') then 'RECHAZOS_PENDIENTES' end,
    case when exists(select 1 from hermes.v_partida_estado v where v.pedido_id=p.id and v.estado in ('ABIERTA','PAGADA') and v.imputado+v.en_revision>v.total) then 'REPARTO_EXCEDIDO' end,
    case when p.estado='CANCELADO' and exists(select 1 from public.movimiento_caja m join hermes.pago pg on pg.idempotencia_clave='pos-pago-mov-'||m.id where m.pedido_id=p.id and pg.estado='PROPUESTO') then 'PROPUESTA_DE_CANCELADO' end
   ],null) motivos
  from public.pedido p join hermes.cliente c on c.pos_cliente_id=p.cliente_id
  where c.activo and c.categoria in ('MAYORISTA','INSTITUCIONAL','CORPORATIVO')
   and (coalesce(btrim(p_busqueda),'')='' or position(lower(btrim(p_busqueda)) in lower(c.nombre||' '||coalesce(p.numero,'')||' '||p.id::text))>0)
 ), filtrada as(select * from base where not p_solo_incidencias or cardinality(motivos)>0), pagina as(select * from filtrada order by pedido_id desc limit p_limite offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(pagina) order by pedido_id desc) from pagina),'[]'),
 'total',(select count(*) from filtrada),'puede_resolver',coalesce(hermes.rol_actual(),'') in ('admin','gerente')) into salida;
 return salida;
end $$;

create function hermes.obtener_resolucion_pedido(p_pedido_id bigint) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
declare p public.pedido%rowtype; cid bigint; salida jsonb;
begin
 if auth.uid() is null or not public.hermes_tiene_acceso() then raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
 select c.id into cid from hermes.cliente c join public.pedido ped on ped.cliente_id=c.pos_cliente_id where ped.id=p_pedido_id and c.activo;
 if cid is null then raise exception 'Pedido sin cuenta activa en Hermes'; end if;
 select * into p from public.pedido where id=p_pedido_id;
 select jsonb_build_object('version',hermes.version_resolucion(p.id),'puede_resolver',coalesce(hermes.rol_actual(),'') in ('admin','gerente'),
  'pedido',jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,'cliente_id',cid,'cliente',(select nombre from hermes.cliente where id=cid),
   'subtotal',p.subtotal::text,'total',p.total::text,'recepcion',p.recibido_en),
  'saldo_aplicado',coalesce((select sum(monto) from public.saldo_cliente_uso where pedido_id=p.id and anulado_en is null),0)::text,
  'partidas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'documento',a.documento_interno,'total',a.total::text,'estado',a.estado,
   'entrega',a.fecha_entrega,'factura',a.fecha_factura,'cuf',a.cuf,
   'aplicado',coalesce((select sum(ap.monto) from hermes.pago_aplicacion ap join hermes.pago pg on pg.id=ap.pago_id where ap.partida_id=a.id and pg.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO')),0)::text) order by a.id) from hermes.partida_abierta a where a.pedido_id=p.id),'[]'),
  'lineas',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'descripcion',coalesce(nullif(l.descripcion,''),'Línea #'||l.id),'estado',l.estado,
   'cantidad',l.cantidad_base::text,'despachada',hermes.cantidad_despachada_vigente(l.id)::text,'subtotal',l.subtotal::text,
   'cancelable',case when l.estado in ('DESPACHADA','COMPRADO_DIRECTO','RETIRADA','CAMBIADA') then '0' else greatest(l.cantidad_base-hermes.cantidad_despachada_vigente(l.id),0)::text end) order by l.id) from public.pedido_linea l where l.pedido_id=p.id),'[]'),
  'pagos',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'estado',g.estado,'medio',g.medio,'monto',g.monto::text,'devuelto',g.devuelto_monto::text,'referencia',g.referencia,
    'aplicado_origen',coalesce(ap.origen,0)::text,'libre',greatest(g.monto-g.devuelto_monto-coalesce(ap.total,0)-coalesce(u.usado,0),0)::text,
    'de_caja',exists(select 1 from public.movimiento_caja m where m.pedido_id=p.id and g.idempotencia_clave='pos-pago-mov-'||m.id)) order by g.id)
   from hermes.pago g left join lateral(select sum(a.monto) total,sum(a.monto) filter(where pa.pedido_id=p.id) origen from hermes.pago_aplicacion a join hermes.partida_abierta pa on pa.id=a.partida_id where a.pago_id=g.id) ap on true
   left join lateral(select sum(f.monto) usado from hermes.saldo_uso_fuente f join public.saldo_cliente_uso s on s.id=f.uso_id join hermes.movimiento_cuenta m on m.id=f.movimiento_id where m.pago_id=g.id and s.anulado_en is null) u on true
   where g.cliente_id=cid and g.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO') and (coalesce(ap.origen,0)>0 or exists(select 1 from public.movimiento_caja m where m.pedido_id=p.id and g.idempotencia_clave='pos-pago-mov-'||m.id))),'[]'),
  'destinos',coalesce((select jsonb_agg(jsonb_build_object('id',v.partida_id,'documento',v.documento_interno,'pendiente',greatest(v.pendiente-v.en_revision,0)::text) order by v.partida_id)
   from hermes.v_partida_estado v join hermes.partida_abierta a on a.id=v.partida_id where v.cliente_id=cid and v.estado='ABIERTA' and v.pedido_id is distinct from p.id
    and v.pendiente-v.en_revision>0 and not exists(select 1 from public.pedido where id=v.pedido_id and estado='CANCELADO') and not exists(select 1 from public.venta where id=a.venta_id and estado='ANULADA')),'[]'),
  'turnos',case when coalesce(hermes.rol_actual(),'') in ('admin','gerente') then coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'caja_id',s.caja_id,'abierta_en',s.abierta_en,
   'efectivo',(s.monto_apertura+coalesce((select sum(case when m.tipo in ('VENTA','ANTICIPO','INGRESO') then m.monto when m.tipo in ('EGRESO','ANULACION') then -m.monto else 0 end) from public.movimiento_caja m where m.sesion_caja_id=s.id and m.metodo='EFECTIVO'),0))::text) order by s.id) from public.sesion_caja s where s.estado::text='ABIERTA'),'[]') else '[]'::jsonb end,
  'historial',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tipo',r.tipo,'motivo',r.motivo,'usuario',r.usuario,'fecha',r.creado_en,'resultado',r.resultado) order by r.creado_en desc,r.id) from hermes.resolucion_operacion r where r.pedido_id=p.id),'[]')) into salida;
 return salida;
end $$;
revoke all on function hermes.obtener_incidencias(text,integer,integer,boolean),hermes.obtener_resolucion_pedido(bigint) from public,anon,service_role;
grant execute on function hermes.obtener_incidencias(text,integer,integer,boolean),hermes.obtener_resolucion_pedido(bigint) to authenticated;

create or replace function hermes.obtener_historial_partida(p_partida_id bigint) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
declare pa hermes.partida_abierta%rowtype; eventos jsonb; pedido jsonb;
begin
 if auth.uid() is null or not public.hermes_tiene_acceso() then raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
 select * into pa from hermes.partida_abierta where id=p_partida_id;
 if not found then raise exception 'Partida inexistente'; end if;
 select jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,'lineas_rechazadas',(select count(*) from public.pedido_linea l where l.pedido_id=p.id and l.estado='RECHAZADO')) into pedido from public.pedido p where p.id=pa.pedido_id;
 select coalesce(jsonb_agg(e order by fecha desc,id desc),'[]') into eventos from (
  select 'pedido-'||pe.id id,pe.accion,coalesce(pe.sistema,case when pe.accion in ('LINEA_RECHAZADA','PEDIDO_RECHAZADO') then 'ALMACEN' when pe.accion in ('ANULADO','RESTAURADO') then 'SELLER' else 'NO_REGISTRADO' end) sistema,pe.motivo,pe.usuario,pe.usuario_id,pe.creado_en fecha,pe.pedido_linea_id,pe.estado_previo::text estado_previo
  from public.pedido_evento pe where pe.pedido_id=pa.pedido_id and pe.accion<>'REMANENTE_CANCELADO'
  union all select 'partida-'||pa.id,'PARTIDA_ANULADA','HERMES',pa.motivo_anulacion,pa.anulada_por,pa.anulada_usuario_id,pa.anulada_en,null,null where pa.estado='ANULADA'
  union all select 'resolucion-'||r.id,r.tipo,'HERMES',r.motivo||' · '||(r.resultado->>'opcion')||' · importe resuelto Bs '||(r.resultado->>'dinero_resuelto'),r.usuario,r.usuario_id,r.creado_en,null,null
  from hermes.resolucion_operacion r where r.pedido_id=pa.pedido_id or exists(select 1 from hermes.resolucion_pago rp where rp.operacion_id=r.id and rp.partida_destino_id=pa.id)
 ) e;
 return jsonb_build_object('pedido',pedido,'eventos',eventos);
end $$;
revoke all on function hermes.obtener_historial_partida(bigint) from public,anon,service_role;
grant execute on function hermes.obtener_historial_partida(bigint) to authenticated;
notify pgrst,'reload schema';
