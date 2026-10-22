-- Caja–Almacén: disponibilidad parcial.
-- Almacén reporta el faltante (cantidad realmente disponible) y Caja ajusta la VTD
-- (solo reduce) devolviendo la diferencia por el medio que elija el cajero.
--
-- Base: definición EN VIVO de caja_almacen.operar (incluye el autocompletado de 2026-10-21 en `enviar`),
-- no la de 20261017140005. Diff mínimo marcado con «-- [AJUSTE]».
-- Antes de aplicar: ejecutar 20261022170000_caja_almacen_ajuste_faltante_ENSAYO.sql (BEGIN…ROLLBACK).

alter table public.caja_operacion_vtd
  add column if not exists faltante jsonb,
  add column if not exists faltante_en timestamptz;
comment on column public.caja_operacion_vtd.faltante is
  'Reporte abierto de Almacén: [{linea_id, cantidad_presentacion_disponible}]. null = sin reporte.';

CREATE OR REPLACE FUNCTION caja_almacen.operar(p_accion text, p_operacion_id uuid, p_sesion_id bigint, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  actor public.perfil%rowtype; ses public.sesion_caja%rowtype;
  op public.caja_operacion_almacen%rowtype; d public.caja_operacion_vtd%rowtype;
  v public.venta%rowtype; linea jsonb; actuales jsonb; salida bigint; result jsonb;
  ids bigint[]; vid bigint; v_motivo text; pago record; efectivo numeric;
  -- [AJUSTE] variables de reportar_faltante / ajustar
  faltantes jsonb; lin jsonb; hay_menor boolean:=false; resumen text:=''; factor numeric;
  nueva numeric; actual numeric; vl public.venta_linea%rowtype; subtotal_n numeric; total_n numeric;
  pagado numeric; ya_dev numeric; devol numeric; dev jsonb; destino text; ref text; mov bigint;
  antes jsonb; despues jsonb; hcli bigint; unidades numeric;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found or actor.rol not in ('cajero','admin','gerente','almacenero','operario') then raise exception 'Tu perfil no permite esta operación.' using errcode='42501'; end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos de operación inválidos.'; end if;
  v_motivo:=btrim(coalesce(p_datos->>'motivo',''));
  if length(v_motivo)>1000 then raise exception 'El motivo no puede superar 1000 caracteres.'; end if;

  -- [AJUSTE] + 'reportar_faltante'
  if p_accion in ('listar_almacen','consultar_vtd','escanear','enviar','recibir_retorno','reportar_faltante') then
    if actor.rol not in ('admin','gerente','almacenero','operario') then raise exception 'Esta acción corresponde a Almacén.' using errcode='42501'; end if;
    if p_accion='listar_almacen' then
      return jsonb_build_object('documentos',coalesce((select jsonb_agg(x) from (
        select ent.*,vs.numero,vs.total,u.sucursal_id from public.caja_operacion_vtd ent join public.venta vs on vs.id=ent.venta_id join public.ubicacion u on u.id=vs.ubicacion_id
        where ent.estado in ('SOLICITADO','EN_CAJA','RETORNO_PENDIENTE') and (actor.rol in ('admin','gerente') or actor.sucursal_id=u.sucursal_id)
        order by ent.venta_id limit 200
      ) x),'[]'::jsonb));
    end if;
    vid:=(p_datos->>'venta_id')::bigint;
    -- Orden global: cajero -> operación -> VTD -> venta. Igual al checkout.
    select o.* into op from public.caja_operacion_almacen o join public.caja_operacion_vtd l on l.operacion_id=o.id where l.venta_id=vid;
    if not found then return jsonb_build_object('operacion',null); end if;
    perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||op.cajero_id,0));
    select * into op from public.caja_operacion_almacen where id=op.id for update;
    select * into d from public.caja_operacion_vtd where venta_id=vid for update;
    select * into v from public.venta where id=vid for update;
    if actor.rol not in ('admin','gerente') and not exists(select 1 from public.ubicacion where id=v.ubicacion_id and sucursal_id=actor.sucursal_id) then raise exception 'Esta entrega pertenece a otra sucursal.' using errcode='42501'; end if;
    if p_accion='consultar_vtd' then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    if p_accion='escanear' then
      if d.estado='SOLICITADO' and d.escaneado_en is null then
        update public.caja_operacion_vtd set responsable_id=actor.id,escaneado_en=now(),version=version+1 where venta_id=vid;
        insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(op.id,vid,'ESCANEADO',actor.id);
      end if;
      return caja_almacen.respuesta_almacen(op.id,vid);
    end if;
    if p_accion='enviar' and d.estado in ('EN_CAJA','ENTREGADO') then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    if p_accion='recibir_retorno' and d.estado='RETORNADO' then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    -- [AJUSTE] Reporte idempotente: el mismo reporte abierto devuelve el estado actual aunque `version` ya avanzó.
    if p_accion='reportar_faltante' then
      if jsonb_typeof(p_datos->'disponibles') is distinct from 'array' or jsonb_array_length(p_datos->'disponibles')=0 then raise exception 'Indica la cantidad disponible de cada producto.'; end if;
      faltantes:=(select jsonb_agg(jsonb_build_object('linea_id',(x->>'linea_id')::bigint,'cantidad_presentacion_disponible',(x->>'cantidad_presentacion')::numeric) order by (x->>'linea_id')::bigint) from jsonb_array_elements(p_datos->'disponibles') x);
      if d.estado='SOLICITADO' and d.faltante is not null and d.faltante=faltantes then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    end if;
    if (p_datos->>'version')::integer is distinct from d.version then raise exception 'La entrega cambió. Actualiza antes de confirmar.' using errcode='40001'; end if;
    -- [AJUSTE] Almacén reporta cuánto material tiene realmente. No toca dinero.
    if p_accion='reportar_faltante' then
      if d.estado<>'SOLICITADO' or op.cerrado_en is not null or v.estado<>'ABIERTA' then raise exception 'La entrega ya no admite reportar faltante.'; end if;
      if d.responsable_id is not null and d.responsable_id<>actor.id then raise exception 'Otro encargado tiene esta verificación.' using errcode='42501'; end if;
      if length(v_motivo)<5 then raise exception 'Indica el motivo del faltante (mínimo 5 caracteres).'; end if;
      if (select count(distinct x->>'linea_id') from jsonb_array_elements(p_datos->'disponibles') x)<>jsonb_array_length(p_datos->'disponibles') then raise exception 'Una línea está repetida en el reporte.'; end if;
      for linea in select value from jsonb_array_elements(p_datos->'disponibles') loop
        lin:=null;
        select value into lin from jsonb_array_elements(d.lineas) where (value->>'linea_id')::bigint=(linea->>'linea_id')::bigint;
        if lin is null then raise exception 'La línea % no pertenece a esta VTD.',linea->>'linea_id'; end if;
        nueva:=(linea->>'cantidad_presentacion')::numeric; actual:=(lin->>'cantidad_presentacion')::numeric;
        if nueva is null or nueva<0 or nueva>actual then raise exception 'La cantidad disponible de % debe estar entre 0 y %.',lin->>'nombre',actual; end if;
        select factor_unidad_base into factor from public.presentacion where id=(lin->>'presentacion_id')::bigint;
        if factor is null then raise exception 'La línea % no tiene presentación válida.',linea->>'linea_id'; end if;
        -- Si se pidió una cantidad base entera, lo disponible tampoco puede partir una unidad base.
        if (lin->>'cantidad_base')::numeric=trunc((lin->>'cantidad_base')::numeric) and nueva*factor<>trunc(nueva*factor) then raise exception 'La cantidad disponible de % parte una unidad.',lin->>'nombre'; end if;
        if nueva<actual then hay_menor:=true; resumen:=resumen||(lin->>'nombre')||': '||nueva||' de '||actual||'; '; end if;
      end loop;
      if not hay_menor then raise exception 'Si hay todo el material, usa Enviar. El faltante debe ser menor a lo solicitado.'; end if;
      update public.caja_operacion_vtd set faltante=faltantes,faltante_en=now(),responsable_id=actor.id,version=version+1 where venta_id=vid;
      insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,vid,'FALTANTE_REPORTADO',actor.id,p_datos);
      begin
        perform public.caja_notificar('alertas','VTD_FALTANTE',jsonb_build_object('username','ROARI','embeds',jsonb_build_array(jsonb_build_object(
          'color',16705372,'title',':warning: Almacén reporta faltante',
          'fields',jsonb_build_array(
            jsonb_build_object('name','VTD','value',coalesce(v.numero,'#'||vid),'inline',true),
            jsonb_build_object('name','Reportado por','value',coalesce(actor.nombre::text,'desconocido'),'inline',true),
            jsonb_build_object('name','Disponible','value',left(resumen,900),'inline',false),
            jsonb_build_object('name','Motivo','value',left(v_motivo,900),'inline',false))))),
          'vtd:'||vid||':faltante:'||(d.version+1));
      exception when others then raise warning 'VTD_FALTANTE: %',sqlerrm; end;
      return caja_almacen.respuesta_almacen(op.id,vid);
    end if;
    if p_accion='enviar' then
      if d.estado<>'SOLICITADO' or op.cerrado_en is not null or v.estado<>'ABIERTA' then raise exception 'La entrega ya no está disponible para enviar.'; end if;
      -- [AJUSTE] Nadie despacha las cantidades viejas mientras Caja no ajuste.
      if d.faltante is not null then raise exception 'Almacén reportó faltante: espera el ajuste de Caja.'; end if;
      if d.responsable_id is not null and d.responsable_id<>actor.id then raise exception 'Otro encargado tiene esta verificación.' using errcode='42501'; end if;
      if d.escaneado_en is null and length(v_motivo)<5 then raise exception 'Indica el motivo para regularizar una verificación sin escaneo.'; end if;
      if p_datos->'cantidades' is distinct from (select jsonb_agg(jsonb_build_object('linea_id',x->'linea_id','cantidad_base',x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(d.lineas) x) then raise exception 'Comprueba todas las cantidades y presentaciones del documento.'; end if;
      insert into caja_almacen.contexto values(txid_current(),op.id);
      actuales:='[]';
      for linea in select value from jsonb_array_elements(d.lineas) loop
        if not exists(select 1 from public.presentacion pr where pr.id=(linea->>'presentacion_id')::bigint and pr.producto_id=(linea->>'producto_id')::bigint
          and coalesce(pr.activo,true) and round(pr.factor_unidad_base*(linea->>'cantidad_presentacion')::numeric,4)=round((linea->>'cantidad_base')::numeric,4)) then raise exception 'La presentación cambió. Revisa el documento antes de enviar.'; end if;
        -- Salida a custodia de Caja: queda en tránsito en este expediente, fuera del disponible.
        select public.registrar_salida(
          p_presentacion_id=>(linea->>'presentacion_id')::bigint,
          p_ubicacion_id=>public.resolver_ubicacion_salida((linea->>'producto_id')::bigint,v.ubicacion_id),
          p_cantidad_pres=>(linea->>'cantidad_presentacion')::numeric,
          p_referencia=>'Envío Caja VTD #'||vid,p_usuario=>actor.nombre::varchar,
          p_idempotencia=>'caja-almacen:envio:'||vid||':'||(linea->>'linea_id'),p_permitir_sobregiro=>false
        ) into salida;
        update public.venta_linea set kardex_transaccion_id=salida where id=(linea->>'linea_id')::bigint;
        actuales:=actuales||jsonb_build_array(linea||jsonb_build_object('kardex_id',salida));
      end loop;
      update public.caja_operacion_vtd set estado='EN_CAJA',lineas=actuales,responsable_id=actor.id,enviado_en=now(),motivo=nullif(v_motivo,''),version=version+1 where venta_id=vid;
      -- 2026-10-21: si la operación ya se cobró y no queda nada por enviar, se completa sola.
      if op.comprobante is not null
         and not exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO')
         and not exists(select 1 from public.venta_pago vp join public.caja_operacion_vtd x on x.venta_id=vp.venta_id
                         where x.operacion_id=op.id and vp.estado_verificacion::text='RECHAZADO') then
        update public.venta set estado='COMPLETADA',completado_en=now() where id in(select venta_id from public.caja_operacion_vtd where operacion_id=op.id and estado='EN_CAJA');
        update public.caja_operacion_vtd set estado='ENTREGADO',version=version+1 where operacion_id=op.id and estado='EN_CAJA';
        update public.caja_operacion_almacen set estado='COMPLETADA',cerrado_en=now(),revision=revision+1 where id=op.id;
        insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(op.id,vid,'COMPLETADA_AUTO',actor.id);
      end if;
      delete from caja_almacen.contexto where transaccion=txid_current();
    else
      if d.estado<>'RETORNO_PENDIENTE' then raise exception 'No hay material pendiente de retorno.'; end if;
      if p_datos->'cantidades' is distinct from (select jsonb_agg(jsonb_build_object('linea_id',x->'linea_id','cantidad_base',x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(d.lineas) x) then raise exception 'Declara la recepción completa; si falta material, conserva la incidencia pendiente.'; end if;
      for linea in select value from jsonb_array_elements(d.lineas) loop
        select ubicacion_id into vid from public.kardex_transacciones where id=(linea->>'kardex_id')::bigint;
        perform public.registrar_entrada((linea->>'presentacion_id')::bigint,vid,(linea->>'cantidad_presentacion')::numeric,
          'Retorno Caja VTD #'||d.venta_id,actor.nombre::varchar,current_date,null,'caja-almacen:retorno:'||d.venta_id||':'||(linea->>'linea_id'));
      end loop;
      update public.caja_operacion_vtd set estado='RETORNADO',recibido_en=now(),version=version+1 where venta_id=d.venta_id;
    end if;
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,d.venta_id,upper(p_accion),actor.id,p_datos);
    return caja_almacen.respuesta_almacen(op.id,d.venta_id);
  end if;

  if actor.rol not in ('cajero','admin','gerente') then raise exception 'Esta acción corresponde a Caja.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||actor.id,0));
  select * into op from public.caja_operacion_almacen where cajero_id=actor.id and cerrado_en is null and not en_espera for update;
  if p_accion='en_espera' then return caja_almacen.lista_en_espera(actor.id); end if;
  if p_accion='actual' then return coalesce(caja_almacen.respuesta(op.id),jsonb_build_object('operacion',null,'vtds','[]'::jsonb)); end if;
  if p_accion='crear_vtd' then
    if p_operacion_id is null or (op.id is not null and op.id<>p_operacion_id) then raise exception 'Retoma tu operación pendiente antes de solicitar otro material.'; end if;
    if exists(select 1 from public.caja_operacion_almacen where id=p_operacion_id and cajero_id<>actor.id) then raise exception 'La operación pertenece a otro cajero.' using errcode='42501'; end if;
    select detalle into result from public.caja_operacion_evento where operacion_id=p_operacion_id and accion='SOLICITUD_CREADA' order by id limit 1;
    if found then
      if result is distinct from p_datos->'solicitud' then raise exception 'La solicitud ya fue creada con otro contenido. Recupera su documento.'; end if;
      return caja_almacen.respuesta(p_operacion_id);
    end if;
    select * into ses from public.sesion_caja where id=p_sesion_id for update;
    if not found or ses.estado<>'ABIERTA' or (actor.rol='cajero' and ses.cajero_id is distinct from actor.id) then raise exception 'No tienes un turno propio abierto.' using errcode='42501'; end if;
    if op.id is null then insert into public.caja_operacion_almacen(id,cajero_id,sesion_id) values(p_operacion_id,actor.id,p_sesion_id) returning * into op; end if;
    if op.estado<>'ACTIVA' or op.sesion_id<>p_sesion_id then raise exception 'La operación ya fue cobrada o pertenece a otro turno.'; end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
    result:=public.abrir_venta(p_lineas=>p_datos->'solicitud'->'lineas',p_ubicacion_id=>(p_datos->'solicitud'->>'ubicacion_id')::bigint,
      p_sesion_caja_id=>p_sesion_id,p_pagos=>null,p_cliente_id=>nullif(p_datos->'solicitud'->>'cliente_id','')::bigint,
      p_descuento_total=>coalesce((p_datos->'solicitud'->>'descuento')::numeric,0),p_usuario=>actor.nombre,p_idempotencia=>'caja-almacen:crear:'||op.id);
    delete from caja_almacen.contexto where transaccion=txid_current();
    perform caja_almacen.operar('vincular',op.id,p_sesion_id,jsonb_build_object('vtd_ids',jsonb_build_array(result->'venta_id'),'borrador',coalesce(p_datos->'borrador','{}')));
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,(result->>'venta_id')::bigint,'SOLICITUD_CREADA',actor.id,p_datos->'solicitud');
    return caja_almacen.respuesta(op.id);
  end if;
  if p_accion='vincular' then
    if p_operacion_id is null then raise exception 'Identifica la operación actual.'; end if;
    if op.id is not null and op.id<>p_operacion_id then raise exception 'Primero retoma y resuelve tu operación pendiente.' using errcode='40001'; end if;
    select * into ses from public.sesion_caja where id=p_sesion_id for update;
    if not found or ses.estado<>'ABIERTA' or (actor.rol='cajero' and ses.cajero_id is distinct from actor.id) then raise exception 'No tienes un turno propio abierto.' using errcode='42501'; end if;
    if op.id is null then
      insert into public.caja_operacion_almacen(id,cajero_id,sesion_id) values(p_operacion_id,actor.id,p_sesion_id) returning * into op;
    end if;
    if op.sesion_id<>p_sesion_id or op.estado<>'ACTIVA' then raise exception 'La operación ya fue cobrada o pertenece a otro turno.'; end if;
    if p_datos ? 'borrador' then
      if jsonb_typeof(p_datos->'borrador') is distinct from 'object' then raise exception 'Borrador inválido.'; end if;
      if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id) and (p_datos->>'revision')::integer is distinct from op.revision then raise exception 'La operación cambió en otra pestaña. Recupera su versión actual.' using errcode='40001'; end if;
    end if;
    if jsonb_typeof(p_datos->'vtd_ids') is distinct from 'array' or jsonb_array_length(p_datos->'vtd_ids') not between 1 and 30 then raise exception 'Selecciona entre una y treinta VTD.'; end if;
    for vid in select distinct value::bigint from jsonb_array_elements_text(p_datos->'vtd_ids') order by 1 loop
      select * into d from public.caja_operacion_vtd where venta_id=vid;
      if found then
        if d.operacion_id<>op.id then raise exception 'La VTD ya pertenece a otra operación.'; end if;
        continue;
      end if;
      select * into v from public.venta where id=vid for update;
      if not found or v.numero not like 'VTD-%' or v.estado not in ('ABIERTA','COMPLETADA') or not v.cobro_exigible or v.total<=0 or exists(select 1 from public.venta_pago where venta_id=vid) then raise exception 'La VTD no está disponible para este cobro.'; end if;
      if v.estado='ABIERTA' and exists(select 1 from public.venta_linea where venta_id=vid and kardex_transaccion_id is not null) then raise exception 'La VTD ya tiene una salida registrada; revisa su entrega.'; end if;
      select jsonb_agg(jsonb_build_object('linea_id',l.id,'producto_id',l.producto_id,'presentacion_id',l.presentacion_id,'cantidad_base',l.cantidad,
        'cantidad_presentacion',coalesce(l.cantidad_presentacion,l.cantidad),'nombre',p.nombre,'presentacion',pr.nombre) order by l.id)
        into actuales from public.venta_linea l join public.producto p on p.id=l.producto_id join public.presentacion pr on pr.id=l.presentacion_id where l.venta_id=vid;
      if actuales is null then raise exception 'La VTD no tiene líneas con presentación válida.'; end if;
      insert into public.caja_operacion_vtd(venta_id,operacion_id,lineas,estado) values(vid,op.id,actuales,case when v.estado='COMPLETADA' then 'ENTREGADO' else 'SOLICITADO' end);
      insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(op.id,vid,'VINCULADO',actor.id);
    end loop;
    if (select count(*) from public.caja_operacion_vtd where operacion_id=op.id and estado in ('SOLICITADO','EN_CAJA','ENTREGADO'))>30 then raise exception 'La operación admite hasta treinta VTD.'; end if;
    if p_datos ? 'borrador' then update public.caja_operacion_almacen set borrador=p_datos->'borrador',revision=revision+1 where id=op.id; end if;
    return caja_almacen.respuesta(op.id);
  end if;
  -- Recuperar un resultado cerrado sólo para su propietario (respuesta perdida).
  if p_accion='retomar' then
    if p_operacion_id is null then raise exception 'Identifica la operación a retomar.'; end if;
    if op.id is not null and op.id<>p_operacion_id then raise exception 'Deja en espera tu operación actual antes de retomar otra.' using errcode='40001'; end if;
    select o.* into op from public.caja_operacion_almacen o join public.sesion_caja s on s.id=o.sesion_id
     where o.id=p_operacion_id and o.cerrado_en is null and o.estado='ACTIVA'
       and (o.cajero_id=actor.id or s.estado::text<>'ABIERTA') for update of o;
    if not found then raise exception 'Solo puedes retomar operaciones sin cobrar que sean tuyas o de un turno ya cerrado.'; end if;
    select * into ses from public.sesion_caja where cajero_id=actor.id and estado='ABIERTA' order by id desc limit 1 for update;
    if not found then raise exception 'Abre tu turno para retomar la operación.'; end if;
    update public.caja_operacion_almacen set en_espera=false,cajero_id=actor.id,sesion_id=ses.id,revision=revision+1 where id=op.id;
    insert into public.caja_operacion_evento(operacion_id,accion,actor_id) values(op.id,'RETOMADA',actor.id);
    return caja_almacen.respuesta(op.id);
  end if;
  if p_operacion_id is not null and op.id is distinct from p_operacion_id then
    select o.* into op from public.caja_operacion_almacen o join public.sesion_caja s on s.id=o.sesion_id
     where o.id=p_operacion_id
       and (o.cajero_id=actor.id or actor.rol in ('admin','gerente') or s.estado::text<>'ABIERTA') for update of o;
    if not found then op:=null; end if;
  end if;
  if op.id is null or op.id is distinct from p_operacion_id then raise exception 'Retoma tu operación actual antes de continuar.' using errcode='40001'; end if;
  if op.cerrado_en is not null then
    if p_accion in ('completar','cerrar_rechazo') then return caja_almacen.respuesta(op.id); end if;
    raise exception 'La operación ya está cerrada.';
  end if;
  select * into ses from public.sesion_caja where id=op.sesion_id for update;
  if ses.estado<>'ABIERTA' then
    if p_accion in ('guardar','aparcar') then raise exception 'El turno ya está cerrado.'; end if;
    -- [AJUSTE] + 'ajustar'
    if p_accion in ('rechazar','ajustar') then
      -- La devolución sale del turno abierto de quien rechaza/ajusta, no del turno cerrado.
      select * into ses from public.sesion_caja where cajero_id=actor.id and estado='ABIERTA' order by id desc limit 1 for update;
      if not found then raise exception 'Abre tu turno para registrar la devolución de esta VTD.'; end if;
    end if;
  end if;
  if p_accion in ('guardar','aparcar') and op.cajero_id<>actor.id then raise exception 'La operación pertenece a otro cajero.' using errcode='42501'; end if;
  if p_accion='aparcar' then
    if op.en_espera then return caja_almacen.respuesta(op.id); end if;
    if op.estado<>'ACTIVA' then raise exception 'Solo se deja en espera una operación sin cobrar.'; end if;
    if p_datos ? 'borrador' and jsonb_typeof(p_datos->'borrador')='object' then
      update public.caja_operacion_almacen set borrador=p_datos->'borrador' where id=op.id;
    end if;
    update public.caja_operacion_almacen set en_espera=true,revision=revision+1 where id=op.id;
    insert into public.caja_operacion_evento(operacion_id,accion,actor_id) values(op.id,'EN_ESPERA',actor.id);
    return caja_almacen.respuesta(op.id);
  end if;
  if p_accion='guardar' then
    if op.estado<>'ACTIVA' then raise exception 'El cobro ya fue registrado; no edites sus importes.'; end if;
    if (p_datos->>'revision')::integer is distinct from op.revision then raise exception 'La operación cambió en otra pestaña. Recupera su versión actual.' using errcode='40001'; end if;
    if jsonb_typeof(p_datos->'borrador') is distinct from 'object' then raise exception 'Borrador inválido.'; end if;
    update public.caja_operacion_almacen set borrador=p_datos->'borrador',revision=revision+1 where id=op.id;
  elsif p_accion='rechazar' then
    if length(v_motivo)<5 then raise exception 'Indica el motivo del rechazo (mínimo 5 caracteres).'; end if;
    vid:=(p_datos->>'venta_id')::bigint;
    select * into d from public.caja_operacion_vtd where venta_id=vid and operacion_id=op.id for update;
    if not found then raise exception 'La VTD no pertenece a esta operación.'; end if;
    if d.estado in ('CANCELADO','RETORNO_PENDIENTE','RETORNADO') then return caja_almacen.respuesta(op.id); end if;
    if d.estado='ENTREGADO' then raise exception 'La entrega ya se completó. Usa el procedimiento de devolución.'; end if;
    select * into v from public.venta where id=vid for update;
    if exists(select 1 from public.venta_pago where venta_id=vid) then
      if p_datos->>'devolucion_realizada' is distinct from 'true' or length(btrim(coalesce(p_datos->>'referencia','')))<3 then raise exception 'Confirma la devolución realizada e indica su referencia antes de resolver el rechazo.'; end if;
      select coalesce(sum(case when tipo in ('VENTA','ANTICIPO','INGRESO') then monto when tipo in ('EGRESO','ANULACION') then -monto else 0 end),0)+ses.monto_apertura into efectivo from public.movimiento_caja where sesion_caja_id=ses.id and metodo='EFECTIVO' and not fuera_de_arqueo;
      if efectivo<(select coalesce(sum(monto),0) from public.venta_pago where venta_id=vid and metodo='EFECTIVO') then raise exception 'No hay efectivo suficiente en este turno para registrar la devolución.'; end if;
    end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
    for pago in select * from public.venta_pago where venta_id=vid loop
      insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,venta_id,creado_por,nota)
        values(ses.id,'ANULACION',pago.metodo,pago.monto,vid,actor.nombre,'Rechazo VTD: '||v_motivo||' · '||(p_datos->>'referencia'));
    end loop;
    update public.venta set estado='ANULADA' where id=vid;
    update public.caja_operacion_vtd set estado=case when d.estado='EN_CAJA' then 'RETORNO_PENDIENTE' else 'CANCELADO' end,motivo=v_motivo,version=version+1 where venta_id=vid;
    delete from caja_almacen.contexto where transaccion=txid_current();
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,vid,'RECHAZADO',actor.id,p_datos);
  -- [AJUSTE] Caja reduce la VTD mientras el material no salió de Almacén y devuelve la diferencia.
  elsif p_accion='ajustar' then
    if length(v_motivo)<5 then raise exception 'Indica el motivo del ajuste (mínimo 5 caracteres).'; end if;
    vid:=(p_datos->>'venta_id')::bigint;
    select * into d from public.caja_operacion_vtd where venta_id=vid and operacion_id=op.id for update;
    if not found then raise exception 'La VTD no pertenece a esta operación.'; end if;
    if d.estado<>'SOLICITADO' then raise exception 'Solo se ajusta una VTD cuyo material no salió de Almacén. Usa Rechazar o el retorno.'; end if;
    if (p_datos->>'version')::integer is distinct from d.version then raise exception 'La entrega cambió. Actualiza antes de confirmar.' using errcode='40001'; end if;
    select * into v from public.venta where id=vid for update;
    if coalesce(v.saldo_favor_aplicado,0)>0 then raise exception 'Esta VTD usó saldo a favor. Resuélvela con el gerente.'; end if;
    if exists(select 1 from public.venta_pago where venta_id=vid and estado_verificacion::text='RECHAZADO') then raise exception 'Hay un pago digital rechazado en esta VTD. Resuélvelo con el gerente.'; end if;
    if jsonb_typeof(p_datos->'lineas') is distinct from 'array' or jsonb_array_length(p_datos->'lineas')=0 then raise exception 'Indica las nuevas cantidades.'; end if;
    antes:=(select jsonb_agg(jsonb_build_object('linea_id',l.id,'cantidad_presentacion',coalesce(l.cantidad_presentacion,l.cantidad)) order by l.id) from public.venta_linea l where l.venta_id=vid);
    antes:=jsonb_build_object('lineas',antes,'total',v.total);
    insert into caja_almacen.contexto values(txid_current(),op.id);
    for linea in select value from jsonb_array_elements(p_datos->'lineas') loop
      select * into vl from public.venta_linea where id=(linea->>'linea_id')::bigint and venta_id=vid for update;
      if not found then raise exception 'La línea % no pertenece a esta VTD.',linea->>'linea_id'; end if;
      nueva:=(linea->>'cantidad_presentacion')::numeric; actual:=coalesce(vl.cantidad_presentacion,vl.cantidad);
      if nueva is null or nueva<0 then raise exception 'La cantidad no puede ser negativa.'; end if;
      if nueva>actual then raise exception 'Solo se puede reducir. Para vender más crea una VTD nueva.'; end if;
      if nueva=actual then continue; end if;
      select factor_unidad_base into factor from public.presentacion where id=vl.presentacion_id;
      if factor is null then raise exception 'La línea % no tiene presentación válida.',vl.id; end if;
      hay_menor:=true;
      insert into public.venta_evento(venta_id,linea_id,accion,motivo,cantidad_anterior,cantidad_nueva,usuario)
        values(vid,vl.id,case when nueva=0 then 'LINEA_RECHAZADA' else 'LINEA_CAMBIADA' end,v_motivo,actual,nueva,actor.nombre);
      if nueva=0 then delete from public.venta_linea where id=vl.id;
      else update public.venta_linea set cantidad_presentacion=nueva,cantidad=nueva*factor where id=vl.id; end if;
    end loop;
    if not hay_menor then raise exception 'No hay cambios que ajustar.'; end if;
    select coalesce(sum(coalesce(cantidad_presentacion,cantidad)),0),coalesce(sum(round(precio_unitario*coalesce(cantidad_presentacion,cantidad),2)),0)
      into unidades,subtotal_n from public.venta_linea where venta_id=vid;
    if unidades<=0 then raise exception 'Para quitar toda la VTD usa Rechazar.'; end if;
    if subtotal_n<coalesce(v.descuento_total,0) then raise exception 'El nuevo subtotal no cubre el descuento de la venta.'; end if;
    total_n:=round(subtotal_n-coalesce(v.descuento_total,0),2);
    update public.venta set subtotal=subtotal_n,total=total_n where id=vid;
    -- Devolución: lo cobrado menos lo ya devuelto por ajustes previos menos el nuevo total.
    select coalesce(sum(monto),0) into pagado from public.venta_pago where venta_id=vid;
    select coalesce(sum((detalle->>'devolucion')::numeric),0) into ya_dev from public.caja_operacion_evento where venta_id=vid and accion='AJUSTADO';
    devol:=round(pagado-ya_dev-total_n,2);
    dev:=p_datos->'devolucion'; destino:=null; ref:=''; mov:=null;
    if pagado>0 and devol>0 then
      if dev is null or jsonb_typeof(dev)<>'object' or dev->>'realizada' is distinct from 'true' then raise exception 'Confirma la devolución de Bs % antes de ajustar.',devol; end if;
      destino:=dev->>'destino'; ref:=btrim(coalesce(dev->>'referencia',''));
      if destino is null or destino not in ('EFECTIVO','QR','TRANSFERENCIA','SALDO_FAVOR','YA_REGISTRADA') then raise exception 'Elige cómo se devuelve el importe.'; end if;
      if destino in ('QR','TRANSFERENCIA') and length(ref)<3 then raise exception 'Indica la referencia de la devolución.'; end if;
      if destino='YA_REGISTRADA' and actor.rol not in ('admin','gerente') then raise exception 'Solo un gerente regulariza una devolución ya registrada.' using errcode='42501'; end if;
      if destino in ('EFECTIVO','QR','TRANSFERENCIA') then
        if destino='EFECTIVO' then
          select coalesce(sum(case when tipo in ('VENTA','ANTICIPO','INGRESO') then monto when tipo in ('EGRESO','ANULACION') then -monto else 0 end),0)+ses.monto_apertura into efectivo from public.movimiento_caja where sesion_caja_id=ses.id and metodo='EFECTIVO' and not fuera_de_arqueo;
          if efectivo<devol then raise exception 'No hay efectivo suficiente en este turno para registrar la devolución.'; end if;
        end if;
        insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,venta_id,creado_por,nota)
          values(ses.id,'ANULACION',destino::public.metodo_pago,devol,vid,actor.nombre,'Ajuste VTD: '||v_motivo||case when ref='' then '' else ' · '||ref end) returning id into mov;
      elsif destino='SALDO_FAVOR' then
        select id into hcli from hermes.cliente where pos_cliente_id=v.cliente_id and activo;
        if v.cliente_id is null or hcli is null then raise exception 'El saldo a favor requiere un cliente registrado con cuenta en Hermes.'; end if;
        insert into hermes.movimiento_cuenta(cliente_id,tipo,monto,idempotencia_clave,referencia,motivo,fecha_efectiva,creado_por)
          values(hcli,'NOTA_CREDITO',-devol,'caja-almacen:ajuste:'||vid||':'||(d.version+1),v.numero,'Ajuste VTD: '||v_motivo,(now() at time zone 'America/La_Paz')::date,coalesce(actor.email,actor.id::text));
      else
        mov:=nullif(dev->>'movimiento_id','')::bigint;
        if mov is null or not exists(select 1 from public.movimiento_caja where id=mov and tipo::text='EGRESO' and sesion_caja_id=op.sesion_id and monto=devol) then raise exception 'El egreso indicado no existe en el turno de la operación o su monto no coincide con la devolución (Bs %).',devol; end if;
        if exists(select 1 from public.caja_operacion_evento where accion='AJUSTADO' and (detalle->>'movimiento_id')::bigint=mov) then raise exception 'Ese egreso ya está vinculado a otro ajuste.'; end if;
      end if;
    else
      if dev is not null and jsonb_typeof(dev)<>'null' then raise exception 'Esta VTD no tiene importe por devolver.'; end if;
      devol:=0;
    end if;
    delete from caja_almacen.contexto where transaccion=txid_current();
    -- La VTD que Almacén verá: mismas líneas que produce `vincular`, ya con las cantidades nuevas.
    select jsonb_agg(jsonb_build_object('linea_id',l.id,'producto_id',l.producto_id,'presentacion_id',l.presentacion_id,'cantidad_base',l.cantidad,
      'cantidad_presentacion',coalesce(l.cantidad_presentacion,l.cantidad),'nombre',p.nombre,'presentacion',pr.nombre) order by l.id)
      into actuales from public.venta_linea l join public.producto p on p.id=l.producto_id join public.presentacion pr on pr.id=l.presentacion_id where l.venta_id=vid;
    despues:=jsonb_build_object('lineas',(select jsonb_agg(jsonb_build_object('linea_id',x->'linea_id','cantidad_presentacion',x->'cantidad_presentacion')) from jsonb_array_elements(actuales) x),'total',total_n);
    update public.caja_operacion_vtd set lineas=actuales,faltante=null,faltante_en=null,version=version+1 where venta_id=vid;
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle)
      values(op.id,vid,'AJUSTADO',actor.id,jsonb_build_object('antes',antes,'despues',despues,'devolucion',devol,'destino',destino,'referencia',nullif(ref,''),'movimiento_id',mov,'motivo',v_motivo));
    begin
      perform public.caja_notificar('alertas','VTD_AJUSTADA',jsonb_build_object('username','ROARI','embeds',jsonb_build_array(jsonb_build_object(
        'color',5763719,'title',':pencil2: VTD ajustada por faltante',
        'fields',jsonb_build_array(
          jsonb_build_object('name','VTD','value',coalesce(v.numero,'#'||vid),'inline',true),
          jsonb_build_object('name','Nuevo total','value','Bs '||total_n,'inline',true),
          jsonb_build_object('name','Devuelto','value','Bs '||devol||coalesce(' · '||destino,''),'inline',true),
          jsonb_build_object('name','Ajustado por','value',coalesce(actor.nombre::text,'desconocido'),'inline',true),
          jsonb_build_object('name','Motivo','value',left(v_motivo,900),'inline',false))))),
        'vtd:'||vid||':ajustada:'||(d.version+1));
    exception when others then raise warning 'VTD_AJUSTADA: %',sqlerrm; end;
  elsif p_accion in ('completar','cerrar_rechazo') then
    if p_accion='completar' then
      if op.comprobante is null then raise exception 'Primero registra el cobro conjunto de esta operación.'; end if;
      if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO') then raise exception 'Pendiente de verificación de Almacén. Puedes cobrar el conjunto, pero todavía no completar.'; end if;
      if exists(select 1 from public.venta_pago where venta_id in(select value::bigint from jsonb_array_elements_text(op.comprobante->'ventas')) and estado_verificacion::text = 'RECHAZADO' and exists(select 1 from public.venta vs where vs.id=venta_id and vs.estado<>'ANULADA')) then raise exception 'Hay un pago digital rechazado en esta operación. Resuélvelo con el gerente antes de entregar.'; end if;
      insert into caja_almacen.contexto values(txid_current(),op.id);
      update public.venta set estado='COMPLETADA',completado_en=now() where id in(select venta_id from public.caja_operacion_vtd where operacion_id=op.id and estado='EN_CAJA');
      update public.caja_operacion_vtd set estado='ENTREGADO',version=version+1 where operacion_id=op.id and estado='EN_CAJA';
      delete from caja_almacen.contexto where transaccion=txid_current();
    else
      if op.comprobante is not null or exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado in ('SOLICITADO','EN_CAJA','ENTREGADO')) then raise exception 'Completa el cobro y la entrega de la operación vigente.'; end if;
      if jsonb_array_length(coalesce(op.borrador->'cart','[]'))>0 then raise exception 'Resuelve también los productos VTA de la operación.'; end if;
    end if;
    update public.caja_operacion_almacen set estado=case when p_accion='completar' then 'COMPLETADA' else 'RECHAZADA' end,cerrado_en=now(),revision=revision+1 where id=op.id;
    insert into public.caja_operacion_evento(operacion_id,accion,actor_id) values(op.id,upper(p_accion),actor.id);
  else raise exception 'Acción desconocida.';
  end if;
  return caja_almacen.respuesta(op.id);
end;
$function$;

-- Supabase ignora los privilegios por defecto en funciones: se reemiten explícitamente.
revoke all on function caja_almacen.operar(text,uuid,bigint,jsonb) from public, anon;
grant execute on function caja_almacen.operar(text,uuid,bigint,jsonb) to authenticated;
revoke all on function public.operar_caja_almacen(text,uuid,bigint,jsonb) from public, anon;
grant execute on function public.operar_caja_almacen(text,uuid,bigint,jsonb) to authenticated;
