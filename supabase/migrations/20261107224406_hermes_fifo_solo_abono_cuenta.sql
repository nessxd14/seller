-- El destino original queda registrado en Caja, incluso si se retira el reparto.
create schema if not exists hermes_privado;
revoke all on schema hermes_privado from public, anon, authenticated, service_role;
grant usage on schema hermes_privado to hermes_app;

-- El rol de Hermes no ve los movimientos de Caja bajo sus políticas RLS.
-- Se expone únicamente una respuesta booleana a la función interna de confirmación.
create or replace function hermes_privado.cobro_caja_dirigido(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.movimiento_caja m
    cross join lateral (
      select substring(p_clave from '^pos-pago-mov-([1-9][0-9]{0,18})$') as id_texto
    ) origen
    where auth.uid() is not null
      and m.id = case when pg_input_is_valid(origen.id_texto, 'bigint')
                      then origen.id_texto::bigint end
      and m.pedido_id is not null
  );
$$;

revoke all on function hermes_privado.cobro_caja_dirigido(text)
  from public, anon, authenticated, service_role;
grant execute on function hermes_privado.cobro_caja_dirigido(text) to hermes_app;

CREATE OR REPLACE FUNCTION hermes.confirmar_pago(p_pago_id bigint, p_usuario text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hermes', 'public'
AS $function$
declare
  v_pago      record;
  v_rol       text;
  v_actor     text;
  v_n         int;
  v_a         record;
  v_imputado  numeric := 0;
  v_excedente numeric;
  v_fecha     date;
begin
  v_rol := hermes.rol_actual();
  if v_rol not in ('gerente','admin') then
    raise exception 'Solo el rol gerente puede confirmar pagos (rol actual: %)',
                    coalesce(nullif(v_rol,''), 'sin rol');
  end if;
  v_actor := coalesce((coalesce(nullif(current_setting('request.jwt.claim',true),''),nullif(current_setting('request.jwt.claims',true),''))::jsonb) ->> 'email', current_user);
  v_fecha := (now() at time zone 'America/La_Paz')::date;

  select * into v_pago from pago where id = p_pago_id;
  if not found then raise exception 'Pago % no existe', p_pago_id; end if;
  perform 1 from cliente where id=v_pago.cliente_id for update;
  perform 1 from partida_abierta where cliente_id=v_pago.cliente_id order by id for update;
  select * into v_pago from pago where id=p_pago_id for update;
  if not found then raise exception 'Pago % no existe', p_pago_id; end if;
  if v_pago.estado <> 'PROPUESTO' then
    raise exception 'El pago % está en estado % y no se puede confirmar', p_pago_id, v_pago.estado;
  end if;

  -- Solo un abono a cuenta puede recibir un reparto automático por antigüedad.
  select count(*) into v_n from pago_aplicacion where pago_id = p_pago_id;
  if v_n = 0 and not v_pago.no_imputar
     and not hermes_privado.cobro_caja_dirigido(v_pago.idempotencia_clave) then
    insert into pago_aplicacion (pago_id, partida_id, monto)
    select p_pago_id, f.o_partida_id, f.o_aplica
      from calcular_imputacion_fifo(v_pago.cliente_id, v_pago.monto) f;
  end if;

  -- Valida el saldo vigente después de adquirir los bloqueos: dos propuestas no pueden cancelar la misma deuda.
  if exists(select 1 from pago_aplicacion ap join v_partida_estado ve on ve.partida_id=ap.partida_id
     where ap.pago_id=p_pago_id and (ve.cliente_id<>v_pago.cliente_id or ve.estado<>'ABIERTA' or ap.monto>ve.pendiente))
     or (select coalesce(sum(monto),0) from pago_aplicacion where pago_id=p_pago_id)>v_pago.monto
     or (v_pago.no_imputar and exists(select 1 from pago_aplicacion where pago_id=p_pago_id)) then
    raise exception 'El reparto ya no coincide con la deuda vigente. Revisar antes de confirmar.';
  end if;
  update pago set estado = 'CONFIRMADO', confirmado_por = v_actor, confirmado_en = now()
   where id = p_pago_id;

  for v_a in
    select ap.partida_id, ap.monto, pa.documento_interno
      from pago_aplicacion ap
      join partida_abierta pa on pa.id = ap.partida_id
     where ap.pago_id = p_pago_id
     order by ap.partida_id
  loop
    insert into movimiento_cuenta (cliente_id, partida_id, pago_id, tipo, monto,
                                   idempotencia_clave, fecha_efectiva, referencia,
                                   motivo, creado_por)
    values (v_pago.cliente_id, v_a.partida_id, p_pago_id, 'PAGO', -v_a.monto,
            'pago-confirmado-' || p_pago_id || '-' || v_a.partida_id,
            v_fecha, coalesce(v_pago.referencia, v_a.documento_interno),
            'Pago confirmado', v_actor);
    v_imputado := v_imputado + v_a.monto;
  end loop;

  v_excedente := v_pago.monto - v_imputado;
  if v_excedente > 0 then
    insert into movimiento_cuenta (cliente_id, partida_id, pago_id, tipo, monto,
                                   idempotencia_clave, fecha_efectiva, referencia,
                                   motivo, creado_por)
    values (v_pago.cliente_id, null, p_pago_id, 'ANTICIPO', -v_excedente,
            'pago-anticipo-' || p_pago_id, v_fecha, v_pago.referencia,
            case when v_pago.no_imputar then 'Anticipo a favor del cliente'
                 else 'Excedente sin imputar' end,
            v_actor);
  end if;

  update partida_abierta pa
     set estado = 'PAGADA'
    from v_partida_estado ve
   where ve.partida_id = pa.id
     and pa.id in (select ap.partida_id from pago_aplicacion ap where ap.pago_id = p_pago_id)
     and pa.estado = 'ABIERTA'
     and ve.pendiente <= 0;
end;
$function$;
