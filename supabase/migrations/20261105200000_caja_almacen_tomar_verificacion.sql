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
