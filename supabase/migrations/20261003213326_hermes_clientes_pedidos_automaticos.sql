-- Seller 7f78b4f: clientes y pedidos elegibles se vinculan sin importación manual.
-- No abre partidas ni altera importes de pedidos históricos durante la instalación.
-- Las funciones reemplazadas conservan sus propietarios y permisos existentes.

CREATE OR REPLACE FUNCTION hermes.registrar_movimiento_pos(p_mov_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hermes'
AS $function$
declare m public.movimiento_caja%rowtype; p_id bigint; c_id bigint; pos_id bigint; a record;
 rest numeric; intent jsonb; apps jsonb; pedido_cliente bigint;
begin
 select * into m from public.movimiento_caja where id=p_mov_id;
 if not found or m.tipo::text<>'ANTICIPO' then raise exception 'Movimiento no es un cobro de cliente'; end if;
 pos_id:=m.cliente_id;
 if m.pedido_id is not null then
   select cliente_id into pedido_cliente from public.pedido where id=m.pedido_id;
   if pos_id is not null and pos_id is distinct from pedido_cliente then raise exception 'Pedido y cliente no coinciden'; end if;
   pos_id:=pedido_cliente;
 end if;
 if pos_id is null then raise exception 'Cobro sin cliente'; end if;
 -- Los clientes actuales indican expresamente que retail queda solo en caja.
 -- Los clientes anteriores mantienen el contrato de la RPC existente.
 if coalesce((m.hermes_intencion->>'excluir_retail')::boolean,false)
   and exists(select 1 from public.cliente where id=pos_id and tipo_precio::text='retail') then
   if jsonb_array_length(coalesce(nullif(m.hermes_intencion->'aplicaciones','null'::jsonb),'[]'::jsonb))>0 then
     raise exception 'Los clientes retail no tienen partidas en el conciliador';
   end if;
   return null;
 end if;
 c_id:=hermes.asegurar_cliente_pos(pos_id);
 perform 1 from hermes.cliente where id=c_id for update;
 select id into p_id from hermes.pago where idempotencia_clave='pos-pago-mov-'||m.id;
 if p_id is not null then
   if not exists(select 1 from hermes.pago where id=p_id and cliente_id=c_id and monto=m.monto and medio::text=m.metodo::text) then
     raise exception 'El movimiento ya tiene un pago con datos diferentes';
   end if;
   return p_id;
 end if;
 intent:=coalesce(m.hermes_intencion,'{}'::jsonb);
 insert into hermes.pago(cliente_id,medio,monto,estado,fecha_recepcion,referencia,idempotencia_clave,creado_por,no_imputar)
 values(c_id,m.metodo::text::hermes.medio_pago,m.monto,'PROPUESTO',
   (m.creado_en at time zone 'America/La_Paz')::date,
   coalesce(nullif(intent->>'referencia',''),m.nota,'Cobro POS'),
   'pos-pago-mov-'||m.id,coalesce(m.creado_por,'pos'),coalesce((intent->>'no_imputar')::boolean,false))
 returning id into p_id;
 apps:=nullif(intent->'aplicaciones','null'::jsonb);
 if coalesce((intent->>'no_imputar')::boolean,false) then
   if apps is not null and jsonb_array_length(apps)>0 then raise exception 'Un anticipo sin imputación no admite reparto'; end if;
 elsif apps is not null then
   perform hermes.imputar_pago_pos_interno(p_id,apps,m.creado_por);
 elsif m.pedido_id is not null then
   rest:=m.monto;
   for a in select ve.partida_id,ve.pendiente from hermes.v_partida_estado ve
      where ve.cliente_id=c_id and ve.pedido_id=m.pedido_id and ve.estado='ABIERTA' and ve.pendiente>0
      order by ve.creado_en,ve.partida_id loop
     exit when rest<=0;
     insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values(p_id,a.partida_id,least(rest,a.pendiente));
     rest:=rest-least(rest,a.pendiente);
   end loop;
 end if;
 return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION hermes.registrar_cobro_pos_interno(p_pedido_id bigint DEFAULT NULL::bigint, p_cliente_id bigint DEFAULT NULL::bigint, p_monto numeric DEFAULT NULL::numeric, p_metodo public.metodo_pago DEFAULT NULL::metodo_pago, p_sesion_id bigint DEFAULT NULL::bigint, p_idempotencia text DEFAULT NULL::text, p_no_imputar boolean DEFAULT false, p_aplicaciones jsonb DEFAULT NULL::jsonb, p_referencia text DEFAULT NULL::text, p_excluir_retail boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hermes'
AS $function$
declare m public.movimiento_caja%rowtype; c_id bigint; p_id bigint; pos_id bigint; intent jsonb; actor text;
begin
 perform hermes.exigir_operador_pos();
 if p_idempotencia is null or length(btrim(p_idempotencia))<8 then raise exception 'Falta clave estable del cobro'; end if;
 if p_monto is null or p_monto<=0 or p_monto<>round(p_monto,2) or p_metodo is null then raise exception 'Monto o método inválido'; end if;
 if p_no_imputar is null or (p_aplicaciones is not null and jsonb_typeof(p_aplicaciones)<>'array') then raise exception 'Intención del cobro inválida'; end if;
 if p_pedido_id is null and p_cliente_id is null then raise exception 'Falta cliente o pedido'; end if;
 pos_id:=p_cliente_id;
 if p_pedido_id is not null then
   select cliente_id into pos_id from public.pedido where id=p_pedido_id;
   if not found or pos_id is null then raise exception 'Pedido inexistente o sin cliente'; end if;
   if p_cliente_id is not null and p_cliente_id is distinct from pos_id then raise exception 'Pedido pertenece a otro cliente'; end if;
 end if;
 actor:=coalesce(auth.uid()::text,'sistema');
 intent:=jsonb_build_object('no_imputar',p_no_imputar,'aplicaciones',p_aplicaciones,'referencia',p_referencia,'cliente_pos',pos_id,'actor',actor);
 if p_excluir_retail then intent:=intent||jsonb_build_object('excluir_retail',true); end if;
 -- Serializa reintentos, incluyendo dos llamadas simultáneas con la misma clave.
 perform pg_advisory_xact_lock(hashtextextended('hermes-cobro:'||p_idempotencia,0));
 select * into m from public.movimiento_caja where idempotencia_clave=p_idempotencia;
 if found then
   if m.tipo::text<>'ANTICIPO' or m.monto<>p_monto or m.metodo<>p_metodo
      or m.pedido_id is distinct from p_pedido_id or m.sesion_caja_id is distinct from p_sesion_id
      or m.hermes_intencion is distinct from intent then
     raise exception 'Clave de reintento usada con datos diferentes';
   end if;
 else
   perform 1 from public.sesion_caja where id=p_sesion_id and estado::text='ABIERTA' for update;
   if not found then raise exception 'La caja está cerrada'; end if;
   if not exists(select 1 from public.cliente where id=pos_id and activo) then raise exception 'Cliente inactivo o inexistente'; end if;
   insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,pedido_id,cliente_id,creado_por,nota,idempotencia_clave,hermes_intencion)
   values(p_sesion_id,'ANTICIPO',p_metodo,p_monto,p_pedido_id,case when p_pedido_id is null then pos_id else null end,
     actor,coalesce(p_referencia,case when p_pedido_id is null then 'Pago sobre saldo total' else 'Anticipo pedido #'||p_pedido_id end),
     p_idempotencia,intent) returning * into m;
 end if;
 p_id:=hermes.registrar_movimiento_pos(m.id);
 select id into c_id from hermes.cliente where pos_cliente_id=pos_id;
 return jsonb_build_object('movementId',m.id,'pagoId',p_id,
   'excluidoRetail',p_excluir_retail and p_id is null and exists(select 1 from public.cliente where id=pos_id and tipo_precio::text='retail'),
   'saldoProvisional',
   (select saldo_provisional from hermes.v_saldo_cliente where cliente_id=c_id));
end $function$
;
revoke all on function hermes.registrar_cobro_pos_interno(bigint,bigint,numeric,public.metodo_pago,bigint,text,boolean,jsonb,text,boolean) from public,anon,authenticated,service_role;
-- Contrato antiguo: no exige una actualización simultánea de todas las cajas.
create or replace function public.registrar_cobro_hermes(p_pedido_id bigint DEFAULT NULL::bigint,p_cliente_id bigint DEFAULT NULL::bigint,
 p_monto numeric DEFAULT NULL::numeric,p_metodo public.metodo_pago DEFAULT NULL::public.metodo_pago,
 p_sesion_id bigint DEFAULT NULL::bigint,p_idempotencia text DEFAULT NULL::text,
 p_no_imputar boolean DEFAULT false,p_aplicaciones jsonb DEFAULT NULL::jsonb,p_referencia text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path=pg_catalog,public,hermes as $$
 select hermes.registrar_cobro_pos_interno(p_pedido_id,p_cliente_id,p_monto,p_metodo,
   p_sesion_id,p_idempotencia,p_no_imputar,p_aplicaciones,p_referencia,false);
$$;
-- Contrato actual: los pagos retail se guardan exclusivamente en Seller.
create or replace function public.registrar_cobro_cation(p_pedido_id bigint DEFAULT NULL::bigint,p_cliente_id bigint DEFAULT NULL::bigint,
 p_monto numeric DEFAULT NULL::numeric,p_metodo public.metodo_pago DEFAULT NULL::public.metodo_pago,
 p_sesion_id bigint DEFAULT NULL::bigint,p_idempotencia text DEFAULT NULL::text,
 p_no_imputar boolean DEFAULT false,p_aplicaciones jsonb DEFAULT NULL::jsonb,p_referencia text DEFAULT NULL::text)
returns jsonb language sql security definer set search_path=pg_catalog,public,hermes as $$
 select hermes.registrar_cobro_pos_interno(p_pedido_id,p_cliente_id,p_monto,p_metodo,
   p_sesion_id,p_idempotencia,p_no_imputar,p_aplicaciones,p_referencia,true);
$$;
revoke all on function public.registrar_cobro_cation(bigint,bigint,numeric,public.metodo_pago,bigint,text,boolean,jsonb,text) from public,anon;
grant execute on function public.registrar_cobro_cation(bigint,bigint,numeric,public.metodo_pago,bigint,text,boolean,jsonb,text) to authenticated,service_role;

CREATE OR REPLACE FUNCTION hermes.sincronizar_clientes_cation()
 RETURNS TABLE(actualizados integer, sin_mapeo integer, no_importados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  return query
  with mapa as (
    select c.id,
           c.nombre,
           nullif(btrim(coalesce(c.documento, '')), '') as nit,
           c.activo and c.tipo_precio in ('mayorista','institucion','corporativo') as activo,
           hermes.categoria_desde_tipo_precio(c.tipo_precio) as categoria
      from hermes.cation_cliente c
  ), upd as (
    update cliente h
       set nombre          = m.nombre,
           nit             = m.nit,
           categoria       = coalesce(m.categoria, h.categoria),
           activo          = m.activo,
           sincronizado_en = now()
      from mapa m
     where h.pos_cliente_id = m.id
       and (h.nombre IS DISTINCT FROM m.nombre
         or h.nit    IS DISTINCT FROM m.nit
         or h.activo IS DISTINCT FROM m.activo
         or (m.categoria is not null and h.categoria IS DISTINCT FROM m.categoria))
    returning h.id
  )
  select (select count(*)::int from upd),
         (select count(*)::int from mapa m
            join cliente h on h.pos_cliente_id = m.id
           where m.categoria is null),
         (select count(*)::int from mapa m
           where m.activo
             and not exists (select 1 from cliente h where h.pos_cliente_id = m.id));
end;
$function$
;

-- El cliente se vincula primero y su ficha de crédito se conserva.
create or replace function hermes.al_actualizar_cliente_pos() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin
 if new.tipo_precio::text in ('mayorista','institucion','corporativo')
    and (new.activo or exists(select 1 from hermes.cliente where pos_cliente_id=new.id)) then
   perform hermes.asegurar_cliente_pos(new.id);
 elsif exists(select 1 from hermes.cliente where pos_cliente_id=new.id) then
   -- Archiva la cuenta anterior sin eliminar su crédito ni movimientos.
   update hermes.cliente set nombre=new.nombre,nit=nullif(btrim(new.documento),''),
     categoria=coalesce(hermes.categoria_desde_tipo_precio(new.tipo_precio::text),categoria),
     activo=false,sincronizado_en=now() where pos_cliente_id=new.id;
 end if;
 return new;
end $$;

create or replace function hermes.sincronizar_pedido_pos(p_id bigint,p_fecha date default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare p public.pedido%rowtype; c_id bigint; f date;
begin
 perform pg_advisory_xact_lock(hashtextextended('hermes-pedido:'||p_id,0));
 select * into p from public.pedido where id=p_id;
 if not found or p.cliente_id is null then return; end if;
 -- Se consulta la categoría de Seller antes de crear cualquier cuenta.
 if not exists(select 1 from public.cliente c where c.id=p.cliente_id and c.activo
   and c.tipo_precio::text in ('mayorista','institucion','corporativo')) then return; end if;
 c_id:=hermes.asegurar_cliente_pos(p.cliente_id);
 if c_id is null or p.total is null or p.total<=0
   or p.estado::text not in ('ABIERTO','COMPLETADO') then return; end if;
 if not exists(select 1 from hermes.partida_abierta where pedido_id=p_id) then
   perform hermes.abrir_partida(p_id,'pos:automatico');
 end if;
 if p.estado::text='COMPLETADO' then
   f:=coalesce(p_fecha,
     (select q.fecha_completado from public.pendiente_sync_hermes_despacho q where q.pedido_id=p_id),
     (p.recibido_en at time zone 'America/La_Paz')::date);
   if f is not null then
     perform hermes.sincronizar_entrega_pedido(p_id,f,'pos:automatico');
     update public.pendiente_sync_hermes_despacho set sincronizado_en=now(),ultimo_error=null
       where pedido_id=p_id and sincronizado_en is null;
   end if;
 end if;
end $$;

create or replace function hermes.al_guardar_pedido_pos() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin
 if tg_op='UPDATE' then
   if new.cliente_id is not distinct from old.cliente_id
     and new.total is not distinct from old.total
     and new.estado is not distinct from old.estado then return new; end if;
 end if;
 perform hermes.sincronizar_pedido_pos(new.id);
 return new;
end $$;
revoke all on function hermes.al_guardar_pedido_pos() from public,anon,authenticated,service_role;
revoke all on function hermes.al_actualizar_cliente_pos() from public,anon,authenticated;
revoke all on function hermes.sincronizar_pedido_pos(bigint,date) from public,anon,authenticated;

-- Espera al final de la transacción: crear_pedido y la conversión de cotizaciones
-- escriben primero la cabecera, después las líneas y por último el importe final.
create constraint trigger hermes_pedido_automatico
after insert or update on public.pedido deferrable initially deferred
for each row execute function hermes.al_guardar_pedido_pos();

create or replace view hermes.v_clientes_cation_pendientes as
select c.id,c.nombre,c.razon_social,c.tipo_precio,
  hermes.categoria_desde_tipo_precio(c.tipo_precio) as categoria_sugerida,
  c.documento,c.ciudad,c.creado_en
from hermes.cation_cliente c
where c.activo and c.tipo_precio in ('mayorista','institucion','corporativo')
  and not exists(select 1 from hermes.cliente h where h.pos_cliente_id=c.id);

create or replace view hermes.v_pedidos_cation_pendientes as
select cp.id as pedido_id,cp.cliente_id as pos_cliente_id,h.id as hermes_cliente_id,
  h.nombre as cliente,h.categoria,cp.estado,cp.total,cp.referencia,cp.creado_en,
  case
    when cp.cliente_id is null then 'SIN_CLIENTE'
    when cp.estado not in ('ABIERTO','COMPLETADO') then 'ESTADO_NO_ELEGIBLE'
    when cp.total is null or cp.total<=0 then 'SIN_TOTAL'
    when h.id is null then 'CLIENTE_SIN_CUENTA'
    when cc.cliente_id is null then 'SIN_FICHA_CREDITO'
    when h.categoria not in ('INSTITUCIONAL','CORPORATIVO','MAYORISTA') then 'CATEGORIA_NO_ELEGIBLE'
    when exists(select 1 from hermes.partida_abierta pa where pa.pedido_id=cp.id) then 'YA_TIENE_PARTIDA'
    else 'ABRE'
  end as motivo
from hermes.cation_pedido cp
left join hermes.cliente h on h.pos_cliente_id=cp.cliente_id
left join hermes.cliente_credito cc on cc.cliente_id=h.id
where exists(select 1 from hermes.cation_cliente c where c.id=cp.cliente_id
  and c.tipo_precio in ('mayorista','institucion','corporativo'));

notify pgrst,'reload schema';

-- La recuperación manual comparte el bloqueo con los eventos automáticos.
CREATE OR REPLACE FUNCTION hermes.sincronizar_pedidos_cation()
 RETURNS TABLE(abiertas integer, omitidas integer, con_error integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  r          record;
  v_abiertas int := 0;
  v_error    int := 0;
  v_omitidas int;
begin
 if not hermes.contexto_confiable() and not public.hermes_tiene_acceso() then
 raise exception 'Sin acceso a Hermes' using errcode='42501'; end if;
  -- Se toma ANTES del loop a propósito: después, los pedidos recién abiertos
  -- ya figuran como YA_TIENE_PARTIDA y se contarían dos veces.
  select count(*)::int into v_omitidas from v_pedidos_cation_pendientes where motivo <> 'ABRE';

  for r in select pedido_id from v_pedidos_cation_pendientes where motivo = 'ABRE' order by pedido_id
  loop
    begin
      perform pg_advisory_xact_lock(hashtextextended('hermes-pedido:'||r.pedido_id,0));
      if not exists(select 1 from hermes.partida_abierta where pedido_id=r.pedido_id) then
        perform abrir_partida(r.pedido_id, 'sync-cation');
        v_abiertas := v_abiertas + 1;
      end if;
    exception when others then
      v_error := v_error + 1;
      raise warning 'Pedido %: %', r.pedido_id, sqlerrm;
    end;
  end loop;

  return query select v_abiertas, v_omitidas, v_error;
end;
$function$
;
