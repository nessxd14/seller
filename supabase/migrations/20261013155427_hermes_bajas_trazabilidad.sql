-- Desarrollo local. Sin corrección automática de datos históricos.
-- Las cancelaciones con pagos o entregas necesitan resolución financiera explícita.
alter table public.pedido_evento add column if not exists usuario_id uuid;
alter table public.pedido_evento add column if not exists sistema text;
alter table public.pedido_evento add column if not exists pedido_linea_id bigint;
alter table hermes.partida_abierta add column if not exists anulada_usuario_id uuid;
create index if not exists pedido_evento_historial on public.pedido_evento(pedido_id, creado_en, id);

-- Helpers privados: solo las RPC autorizadas pueden invocarlos.
create or replace function hermes.actor_operacion() returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor text;
begin
 select coalesce(nullif(nombre,''),nullif(email,''),id::text) into actor
 from public.perfil where id=auth.uid() and activo;
 if actor is null then raise exception 'Sesión sin usuario activo' using errcode='42501'; end if;
 return actor;
end $$;
revoke all on function hermes.actor_operacion() from public,anon,authenticated,service_role;

create or replace function hermes.bloquear_cartera_pedido(p_id bigint) returns void
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare cid bigint;
begin
 select h.id into cid from hermes.cliente h join public.pedido p on p.cliente_id=h.pos_cliente_id where p.id=p_id;
 perform 1 from hermes.cliente where id=cid for update;
 perform 1 from hermes.partida_abierta where cliente_id=cid order by id for update;
end $$;
revoke all on function hermes.bloquear_cartera_pedido(bigint) from public,anon,authenticated,service_role;

-- Protege tanto los cobros nuevos desde POS como inserciones directas en caja.
-- Un reintento que ya tiene movimiento no vuelve a insertar y conserva su resultado.
create or replace function hermes.validar_cobro_pedido_vigente() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare cid bigint; estado_pedido public.estado_pedido;
begin
 if new.pedido_id is not null and new.monto>0 and new.tipo in ('ANTICIPO','VENTA') then
   select h.id into cid from hermes.cliente h join public.pedido p on p.cliente_id=h.pos_cliente_id where p.id=new.pedido_id;
   perform 1 from hermes.cliente where id=cid for update;
   select estado into estado_pedido from public.pedido where id=new.pedido_id for update;
   if not found then raise exception 'Pedido inexistente'; end if;
   if estado_pedido='CANCELADO' then raise exception 'El pedido está cancelado. No se puede registrar un nuevo cobro.'; end if;
 end if;
 return new;
end $$;
revoke all on function hermes.validar_cobro_pedido_vigente() from public,anon,authenticated,service_role;
create trigger hermes_cobro_pedido_vigente before insert on public.movimiento_caja
for each row execute function hermes.validar_cobro_pedido_vigente();

-- Las propuestas históricas de pedidos cancelados requieren resolución explícita.
create or replace function hermes.validar_confirmacion_pedido_vigente() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin
 if new.estado in ('CONFIRMADO','ACREDITADO') then
   if exists(select 1 from hermes.pago_aplicacion a join hermes.partida_abierta pa on pa.id=a.partida_id
     left join public.pedido p on p.id=pa.pedido_id
     where a.pago_id=new.id and (pa.estado in ('ANULADA','CANCELADA') or p.estado='CANCELADO'))
     or exists(select 1 from public.movimiento_caja m join public.pedido p on p.id=m.pedido_id
       where new.idempotencia_clave='pos-pago-mov-'||m.id and p.estado='CANCELADO') then
     raise exception 'El pago corresponde a un pedido cancelado o una partida dada de baja. Revisa su destino antes de confirmar.';
   end if;
 end if;
 return new;
end $$;
revoke all on function hermes.validar_confirmacion_pedido_vigente() from public,anon,authenticated,service_role;
create trigger hermes_confirmacion_pedido_vigente before update of estado on hermes.pago
for each row when (old.estado is distinct from new.estado) execute function hermes.validar_confirmacion_pedido_vigente();

-- El expediente dado de baja se conserva para consulta, también desde las RPC.
create or replace function hermes.exigir_expediente_operable(p_id bigint) returns void
language plpgsql security definer set search_path=pg_catalog,hermes as $$
declare estado_actual hermes.estado_partida; pedido_id bigint; venta_id bigint;
begin
 select pa.estado,pa.pedido_id,pa.venta_id into estado_actual,pedido_id,venta_id from hermes.partida_abierta pa where pa.id=p_id for share;
 if not found then raise exception 'Partida inexistente'; end if;
 if estado_actual in ('ANULADA','CANCELADA')
   or exists(select 1 from public.pedido p where p.id=pedido_id and p.estado='CANCELADO')
   or exists(select 1 from public.venta v where v.id=venta_id and v.estado='ANULADA') then
   raise exception 'El expediente está dado de baja o su operación de origen está cancelada; se conserva para consulta.';
 end if;
end $$;
revoke all on function hermes.exigir_expediente_operable(bigint) from public,anon,authenticated,service_role;

create or replace function hermes.proteger_hito_baja() returns trigger
language plpgsql security definer set search_path=pg_catalog,hermes as $$
begin
 if tg_op<>'INSERT' then perform hermes.exigir_expediente_operable(old.partida_abierta_id); end if;
 if tg_op<>'DELETE' then perform hermes.exigir_expediente_operable(new.partida_abierta_id); return new; end if;
 return old;
end $$;
revoke all on function hermes.proteger_hito_baja() from public,anon,authenticated,service_role;
create trigger hermes_hito_baja before insert or update or delete on hermes.hito
for each row execute function hermes.proteger_hito_baja();

create or replace function hermes.proteger_documento_baja() returns trigger
language plpgsql security definer set search_path=pg_catalog,hermes as $$
declare pid bigint;
begin
 if tg_op<>'INSERT' then
   select partida_abierta_id into pid from hermes.hito where id=old.hito_id;
   perform hermes.exigir_expediente_operable(pid);
 end if;
 if tg_op<>'DELETE' then
   select partida_abierta_id into pid from hermes.hito where id=new.hito_id;
   perform hermes.exigir_expediente_operable(pid);
   return new;
 end if;
 return old;
end $$;
revoke all on function hermes.proteger_documento_baja() from public,anon,authenticated,service_role;
create trigger hermes_documento_baja before insert or update or delete on hermes.documento
for each row execute function hermes.proteger_documento_baja();

-- Los eventos y sus reversiones tienen prioridad sobre el contador heredado.
create or replace function hermes.linea_tiene_despacho(p_id bigint) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare l public.pedido_linea%rowtype; cantidad numeric;
begin
 select * into l from public.pedido_linea where id=p_id;
 if not found then return false; end if;
 if l.estado='COMPRADO_DIRECTO' then return true; end if;
 if not exists(select 1 from public.pedido_despacho_evento where pedido_linea_id=p_id) then
   return coalesce(l.cantidad_despachada,0)>0 or l.estado='DESPACHADA';
 end if;
 select coalesce(sum(case when e.revertido then 0
   when exists(select 1 from public.pedido_despacho_movimiento m where m.evento_id=e.id) then
     least(e.cantidad_base,coalesce((select sum(greatest(m.cantidad_base-m.cantidad_revertida,0))
       from public.pedido_despacho_movimiento m where m.evento_id=e.id),0))
   else e.cantidad_base end),0) into cantidad
 from public.pedido_despacho_evento e where e.pedido_linea_id=p_id;
 return cantidad>0;
end $$;
revoke all on function hermes.linea_tiene_despacho(bigint) from public,anon,authenticated,service_role;

create or replace function hermes.autor_evento_pedido() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,hermes as $$
begin
 if new.accion in ('ANULADO','RESTAURADO','LINEA_RECHAZADA','PEDIDO_RECHAZADO') then
   if current_user<>'postgres' then raise exception 'Registra este evento mediante su operación autorizada' using errcode='42501'; end if;
   if new.motivo is null or new.motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
   new.usuario:=hermes.actor_operacion(); new.usuario_id:=auth.uid();
   new.sistema:=case when new.accion in ('LINEA_RECHAZADA','PEDIDO_RECHAZADO') then 'ALMACEN' else 'SELLER' end;
   new.creado_en:=now();
 end if;
 return new;
end $$;
revoke all on function hermes.autor_evento_pedido() from public,anon,authenticated,service_role;
create trigger hermes_autor_evento before insert on public.pedido_evento
for each row execute function hermes.autor_evento_pedido();

create or replace function hermes.conservar_evento_pedido() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.usuario_id is not null or old.accion in ('ANULADO','RESTAURADO','LINEA_RECHAZADA','PEDIDO_RECHAZADO') then
   raise exception 'El historial conserva sus motivos y autores. Registra una nueva operación para corregirlo.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function hermes.conservar_evento_pedido() from public,anon,authenticated,service_role;
create trigger hermes_conservar_evento before update or delete on public.pedido_evento
for each row execute function hermes.conservar_evento_pedido();

-- Se llama después de bloquear cliente, partidas y pagos en orden consistente.
create or replace function hermes.baja_partida_interna(p_id bigint,p_motivo text,p_actor text)
returns void language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
declare pa hermes.partida_abierta%rowtype; neto numeric;
begin
 select * into pa from hermes.partida_abierta where id=p_id for update;
 if not found then raise exception 'Partida inexistente'; end if;
 if pa.estado='ANULADA' then return; end if;
 if pa.estado not in ('ABIERTA','PAGADA') then raise exception 'Estado de partida no apto para baja'; end if;
 if exists(select 1 from hermes.pago_aplicacion a join hermes.pago p on p.id=a.pago_id
   where a.partida_id=p_id and p.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO')) then
   raise exception 'Hay pagos aplicados o por verificar. Resuelve su destino antes de dar de baja.';
 end if;
 if exists(select 1 from hermes.saldo_uso_partida a join public.saldo_cliente_uso u on u.id=a.uso_id
   where a.partida_id=p_id and u.anulado_en is null) then raise exception 'Hay saldo a favor aplicado; resuélvelo desde Seller'; end if;
 if pa.fecha_entrega is not null or pa.fecha_factura is not null or nullif(pa.cuf,'') is not null then
   raise exception 'La partida tiene entrega o factura registrada. Requiere revisión antes de la baja.';
 end if;
 select coalesce(sum(monto),0) into neto from hermes.movimiento_cuenta where partida_id=p_id;
 if neto<>pa.total then raise exception 'La partida tiene ajustes previos. Revisa el saldo antes de la baja.'; end if;
 update hermes.partida_abierta set estado='ANULADA',anulada_en=now(),anulada_por=p_actor,
   anulada_usuario_id=auth.uid(),motivo_anulacion=btrim(p_motivo) where id=p_id;
 insert into hermes.movimiento_cuenta(cliente_id,partida_id,tipo,monto,idempotencia_clave,fecha_efectiva,referencia,motivo,creado_por)
 values(pa.cliente_id,p_id,'NOTA_CREDITO',-neto,'anulacion-partida-'||p_id,
   (now() at time zone 'America/La_Paz')::date,pa.documento_interno,btrim(p_motivo),p_actor);
end $$;
revoke all on function hermes.baja_partida_interna(bigint,text,text) from public,anon,authenticated,service_role;

create or replace function hermes.anular_partida(p_partida_id bigint,p_motivo text,p_usuario text)
returns void language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
declare pa hermes.partida_abierta%rowtype; actor text;
begin
 if auth.uid() is null or coalesce(hermes.rol_actual(),'') not in ('admin','gerente') then
   raise exception 'Solo administrador o gerente puede anular partidas' using errcode='42501'; end if;
 actor:=hermes.actor_operacion();
 if p_motivo is null or p_motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
 select * into pa from hermes.partida_abierta where id=p_partida_id;
 if not found then raise exception 'Partida inexistente'; end if;
 perform 1 from hermes.cliente where id=pa.cliente_id for update;
 perform 1 from hermes.partida_abierta where cliente_id=pa.cliente_id order by id for update;
 select * into pa from hermes.partida_abierta where id=p_partida_id for update;
 if pa.venta_id is not null then
   perform 1 from public.venta where id=pa.venta_id for update;
   if not found then raise exception 'No se pudo validar la venta de origen. Revisa el vínculo antes de la baja.'; end if;
   if exists(select 1 from public.venta where id=pa.venta_id and estado<>'ANULADA') then
     raise exception 'La partida está vinculada a una venta vigente. Resuelve la venta en Seller antes de darla de baja.';
   end if;
 end if;
 if pa.pedido_id is not null then
   perform 1 from public.pedido where id=pa.pedido_id for update;
   if not found then raise exception 'No se pudo validar el pedido de origen. Revisa el vínculo antes de la baja.'; end if;
   if exists(select 1 from public.pedido where id=pa.pedido_id and estado<>'CANCELADO') then
     raise exception 'Cancela el pedido en Seller para resolver todas sus partidas juntas.';
   end if;
   if exists(select 1 from public.pedido_linea where pedido_id=pa.pedido_id and hermes.linea_tiene_despacho(id))
     or exists(select 1 from public.pedido where id=pa.pedido_id and recibido_en is not null) then
     raise exception 'El pedido tiene entregas. Requiere revisión antes de la baja.';
   end if;
 end if;
 perform hermes.baja_partida_interna(p_partida_id,p_motivo,actor);
end $$;
alter function hermes.anular_partida(bigint,text,text) owner to postgres;
revoke all on function hermes.anular_partida(bigint,text,text) from public,anon,service_role;
grant execute on function hermes.anular_partida(bigint,text,text) to authenticated;

-- La nueva interfaz no cae silenciosamente en la RPC antigua si aún no se desplegó esta migración.
create or replace function hermes.anular_partida_auditada(p_partida_id bigint,p_motivo text)
returns void language sql security invoker set search_path=pg_catalog,hermes as $$
 select hermes.anular_partida(p_partida_id,p_motivo,null);
$$;
revoke all on function hermes.anular_partida_auditada(bigint,text) from public,anon,service_role;
grant execute on function hermes.anular_partida_auditada(bigint,text) to authenticated;

-- La RPC revierte explícitamente antes de cambiar el estado. Este trigger impide
-- que un UPDATE directo deje deuda o crédito aplicado detrás de una cancelación.
create or replace function hermes.revertir_saldo_pedido() returns trigger
language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
begin
 if exists(select 1 from hermes.partida_abierta where pedido_id=new.id and estado in ('ABIERTA','PAGADA'))
   or exists(select 1 from public.saldo_cliente_uso where pedido_id=new.id and anulado_en is null) then
   raise exception 'Cancela desde la operación de Seller para resolver la cartera conjuntamente.';
 end if;
 return new;
end $$;
revoke all on function hermes.revertir_saldo_pedido() from public,anon,authenticated,service_role;

create or replace function public.anular_pedido(p_pedido_id bigint,p_motivo text,p_usuario text)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare previo public.estado_pedido; cid bigint; actor text; r record;
begin
 actor:=hermes.actor_operacion();
 if not exists(select 1 from public.perfil where id=auth.uid() and activo and rol in ('admin','gerente','supervisor')) then
   raise exception 'Tu rol no puede cancelar pedidos' using errcode='42501'; end if;
 if p_motivo is null or p_motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
 -- Coincide con confirmar_pago: cliente, partidas, y luego recursos operativos.
 select h.id into cid from hermes.cliente h join public.pedido p on p.cliente_id=h.pos_cliente_id where p.id=p_pedido_id;
 if cid is not null then
   perform 1 from hermes.cliente where id=cid for update;
   perform 1 from hermes.partida_abierta where cliente_id=cid order by id for update;
 end if;
 select estado into previo from public.pedido where id=p_pedido_id for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if previo='CANCELADO' then return; end if;
 perform 1 from public.pedido_linea where pedido_id=p_pedido_id order by id for update;
 if exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and hermes.linea_tiene_despacho(id))
   or exists(select 1 from public.pedido where id=p_pedido_id and recibido_en is not null) then
   raise exception 'El pedido tiene entregas. Resuelve la devolución o el remanente antes de cancelar.';
 end if;
 if exists(select 1 from hermes.pago_aplicacion a join hermes.pago pg on pg.id=a.pago_id
   join hermes.partida_abierta pa on pa.id=a.partida_id where pa.pedido_id=p_pedido_id
   and pg.estado in ('PROPUESTO','CONFIRMADO','ACREDITADO')) then
   raise exception 'El pedido tiene pagos aplicados o por verificar. Resuelve su destino antes de cancelar.';
 end if;
 -- Incluye anticipos sin reparto recibidos en caja para este pedido.
 if exists(select 1 from public.movimiento_caja where pedido_id=p_pedido_id and tipo in ('ANTICIPO','VENTA') and monto>0) then
   raise exception 'El pedido tiene cobros de caja. Revisa su devolución o reasignación antes de cancelar.';
 end if;
 if exists(select 1 from public.saldo_cliente_uso where pedido_id=p_pedido_id and anulado_en is null)
   and not public.app_es_admin() then raise exception 'Solo gerencia puede restaurar saldo aplicado' using errcode='42501'; end if;
 update public.saldo_cliente_uso set anulado_en=now(),motivo_anulacion=btrim(p_motivo)
   where pedido_id=p_pedido_id and anulado_en is null;
 for r in select id from hermes.partida_abierta where pedido_id=p_pedido_id and estado in ('ABIERTA','PAGADA') order by id loop
   perform hermes.baja_partida_interna(r.id,p_motivo,actor);
 end loop;
 update public.pedido set estado='CANCELADO' where id=p_pedido_id;
 insert into public.pedido_evento(pedido_id,accion,motivo,estado_previo,usuario)
 values(p_pedido_id,'ANULADO',btrim(p_motivo),previo,actor);
end $$;

create or replace function public.restaurar_pedido(p_pedido_id bigint,p_motivo text,p_usuario text)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare previo public.estado_pedido; actor text; cid bigint;
begin
 actor:=hermes.actor_operacion();
 if not exists(select 1 from public.perfil where id=auth.uid() and activo and rol in ('admin','gerente','supervisor')) then
   raise exception 'Tu rol no puede restaurar pedidos' using errcode='42501'; end if;
 if p_motivo is null or p_motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
 select h.id into cid from hermes.cliente h join public.pedido p on p.cliente_id=h.pos_cliente_id where p.id=p_pedido_id;
 perform 1 from hermes.cliente where id=cid for update;
 perform 1 from hermes.partida_abierta where cliente_id=cid order by id for update;
 select estado into previo from public.pedido where id=p_pedido_id for update;
 if previo is distinct from 'CANCELADO'::public.estado_pedido then raise exception 'El pedido no está cancelado'; end if;
 if exists(select 1 from hermes.partida_abierta where pedido_id=p_pedido_id and estado in ('ANULADA','CANCELADA')) then
   raise exception 'La cartera ya fue dada de baja. Crea un nuevo pedido o solicita revisión financiera; no se reactivará deuda automáticamente.';
 end if;
 select estado_previo into previo from public.pedido_evento where pedido_id=p_pedido_id and accion='ANULADO'
 order by creado_en desc,id desc limit 1;
 if previo is null or previo='CANCELADO' then raise exception 'No se encontró un estado previo válido'; end if;
 update public.pedido set estado=previo where id=p_pedido_id;
 insert into public.pedido_evento(pedido_id,accion,motivo,estado_previo,usuario)
 values(p_pedido_id,'RESTAURADO',btrim(p_motivo),'CANCELADO',actor);
end $$;
revoke all on function public.anular_pedido(bigint,text,text),public.restaurar_pedido(bigint,text,text) from public,anon,service_role;
grant execute on function public.anular_pedido(bigint,text,text),public.restaurar_pedido(bigint,text,text) to authenticated;

create or replace function public.anular_pedido_con_cartera(p_pedido_id bigint,p_motivo text)
returns void language sql security invoker set search_path=pg_catalog,public as $$
 select public.anular_pedido(p_pedido_id,p_motivo,null);
$$;
create or replace function public.restaurar_pedido_con_cartera(p_pedido_id bigint,p_motivo text)
returns void language sql security invoker set search_path=pg_catalog,public as $$
 select public.restaurar_pedido(p_pedido_id,p_motivo,null);
$$;
revoke all on function public.anular_pedido_con_cartera(bigint,text),public.restaurar_pedido_con_cartera(bigint,text) from public,anon,service_role;
grant execute on function public.anular_pedido_con_cartera(bigint,text),public.restaurar_pedido_con_cartera(bigint,text) to authenticated;

create or replace function public.rechazar_pedido_linea(p_pedido_linea_id bigint,p_motivo text default null,p_usuario text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare pid bigint; l public.pedido_linea%rowtype; actor text;
begin
 actor:=hermes.actor_operacion();
 if not public.app_puede_inventariar() then raise exception 'Tu rol no puede rechazar líneas' using errcode='42501'; end if;
 if p_motivo is null or p_motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
 select pedido_id into pid from public.pedido_linea where id=p_pedido_linea_id;
 perform hermes.bloquear_cartera_pedido(pid);
 perform 1 from public.pedido where id=pid and estado<>'CANCELADO' for update;
 if not found then raise exception 'Pedido inexistente o cancelado'; end if;
 select * into l from public.pedido_linea where id=p_pedido_linea_id for update;
 if not found or l.pedido_id is distinct from pid then raise exception 'La línea cambió de pedido. Actualiza antes de rechazar.'; end if;
 if hermes.linea_tiene_despacho(l.id) or l.estado in ('DESPACHADA','COMPRADO_DIRECTO','RECHAZADO','CAMBIADA','RETIRADA') then
   raise exception 'La línea tiene entregas o ya está cerrada. Revisa el remanente.';
 end if;
 perform public.guardar_version_pedido(pid,'Rechazo de línea: '||btrim(p_motivo),actor);
 update public.pedido_linea set estado='RECHAZADO',nota=btrim(p_motivo),modificado_por=actor,modificado_en=now() where id=l.id;
 update public.pedido set alerta_lineas_en=now() where id=pid;
 insert into public.pedido_evento(pedido_id,pedido_linea_id,accion,motivo,usuario)
 values(pid,l.id,'LINEA_RECHAZADA',btrim(p_motivo),actor);
 perform public.recalcular_estado_pedido(pid);
 return jsonb_build_object('pedido_id',pid,'pedido_linea_id',l.id);
end $$;

create or replace function public.rechazar_pedido(p_pedido_id bigint,p_motivo text default null,p_usuario text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare n integer; actor text;
begin
 actor:=hermes.actor_operacion();
 if not public.app_puede_rechazar_pedido_completo() then raise exception 'Tu rol no puede rechazar el pedido completo' using errcode='42501'; end if;
 if p_motivo is null or p_motivo !~ '[^[:space:]]' then raise exception 'El motivo es obligatorio'; end if;
 perform hermes.bloquear_cartera_pedido(p_pedido_id);
 perform 1 from public.pedido where id=p_pedido_id and estado<>'CANCELADO' for update;
 if not found then raise exception 'Pedido inexistente o cancelado'; end if;
 perform 1 from public.pedido_linea where pedido_id=p_pedido_id order by id for update;
 if exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and hermes.linea_tiene_despacho(id)
   and estado not in ('DESPACHADA','COMPRADO_DIRECTO','RECHAZADO','CAMBIADA','RETIRADA')) then
   raise exception 'Hay entregas parciales. Revisa el remanente por línea.';
 end if;
 perform public.guardar_version_pedido(p_pedido_id,'Rechazo de pendientes: '||btrim(p_motivo),actor);
 update public.pedido_linea set estado='RECHAZADO',nota=btrim(p_motivo),modificado_por=actor,modificado_en=now()
 where pedido_id=p_pedido_id and estado not in ('DESPACHADA','COMPRADO_DIRECTO','RECHAZADO','CAMBIADA','RETIRADA');
 get diagnostics n=row_count;
 if n=0 then raise exception 'No hay líneas pendientes para rechazar'; end if;
 update public.pedido set alerta_lineas_en=now() where id=p_pedido_id;
 insert into public.pedido_evento(pedido_id,accion,motivo,usuario)
 values(p_pedido_id,'PEDIDO_RECHAZADO',btrim(p_motivo),actor);
 perform public.recalcular_estado_pedido(p_pedido_id);
 return jsonb_build_object('pedido_id',p_pedido_id,'lineas_rechazadas',n);
end $$;
revoke all on function public.rechazar_pedido(bigint,text,text),public.rechazar_pedido_linea(bigint,text,text) from public,anon,service_role;
grant execute on function public.rechazar_pedido(bigint,text,text),public.rechazar_pedido_linea(bigint,text,text) to authenticated;

create or replace function public.rechazar_pedido_auditado(p_pedido_id bigint,p_motivo text)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select public.rechazar_pedido(p_pedido_id,p_motivo,null);
$$;
create or replace function public.rechazar_linea_pedido_auditada(p_pedido_linea_id bigint,p_motivo text)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select public.rechazar_pedido_linea(p_pedido_linea_id,p_motivo,null);
$$;
revoke all on function public.rechazar_pedido_auditado(bigint,text),public.rechazar_linea_pedido_auditada(bigint,text) from public,anon,service_role;
grant execute on function public.rechazar_pedido_auditado(bigint,text),public.rechazar_linea_pedido_auditada(bigint,text) to authenticated;

-- Evitar que rechazar todo se interprete como entrega.
create or replace function public.recalcular_estado_pedido(p_pedido_id bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare completado boolean; previo public.estado_pedido; categoria public.categoria_pedido;
begin
 select p.estado,p.categoria into previo,categoria from public.pedido p where id=p_pedido_id for update;
 if previo='CANCELADO' then return; end if;
 select exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and estado in ('DESPACHADA','COMPRADO_DIRECTO'))
   and not exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id
     and estado not in ('DESPACHADA','COMPRADO_DIRECTO','RETIRADA','RECHAZADO','CAMBIADA')) into completado;
 update public.pedido set estado=case when completado then 'COMPLETADO'::public.estado_pedido else 'ABIERTO'::public.estado_pedido end where id=p_pedido_id;
 if completado and previo<>'COMPLETADO' and categoria<>'TIENDA'
   and not exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and estado='RECHAZADO') then
   insert into public.pendiente_sync_hermes_despacho(pedido_id,fecha_completado)
   values(p_pedido_id,(now() at time zone 'America/La_Paz')::date)
   on conflict(pedido_id) do update set fecha_completado=excluded.fecha_completado,sincronizado_en=null,intentos=0,ultimo_error=null;
 end if;
end $$;

create or replace function hermes.sincronizar_entrega_pedido(p_pedido_id bigint,p_fecha date,p_usuario text default 'pos:entrega')
returns jsonb language plpgsql security definer set search_path=pg_catalog,hermes,public as $$
declare n integer; origen jsonb;
begin
 if p_fecha is null or p_fecha>(now() at time zone 'America/La_Paz')::date then raise exception 'Fecha de entrega inválida'; end if;
 origen:=hermes.resumen_origen_pedido(p_pedido_id);
 if origen is null or origen->'pedido'->>'estado'='CANCELADO'
   or exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and estado='RECHAZADO')
   or not ((origen->'salida'->>'origen_estado'='COMPLETO') or
     (exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and estado='COMPRADO_DIRECTO')
      and not exists(select 1 from public.pedido_linea where pedido_id=p_pedido_id and estado not in ('COMPRADO_DIRECTO','RECHAZADO','CAMBIADA','RETIRADA')))) then
   return jsonb_build_object('aplicado',false,'actualizadas',0,'motivo','sin_entrega_verificable');
 end if;
 update hermes.partida_abierta pa set fecha_entrega=p_fecha,
   documentado=not exists(select 1 from hermes.documento d join hermes.hito h on h.id=d.hito_id
     where h.partida_abierta_id=pa.id and d.tipo='HABILITANTE' and d.estado<>'APROBADO')
 where pa.pedido_id=p_pedido_id and pa.estado='ABIERTA' and pa.fecha_entrega is null;
 get diagnostics n=row_count;
 return jsonb_build_object('aplicado',n>0 or exists(select 1 from hermes.partida_abierta where pedido_id=p_pedido_id and fecha_entrega is not null),
   'actualizadas',n,'motivo',case when n>0 then 'registrada' else 'sin_cambios' end);
end $$;

alter function hermes.sincronizar_entrega_pedido(bigint,date,text) owner to postgres;
revoke all on function hermes.sincronizar_entrega_pedido(bigint,date,text) from public,anon,authenticated,service_role;

create or replace function hermes.sincronizar_pedido_pos(p_id bigint,p_fecha date default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare p public.pedido%rowtype; c_id bigint; f date; entrega jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes-pedido:'||p_id,0));
 select * into p from public.pedido where id=p_id;
 if not found or p.cliente_id is null then return; end if;
 if not exists(select 1 from public.cliente c where c.id=p.cliente_id and c.activo
   and c.tipo_precio::text in ('mayorista','institucion','corporativo')) then return; end if;
 c_id:=hermes.asegurar_cliente_pos(p.cliente_id);
 if c_id is null or p.total is null or p.total<=0 or p.estado not in ('ABIERTO','COMPLETADO') then return; end if;
 if not exists(select 1 from hermes.partida_abierta where pedido_id=p_id) then perform hermes.abrir_partida(p_id,'pos:automatico'); end if;
 if p.estado='COMPLETADO' then
   f:=coalesce(p_fecha,(select q.fecha_completado from public.pendiente_sync_hermes_despacho q where q.pedido_id=p_id),
     (p.recibido_en at time zone 'America/La_Paz')::date);
   if f is not null then
     entrega:=hermes.sincronizar_entrega_pedido(p_id,f,'pos:automatico');
     update public.pendiente_sync_hermes_despacho set
       sincronizado_en=case when (entrega->>'aplicado')::boolean then now() else null end,
       ultimo_error=case when (entrega->>'aplicado')::boolean then null else entrega->>'motivo' end
     where pedido_id=p_id and sincronizado_en is null;
   end if;
 end if;
end $$;
revoke all on function hermes.sincronizar_pedido_pos(bigint,date) from public,anon,authenticated,service_role;

-- Una lectura limitada al expediente; incluye todas las categorías y sus hijas.
create or replace function hermes.obtener_historial_partida(p_partida_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,hermes,public as $$
declare pa hermes.partida_abierta%rowtype; eventos jsonb; pedido jsonb;
begin
 if auth.uid() is null or not public.hermes_tiene_acceso() then raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
 select * into pa from hermes.partida_abierta where id=p_partida_id;
 if not found then raise exception 'Partida inexistente'; end if;
 select jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,
   'lineas_rechazadas',(select count(*) from public.pedido_linea l where l.pedido_id=p.id and l.estado='RECHAZADO'))
 into pedido from public.pedido p where p.id=pa.pedido_id;
 select coalesce(jsonb_agg(e order by fecha desc,id desc),'[]'::jsonb) into eventos from (
   select 'pedido-'||pe.id as id,pe.accion,coalesce(pe.sistema,case when pe.accion in ('LINEA_RECHAZADA','PEDIDO_RECHAZADO') then 'ALMACEN' when pe.accion in ('ANULADO','RESTAURADO') then 'SELLER' else 'NO_REGISTRADO' end) as sistema,
     pe.motivo,pe.usuario,pe.usuario_id,pe.creado_en as fecha,pe.pedido_linea_id,
     pe.estado_previo::text as estado_previo
   from public.pedido_evento pe where pe.pedido_id=pa.pedido_id
   union all
   select 'partida-'||pa.id,'PARTIDA_ANULADA','HERMES',pa.motivo_anulacion,pa.anulada_por,pa.anulada_usuario_id,pa.anulada_en,null,null
   where pa.estado='ANULADA'
 ) e;
 return jsonb_build_object('pedido',pedido,'eventos',eventos);
end $$;
revoke all on function hermes.obtener_historial_partida(bigint) from public,anon,service_role;
grant execute on function hermes.obtener_historial_partida(bigint) to authenticated;
notify pgrst,'reload schema';
