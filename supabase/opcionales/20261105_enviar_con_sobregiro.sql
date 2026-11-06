-- OPCIONAL. Solo si Ness decide permitir sobregiro en `enviar` mientras dura el reordenamiento.
--
-- resolver_ubicacion_salida elige UNA ubicación: la de mayor stock. Sin sobregiro, `enviar` falla
-- con «Stock insuficiente en ubicación» aunque el material esté en la mano o repartido entre
-- estantes. El flujo anterior (completar_venta) sí permitía sobregiro.
-- Efecto: el stock de esa ubicación puede quedar negativo hasta corregirlo con conteo o traslado.
-- Reversa: correr el mismo reemplazo al revés (true -> false).

do $mig$
declare d text; viejo text; nuevo text;
begin
  d := replace(pg_get_functiondef('caja_almacen.operar(text,uuid,bigint,jsonb)'::regprocedure), E'\r\n', E'\n');
  viejo := $q$p_idempotencia=>'caja-almacen:envio:'||vid||':'||(linea->>'linea_id'),p_permitir_sobregiro=>false$q$;
  nuevo := $q$p_idempotencia=>'caja-almacen:envio:'||vid||':'||(linea->>'linea_id'),p_permitir_sobregiro=>true$q$;
  if (length(d) - length(replace(d, viejo, ''))) / length(viejo) <> 1 then raise exception 'MIGRACIÓN: patrón no encontrado una vez'; end if;
  execute replace(d, viejo, nuevo);
end
$mig$;
