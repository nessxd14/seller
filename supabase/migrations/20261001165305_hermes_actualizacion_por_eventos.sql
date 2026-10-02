-- Vincular comprobantes es una operación limitada: no concede UPDATE a pago.
create or replace function hermes.asociar_comprobante_pago(p_pago_id bigint,p_evidencia_id bigint)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,hermes as $$
declare ruta text; resultado jsonb;
begin
 if auth.uid() is null or hermes.rol_actual() not in ('admin','gerente') then
   raise exception 'Tu rol no puede gestionar comprobantes' using errcode='42501';
 end if;
 perform 1 from hermes.pago where id=p_pago_id for update;
 if not found then raise exception 'Pago no existe' using errcode='P0002'; end if;
 if p_evidencia_id is not null then
   select storage_path into ruta from hermes.evidencia where id=p_evidencia_id;
   if not found then raise exception 'Evidencia no existe' using errcode='P0002'; end if;
   if not exists(select 1 from storage.objects where bucket_id='documentos-expediente' and name=ruta) then
     raise exception 'El archivo del comprobante no está disponible' using errcode='22023';
   end if;
 end if;
 update hermes.pago set evidencia_id=p_evidencia_id where id=p_pago_id
 returning jsonb_build_object('id',id,'evidencia_id',evidencia_id) into resultado;
 return resultado;
end $$;
revoke all on function hermes.asociar_comprobante_pago(bigint,bigint) from public,anon,service_role;
grant execute on function hermes.asociar_comprobante_pago(bigint,bigint) to authenticated;

-- La fecha registrada por despacho tiene prioridad sobre la fecha de recepción.
create or replace function public.comision_trigger_sync_partida_pedido() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
begin
 if new.estado::text='COMPLETADO' and old.estado is distinct from new.estado then
   perform hermes.sincronizar_pedido_pos(new.id,
     coalesce((select q.fecha_completado from public.pendiente_sync_hermes_despacho q where q.pedido_id=new.id),
       (new.recibido_en at time zone 'America/La_Paz')::date,(now() at time zone 'America/La_Paz')::date));
 end if;
 return new;
end $$;

notify pgrst,'reload schema';
