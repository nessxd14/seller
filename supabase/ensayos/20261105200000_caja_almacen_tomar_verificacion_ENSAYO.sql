-- ENSAYO de 20261105200000_caja_almacen_tomar_verificacion.sql: BEGIN … ROLLBACK, no deja nada. Correr con la caja cerrada.
begin;
-- Almacén puede tomar una verificación que quedó a nombre de otro encargado (2026-11-05).
--
-- `escanear` fija responsable_id y, hasta ahora, `enviar` y `reportar_faltante` fallaban para
-- cualquier otra persona, incluso admin y gerente. En el relevo la VTD quedaba trabada y la
-- única salida era rechazarla. Se agrega la acción `tomar_verificacion` y se devuelve el nombre
-- del encargado para mostrarlo en la pantalla.
--
-- No mueve stock ni dinero. Se conserva escaneado_en: tomar no equivale a escanear.
-- Antes de aplicar: correr supabase/ensayos/20261105200000_caja_almacen_tomar_verificacion_ENSAYO.sql
-- con la caja cerrada. Publicar el PR de Almacén después de aplicar.

do $mig$
declare d text; viejo text; nuevo text;
begin
  d := replace(pg_get_functiondef('caja_almacen.operar(text,uuid,bigint,jsonb)'::regprocedure), E'\r\n', E'\n');

  viejo := $q$if p_accion in ('listar_almacen','consultar_vtd','escanear','enviar','recibir_retorno','reportar_faltante') then$q$;
  nuevo := $q$if p_accion in ('listar_almacen','consultar_vtd','escanear','enviar','recibir_retorno','reportar_faltante','tomar_verificacion') then$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (a) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  -- Reintento: si ya es el encargado, devuelve el estado aunque `version` haya avanzado.
  viejo := $q$    -- [AJUSTE] Reporte idempotente: el mismo reporte abierto$q$;
  nuevo := $q$    if p_accion='tomar_verificacion' and d.responsable_id is not distinct from actor.id then return caja_almacen.respuesta_almacen(op.id,vid); end if;  -- [TOMAR]
    -- [AJUSTE] Reporte idempotente: el mismo reporte abierto$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (b) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  viejo := $q$    -- [AJUSTE] Almacén reporta cuánto material tiene realmente. No toca dinero.$q$;
  nuevo := $q$    -- [TOMAR] Cambia el encargado; queda el anterior en el evento.
    if p_accion='tomar_verificacion' then
      if d.estado<>'SOLICITADO' or op.cerrado_en is not null or v.estado<>'ABIERTA' then raise exception 'La entrega ya no admite cambiar de encargado.'; end if;
      update public.caja_operacion_vtd set responsable_id=actor.id,version=version+1 where venta_id=vid;
      insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle)
        values(op.id,vid,'VERIFICACION_TOMADA',actor.id,jsonb_build_object('anterior',d.responsable_id));
      return caja_almacen.respuesta_almacen(op.id,vid);
    end if;
    -- [AJUSTE] Almacén reporta cuánto material tiene realmente. No toca dinero.$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón (c) no encontrado una vez'; end if;
  d := replace(d, viejo, nuevo);

  execute d;
end
$mig$;

CREATE OR REPLACE FUNCTION caja_almacen.respuesta_almacen(p_id uuid, p_venta bigint)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('operacion',jsonb_build_object('id',r->'operacion'->'id','estado',r->'operacion'->'estado'),
    'vtds',coalesce((select jsonb_agg(x||jsonb_build_object('responsable_nombre',(select p.nombre from public.perfil p where p.id=(x->>'responsable_id')::uuid)))
                       from jsonb_array_elements(r->'vtds') x where (x->>'venta_id')::bigint=p_venta),'[]'::jsonb))
  from (select caja_almacen.respuesta(p_id) r) q;
$function$;

create function pg_temp.como(uid uuid) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end $fn$;
create function pg_temp.vtd(cajero uuid, ses bigint, opid uuid, prod bigint, pres bigint, ubi bigint) returns bigint language plpgsql as $fn$
declare r jsonb;
begin
  perform pg_temp.como(cajero);
  r := public.operar_caja_almacen('crear_vtd', opid, ses, jsonb_build_object('borrador','{}'::jsonb,'solicitud',jsonb_build_object(
    'lineas', jsonb_build_array(jsonb_build_object('producto_id',prod,'presentacion_id',pres,'cantidad_presentacion',2,'precio_unitario',45)),
    'ubicacion_id',ubi,'descuento',0,'cliente_id',null)));
  return (r->'vtds'->0->>'venta_id')::bigint;
end $fn$;
create function pg_temp.enviar(alm uuid, vid bigint) returns jsonb language plpgsql as $fn$
declare cur jsonb;
begin
  perform pg_temp.como(alm);
  cur := public.operar_caja_almacen('escanear', null, null, jsonb_build_object('venta_id', vid))->'vtds'->0;
  return public.operar_caja_almacen('enviar', null, null, jsonb_build_object('venta_id', vid, 'version', (cur->>'version')::int,
    'cantidades', (select jsonb_agg(jsonb_build_object('linea_id', x->'linea_id', 'cantidad_base', x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(cur->'lineas') x)));
end $fn$;

do $t$
declare
  cajero uuid; ness uuid; otro uuid; ses bigint; prod bigint; pres bigint; ubi bigint; opid uuid; vid bigint; r jsonb; cur jsonb; res text := ''; fallo text;
begin
  update evidencia_vtd.configuracion set activo = false where id;
  select id into cajero from public.perfil where email = 'ivar1230@gmail.com';
  select id into ness from public.perfil where email = 'nessxd14@gmail.com';
  select pr.id, pr.producto_id, s.ubicacion_id into pres, prod, ubi from public.presentacion pr
    join public.stock_actual s on s.producto_id = pr.producto_id join public.producto pp on pp.id = pr.producto_id
   where pr.factor_unidad_base = 1 and coalesce(pr.activo, true) and pr.vende_tienda and coalesce(pp.activo, true) and s.cantidad_base >= 50
   order by s.cantidad_base desc limit 1;
  select id into ses from public.sesion_caja where estado::text = 'ABIERTA' and cajero_id = cajero;
  if ses is null then
    if exists (select 1 from public.sesion_caja where estado::text = 'ABIERTA') then raise exception 'ENSAYO: hay un turno real abierto de otro cajero; correr con la caja cerrada.'; end if;
    perform pg_temp.como(cajero); ses := (public.abrir_turno(1, '{}'::jsonb)->>'sesion_id')::bigint;
  end if;
  select p.id into otro from public.perfil p join public.ubicacion u on u.id = ubi
   where p.activo and p.rol in ('almacenero','operario') and p.sucursal_id = u.sucursal_id limit 1;
  if otro is null then raise exception 'ENSAYO: no hay almacenero u operario activo en la sucursal.'; end if;

  opid := gen_random_uuid(); vid := pg_temp.vtd(cajero, ses, opid, prod, pres, ubi);
  perform pg_temp.como(otro);
  cur := public.operar_caja_almacen('escanear', null, null, jsonb_build_object('venta_id', vid))->'vtds'->0;
  if cur->>'responsable_id' <> otro::text or cur->>'responsable_nombre' is null then raise exception 'ENSAYO FALLÓ [1]: escanear no devuelve el encargado: %', cur; end if;
  res := res || E'\n1 ESCANEAR con nombre: ok';

  perform pg_temp.como(ness);
  fallo := null;
  begin
    perform public.operar_caja_almacen('enviar', null, null, jsonb_build_object('venta_id', vid, 'version', (cur->>'version')::int,
      'cantidades', (select jsonb_agg(jsonb_build_object('linea_id', x->'linea_id', 'cantidad_base', x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(cur->'lineas') x)));
  exception when others then fallo := sqlerrm; end;
  if coalesce(fallo,'') not like 'Otro encargado%' then raise exception 'ENSAYO FALLÓ [2]: enviar ajeno debía rechazarse: %', fallo; end if;
  res := res || E'\n2 ENVIAR de otra persona rechazado: ok';

  r := public.operar_caja_almacen('tomar_verificacion', null, null, jsonb_build_object('venta_id', vid, 'version', (cur->>'version')::int));
  cur := r->'vtds'->0;
  if cur->>'responsable_id' <> ness::text then raise exception 'ENSAYO FALLÓ [3]: no cambió el encargado'; end if;
  if not exists (select 1 from public.caja_operacion_evento where venta_id = vid and accion = 'VERIFICACION_TOMADA' and detalle->>'anterior' = otro::text) then raise exception 'ENSAYO FALLÓ [3]: sin evento'; end if;
  if exists (select 1 from public.venta_linea where venta_id = vid and kardex_transaccion_id is not null) then raise exception 'ENSAYO FALLÓ [3]: tomar movió stock'; end if;
  r := public.operar_caja_almacen('tomar_verificacion', null, null, jsonb_build_object('venta_id', vid, 'version', 0));
  if (r->'vtds'->0->>'version')::int <> (cur->>'version')::int then raise exception 'ENSAYO FALLÓ [3]: el reintento cambió la versión'; end if;
  res := res || E'\n3 TOMAR con evento y sin stock, reintento sin efecto: ok';

  r := public.operar_caja_almacen('enviar', null, null, jsonb_build_object('venta_id', vid, 'version', (cur->>'version')::int,
    'cantidades', (select jsonb_agg(jsonb_build_object('linea_id', x->'linea_id', 'cantidad_base', x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(cur->'lineas') x)));
  if r->'vtds'->0->>'estado' <> 'EN_CAJA' then raise exception 'ENSAYO FALLÓ [4]: no quedó EN_CAJA'; end if;
  res := res || E'\n4 ENVIAR del nuevo encargado: ok';

  perform pg_temp.como(otro);
  fallo := null;
  begin
    perform public.operar_caja_almacen('tomar_verificacion', null, null, jsonb_build_object('venta_id', vid, 'version', (r->'vtds'->0->>'version')::int));
  exception when others then fallo := sqlerrm; end;
  if coalesce(fallo,'') not like 'La entrega ya no admite%' then raise exception 'ENSAYO FALLÓ [5]: tomar después de salir debía rechazarse: %', fallo; end if;
  res := res || E'\n5 TOMAR después de la salida rechazado: ok';

  raise exception E'ENSAYO OK (revertido):%', res;
end $t$;

rollback;
