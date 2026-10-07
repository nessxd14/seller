-- Cobro único de mostrador, pedido verificado y VTD existentes. Los documentos de
-- almacén conservan su identidad; el cliente recibe un comprobante único de caja.
create table public.cobro_caja (
  id bigint generated always as identity primary key,
  numero text not null unique,
  sesion_id bigint not null references public.sesion_caja(id),
  actor_id uuid not null references public.perfil(id),
  idempotencia text not null unique,
  solicitud jsonb not null,
  documento jsonb not null,
  creado_en timestamptz not null default now()
);
alter table public.cobro_caja enable row level security;
create policy cobro_caja_lectura on public.cobro_caja for select to authenticated
using (exists(select 1 from public.perfil p where p.id=(select auth.uid()) and p.activo
  and (p.rol::text in ('admin','gerente') or (p.rol::text='cajero' and actor_id=p.id))));
revoke all on public.cobro_caja from anon,authenticated;
grant select on public.cobro_caja to authenticated;
create index cobro_caja_sesion_idx on public.cobro_caja(sesion_id,creado_en);

create function public.vendedores_caja() returns table(id uuid,nombre text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  perform hermes.exigir_operador_pos();
  return query select p.id,p.nombre from public.perfil p where p.activo
    and p.rol::text in ('vendedor','vendedor_mayoreo','cajero','admin','gerente') order by p.nombre,p.id;
end $$;

create function public.pedidos_cobro_cliente(p_cliente_id bigint)
returns table(id bigint,numero text,pendiente numeric)
language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
begin
  perform hermes.exigir_operador_pos();
  return query select p.id,coalesce(p.numero,'Pedido #'||p.id),sum(greatest(v.pendiente-v.en_revision,0))
    from public.pedido p join hermes.v_partida_estado v on v.pedido_id=p.id
    where p.cliente_id=p_cliente_id and p.estado::text in ('ABIERTO','COMPLETADO') and v.estado::text='ABIERTA'
    group by p.id,p.numero having sum(greatest(v.pendiente-v.en_revision,0))>0 order by p.id desc;
end $$;

create function public.checkout_caja(
  p_lineas jsonb,p_pagos jsonb,p_sesion_id bigint,p_idempotencia text,
  p_cliente_id bigint default null,p_descuento numeric default 0,p_saldo numeric default 0,
  p_vendedor_id uuid default null,p_pedido_ids bigint[] default '{}',
  p_quitadas jsonb default '[]',p_vtd_ids bigint[] default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor uuid:=auth.uid(); usuario text; seller uuid:=p_vendedor_id; seller_name text;
  pedido_seller uuid; cantidad int; session_row public.sesion_caja%rowtype;
  previo public.cobro_caja%rowtype; solicitud jsonb; resultado jsonb; receipt_doc jsonb;
  nuevo numeric:=0; vtd_total numeric:=0; total numeric; pagado numeric:=0; cash_change numeric:=0;
  l jsonb; pago jsonb; cantidad_linea numeric; unitario numeric; factor numeric; monto numeric;
  falta numeric; toma numeric; pagos_nuevos jsonb:='[]'; pagos_vtd jsonb:='[]'; metodo text;
  venta_nueva bigint; ventas bigint[]:='{}'; v public.venta%rowtype; receipt_id bigint; numero text;
begin
  perform hermes.exigir_operador_pos();
  select coalesce(p.email,p.id::text) into usuario from public.perfil p where p.id=actor and p.activo;
  if actor is null or usuario is null then raise exception 'Operador no autorizado' using errcode='42501';end if;
  if p_idempotencia is null or length(p_idempotencia)<8 or length(p_idempotencia)>160 then raise exception 'Clave de cobro inválida';end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' or p_pagos is null or jsonb_typeof(p_pagos)<>'array'
    or p_quitadas is null or jsonb_typeof(p_quitadas)<>'array' or p_vtd_ids is null or p_pedido_ids is null
    or p_descuento is null or p_saldo is null or p_descuento<0 or p_saldo<0
    or p_descuento::text in ('NaN','Infinity','-Infinity') or p_saldo::text in ('NaN','Infinity','-Infinity')
    or p_descuento<>round(p_descuento,2) or p_saldo<>round(p_saldo,2) then raise exception 'Datos de cobro inválidos';end if;
  if cardinality(p_pedido_ids)>1 or cardinality(p_vtd_ids)>30
    or cardinality(p_vtd_ids)<>(select count(distinct x) from unnest(p_vtd_ids) x)
    or exists(select 1 from unnest(p_vtd_ids) x where x is null or x<=0) then raise exception 'Selección de documentos inválida';end if;
  solicitud:=jsonb_build_object('lineas',p_lineas,'pagos',p_pagos,'sesion',p_sesion_id,'cliente',p_cliente_id,
    'descuento',p_descuento,'saldo',p_saldo,'vendedor',seller,'pedidos',p_pedido_ids,'quitadas',p_quitadas,'vtd',p_vtd_ids,'actor',actor);
  perform pg_advisory_xact_lock(hashtextextended('checkout-caja:'||p_idempotencia,0));
  select * into previo from public.cobro_caja where idempotencia=p_idempotencia;
  if found then
    if previo.solicitud is distinct from solicitud then raise exception 'Este intento corresponde a otro cobro';end if;
    return previo.documento||jsonb_build_object('reintento',true);
  end if;
  select * into session_row from public.sesion_caja where id=p_sesion_id for update;
  if not found or session_row.estado::text<>'ABIERTA' then raise exception 'La caja está cerrada';end if;
  if session_row.cajero_id is distinct from actor and not exists(select 1 from public.perfil where id=actor and rol::text in ('admin','gerente'))
    then raise exception 'Este turno pertenece a otro cajero' using errcode='42501';end if;
  if seller is not null and not exists(select 1 from public.perfil p where p.id=seller and p.activo
    and p.rol::text in ('vendedor','vendedor_mayoreo','cajero','admin','gerente')) then raise exception 'Vendedor no disponible';end if;
  if cardinality(p_pedido_ids)>0 then
    select vendedor_id into pedido_seller from public.pedido_vendedor where id=p_pedido_ids[1];
    if not found then raise exception 'Pedido de vendedor inexistente';end if;
    if seller is not null and seller<>pedido_seller then raise exception 'Conserva el vendedor del pedido';end if;
    seller:=pedido_seller;
  end if;
  select nombre into seller_name from public.perfil where id=seller;
  for l in select * from jsonb_array_elements(p_lineas) loop
    unitario:=(l->>'precio_unitario')::numeric;
    cantidad_linea:=coalesce((l->>'cantidad_presentacion')::numeric,(l->>'cantidad_base')::numeric);
    if unitario is null or unitario<=0 or cantidad_linea is null or cantidad_linea<=0
      or unitario::text in ('NaN','Infinity','-Infinity') or cantidad_linea::text in ('NaN','Infinity','-Infinity') then raise exception 'Línea sin precio o cantidad válida';end if;
    if l->>'presentacion_id' is not null then
      select factor_unidad_base into factor from public.presentacion where id=(l->>'presentacion_id')::bigint;
      if factor is null then raise exception 'Presentación inexistente';end if;
    end if;
    nuevo:=nuevo+round(unitario*cantidad_linea,2);
  end loop;
  nuevo:=nuevo-p_descuento;
  if nuevo<0 or (jsonb_array_length(p_lineas)>0 and nuevo<=0) or p_saldo>nuevo then raise exception 'Descuento o saldo exceden la venta de mostrador';end if;
  cantidad:=0;
  for v in select * from public.venta where id=any(p_vtd_ids) order by id for update loop
    cantidad:=cantidad+1;
    if v.numero is null or v.numero not like 'VTD-%' or not v.cobro_exigible or v.estado::text='ANULADA'
      or v.total is null or v.total<=0 or exists(select 1 from public.venta_pago where venta_id=v.id)
      or not exists(select 1 from public.v_vtd_por_cobrar vc where vc.venta_id=v.id) then raise exception 'Una VTD ya está cobrada o no está disponible';end if;
    if v.cliente_id is not null and v.cliente_id is distinct from p_cliente_id then raise exception 'Elige el mismo cliente de la VTD para este cobro';end if;
    vtd_total:=vtd_total+v.total;ventas:=array_append(ventas,v.id);
  end loop;
  if cantidad<>cardinality(p_vtd_ids) then raise exception 'VTD inexistente';end if;
  total:=nuevo+vtd_total;
  if total<=0 then raise exception 'Agrega productos o documentos para cobrar';end if;
  falta:=nuevo-p_saldo;
  for pago in select * from jsonb_array_elements(p_pagos) loop
    metodo:=pago->>'metodo';monto:=(pago->>'monto')::numeric;
    if metodo is null or metodo not in ('EFECTIVO','QR','TRANSFERENCIA') or monto is null or monto<=0
      or monto::text in ('NaN','Infinity','-Infinity') or monto<>round(monto,2) then raise exception 'Pago inválido';end if;
    if pago->>'recibido' is not null then
      if metodo<>'EFECTIVO' or (pago->>'recibido')::numeric<monto or (pago->>'recibido')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Recibido inválido';end if;
      cash_change:=cash_change+(pago->>'recibido')::numeric-monto;
    end if;
    pagado:=pagado+monto;toma:=least(falta,monto);
    if toma>0 then pagos_nuevos:=pagos_nuevos||jsonb_build_array(jsonb_build_object('metodo',metodo,'monto',toma));end if;
    if monto>toma then pagos_vtd:=pagos_vtd||jsonb_build_array(jsonb_build_object('metodo',metodo,'monto',monto-toma));end if;
    falta:=falta-toma;
  end loop;
  if pagado+p_saldo<>total then raise exception 'El pago no coincide con el total del carrito';end if;
  if p_saldo>0 then pagos_nuevos:=pagos_nuevos||jsonb_build_array(jsonb_build_object('metodo','SALDO_FAVOR','monto',p_saldo));end if;
  if jsonb_array_length(p_lineas)>0 then
    if cardinality(p_pedido_ids)>0 then
      resultado:=public.cobrar_pedido_vendedor(p_pedido_ids,p_lineas,pagos_nuevos,p_sesion_id,'caja:'||p_idempotencia||':venta',p_quitadas,p_descuento,p_cliente_id);
    else
      resultado:=public.registrar_venta(p_lineas,pagos_nuevos,p_sesion_id,p_cliente_id,p_descuento,usuario,'caja:'||p_idempotencia||':venta');
    end if;
    venta_nueva:=(resultado->>'venta_id')::bigint;
    update public.venta set vendedor_id=seller where id=venta_nueva;
    ventas:=array_prepend(venta_nueva,ventas);
  elsif cardinality(p_pedido_ids)>0 then raise exception 'El pedido no tiene líneas verificadas';end if;
  if cardinality(p_vtd_ids)>0 then
    perform public.cobrar_vtd(p_vtd_ids,p_sesion_id,pagos_vtd,'caja:'||p_idempotencia||':vtd');
    -- La atribución elegida completa VTD sin vendedor; conserva atribuciones previas.
    if seller is not null then update public.venta set vendedor_id=seller where id=any(p_vtd_ids) and vendedor_id is null;end if;
  end if;
  receipt_id:=nextval(pg_get_serial_sequence('public.cobro_caja','id'));
  numero:='CJA-'||to_char(now() at time zone 'America/La_Paz','YYYYMMDD')||'-'||receipt_id;
  receipt_doc:=jsonb_build_object('numero',numero,'total',total,'ventas',ventas,'vendedor',seller_name,
    'cliente',(select nombre from public.cliente where id=p_cliente_id),'creado_en',now(),'pagos',p_pagos,
    'saldo_favor',p_saldo,'cambio',cash_change,'descuento',p_descuento,
    'lineas',(select coalesce(jsonb_agg(jsonb_build_object('descripcion',coalesce(nullif(vl.descripcion,''),pr.nombre),
      'cantidad',coalesce(vl.cantidad_presentacion,vl.cantidad),'precio',vl.precio_unitario,
      'subtotal',round(coalesce(vl.cantidad_presentacion,vl.cantidad)*vl.precio_unitario,2),
      'origen',case when vl.venta_id=venta_nueva then 'Mostrador' else sale.numero end) order by vl.venta_id,vl.id),'[]')
      from public.venta_linea vl join public.venta sale on sale.id=vl.venta_id left join public.producto pr on pr.id=vl.producto_id where vl.venta_id=any(ventas)));
  insert into public.cobro_caja(id,numero,sesion_id,actor_id,idempotencia,solicitud,documento) overriding system value
    values(receipt_id,numero,p_sesion_id,actor,p_idempotencia,solicitud,receipt_doc);
  receipt_doc:=receipt_doc||jsonb_build_object('id',receipt_id,'reintento',false);
  update public.cobro_caja set documento=receipt_doc where id=receipt_id;
  return receipt_doc;
end $$;
revoke all on function public.checkout_caja(jsonb,jsonb,bigint,text,bigint,numeric,numeric,uuid,bigint[],jsonb,bigint[]) from public,anon;
revoke all on function public.vendedores_caja(),public.pedidos_cobro_cliente(bigint) from public,anon;
grant execute on function public.checkout_caja(jsonb,jsonb,bigint,text,bigint,numeric,numeric,uuid,bigint[],jsonb,bigint[]),public.vendedores_caja(),public.pedidos_cobro_cliente(bigint) to authenticated;

-- Conserva el destino explícito aunque ese pedido se pague antes de confirmar.
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
   for a in select ve.partida_id,greatest(ve.pendiente-ve.en_revision,0) as pendiente from hermes.v_partida_estado ve
      where ve.cliente_id=c_id and ve.pedido_id=m.pedido_id and ve.estado='ABIERTA' and ve.pendiente-ve.en_revision>0
      order by ve.creado_en,ve.partida_id loop
     exit when rest<=0;
     insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values(p_id,a.partida_id,least(rest,a.pendiente));
     rest:=rest-least(rest,a.pendiente);
   end loop;
 end if;
 -- Un pago dirigido nunca debe caer en el FIFO de otro pedido al confirmarse.
 if m.pedido_id is not null and not exists(select 1 from hermes.pago_aplicacion where pago_id=p_id) then
   update hermes.pago set no_imputar=true where id=p_id;
 end if;
 return p_id;
end $function$
;
