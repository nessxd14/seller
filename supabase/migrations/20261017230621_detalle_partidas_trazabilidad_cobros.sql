-- Historial nuevo: no se reconstruyen identidades, roles ni fechas que no se guardaron.
create table hermes.cobro_evento (
  id bigint generated always as identity primary key,
  accion text not null,
  entidad text not null,
  entidad_id bigint not null,
  pago_id bigint,
  partida_id bigint,
  pedido_id bigint,
  uso_id bigint,
  movimiento_caja_id bigint,
  actor jsonb not null,
  antes jsonb,
  despues jsonb,
  creado_en timestamptz not null default clock_timestamp()
);
create index cobro_evento_pago on hermes.cobro_evento(pago_id,id desc) where pago_id is not null;
create index cobro_evento_partida on hermes.cobro_evento(partida_id,id desc) where partida_id is not null;
create index cobro_evento_pedido on hermes.cobro_evento(pedido_id,id desc) where pedido_id is not null;
create index cobro_evento_caja on hermes.cobro_evento(movimiento_caja_id,id desc) where movimiento_caja_id is not null;
create index cobro_evento_uso on hermes.cobro_evento(uso_id,id desc) where uso_id is not null;
alter table hermes.cobro_evento enable row level security;
create policy cobro_evento_solo_rpc on hermes.cobro_evento for all to authenticated using(false) with check(false);
revoke all on hermes.cobro_evento from public,anon,authenticated,service_role;
revoke all on sequence hermes.cobro_evento_id_seq from public,anon,authenticated,service_role;

create function hermes.cobro_actor(p_identificador text,p_congelado boolean default false)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
declare identificador text:=nullif(regexp_replace(btrim(p_identificador),'^pos:',''),''); perfil public.perfil%rowtype; n integer;
begin
  if identificador is not null then
    select * into perfil from public.perfil where id::text=identificador;
    if not found then
      select count(*) into n from public.perfil where lower(email)=lower(identificador);
      if n=1 then select * into perfil from public.perfil where lower(email)=lower(identificador); end if;
    end if;
  end if;
  return jsonb_build_object('id',perfil.id,'nombre',coalesce(nullif(perfil.nombre,''),identificador,'Usuario no registrado'),
    'rol',case when p_congelado then perfil.rol::text end,
    'rol_actual',case when not p_congelado then perfil.rol::text end,
    'historico',not p_congelado,'identificador',identificador);
end $$;
revoke all on function hermes.cobro_actor(text,boolean) from public,anon,authenticated,service_role;

create function hermes.cobro_actor_sesion() returns jsonb
language sql stable security definer set search_path=pg_catalog,public,hermes as $$
 select case when auth.uid() is null then
   jsonb_build_object('id',null,'nombre','Sistema / usuario no registrado','rol',null,'rol_actual',null,'historico',false,'identificador',null)
 else hermes.cobro_actor(auth.uid()::text,true) end;
$$;
revoke all on function hermes.cobro_actor_sesion() from public,anon,authenticated,service_role;

create function hermes.cobro_turno(p_sesion bigint,p_congelado boolean default false) returns jsonb
language sql stable security definer set search_path=pg_catalog,public,hermes as $$
 select jsonb_build_object('id',s.id,'caja',c.nombre,'caja_id',c.id,
   'responsable',hermes.cobro_actor(s.cajero_id::text,p_congelado))
 from public.sesion_caja s left join public.caja c on c.id=s.caja_id where s.id=p_sesion;
$$;
revoke all on function hermes.cobro_turno(bigint,boolean) from public,anon,authenticated,service_role;

create function hermes.cobro_evento_inmutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin raise exception 'El historial de cobros es inmutable' using errcode='42501'; end $$;
revoke all on function hermes.cobro_evento_inmutable() from public,anon,authenticated,service_role;
create trigger cobro_evento_inmutable before update or delete on hermes.cobro_evento for each row execute function hermes.cobro_evento_inmutable();
create trigger cobro_evento_no_truncar before truncate on hermes.cobro_evento for each statement execute function hermes.cobro_evento_inmutable();
insert into hermes.cobro_evento(accion,entidad,entidad_id,actor,despues)
values('TRAZA_HABILITADA','CONFIG',0,jsonb_build_object('nombre','Instalación del sistema','historico',false),jsonb_build_object('version',1));

-- Una fecha de saldado sólo se registra ante una transición financiera observada.
create function hermes.registrar_corte_cobro(p_partida bigint,p_pendiente_anterior numeric,p_revision_anterior numeric,p_activa_anterior boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare v record; saldada boolean; antes_saldada boolean;
begin
  select * into v from hermes.v_partida_estado where partida_id=p_partida;
  if not found or v.estado::text='ANULADA' then return; end if;
  saldada:=v.pendiente=0 and v.en_revision=0;
  antes_saldada:=p_activa_anterior and p_pendiente_anterior=0 and p_revision_anterior=0;
  if antes_saldada is null or saldada=antes_saldada then return; end if;
  insert into hermes.cobro_evento(accion,entidad,entidad_id,partida_id,pedido_id,actor,antes,despues)
  values(case when saldada then 'PARTIDA_SALDADA' else 'PARTIDA_REABIERTA' end,'PARTIDA',p_partida,p_partida,v.pedido_id,
    hermes.cobro_actor_sesion(),jsonb_build_object('pendiente',p_pendiente_anterior,'en_revision',p_revision_anterior),
    jsonb_build_object('pendiente',v.pendiente,'en_revision',v.en_revision,'total',v.total));
end $$;
revoke all on function hermes.registrar_corte_cobro(bigint,numeric,numeric,boolean) from public,anon,authenticated,service_role;

create function hermes.capturar_cobro_evento() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,hermes as $$
declare a jsonb; d jsonb; fila jsonb; pago bigint; partida bigint; pedido bigint; uso bigint; movimiento bigint;
  accion text; r record; monto_nuevo numeric; monto_viejo numeric; revisado_nuevo numeric; revisado_viejo numeric;
  viejo_pago hermes.pago%rowtype; nuevo_pago hermes.pago%rowtype;
begin
  if tg_op<>'INSERT' then a:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then d:=to_jsonb(new); end if;
  fila:=coalesce(d,a);
  if tg_table_name='movimiento_caja' then
    if d->'hermes_intencion' is null or d->'hermes_intencion'='null'::jsonb then return new; end if;
    movimiento:=(d->>'id')::bigint; pedido:=(d->>'pedido_id')::bigint;
    select id into pago from hermes.pago where idempotencia_clave='pos-pago-mov-'||movimiento;
    d:=jsonb_build_object('monto',d->'monto','medio',d->'metodo','referencia',d->'nota',
      'turno',hermes.cobro_turno((d->>'sesion_caja_id')::bigint,true));
    accion:='COBRO_REGISTRADO';
  elsif tg_table_name='pago' then
    pago:=(fila->>'id')::bigint;
    if tg_op='UPDATE' and (a->'estado',a->'monto',a->'medio',a->'referencia',a->'no_imputar',a->'confirmado_por',a->'confirmado_en',a->'motivo_rechazo',a->'devuelto_monto',a->'creado_por',a->'creado_en')
       is not distinct from (d->'estado',d->'monto',d->'medio',d->'referencia',d->'no_imputar',d->'confirmado_por',d->'confirmado_en',d->'motivo_rechazo',d->'devuelto_monto',d->'creado_por',d->'creado_en') then return new; end if;
    accion:=case when tg_op='INSERT' then 'PAGO_REGISTRADO' when a->>'estado' is distinct from d->>'estado' then 'PAGO_'||(d->>'estado') else 'PAGO_ACTUALIZADO' end;
    select m.id,m.pedido_id into movimiento,pedido from public.movimiento_caja m where fila->>'idempotencia_clave'='pos-pago-mov-'||m.id;
    a:=case when a is not null then jsonb_build_object('estado',a->'estado','monto',a->'monto','medio',a->'medio','referencia',a->'referencia','motivo',a->'motivo_rechazo','devuelto_monto',a->'devuelto_monto','creado_por',a->'creado_por','creado_en',a->'creado_en','confirmado_por',a->'confirmado_por','confirmado_en',a->'confirmado_en') end;
    d:=jsonb_build_object('estado',d->'estado','monto',d->'monto','medio',d->'medio','referencia',d->'referencia','motivo',d->'motivo_rechazo','devuelto_monto',d->'devuelto_monto','creado_por',d->'creado_por','creado_en',d->'creado_en','confirmado_por',d->'confirmado_por','confirmado_en',d->'confirmado_en');
  elsif tg_table_name='pago_aplicacion' then
    if tg_op='UPDATE' and (a->'pago_id',a->'partida_id',a->'monto') is not distinct from (d->'pago_id',d->'partida_id',d->'monto') then return new; end if;
    pago:=(fila->>'pago_id')::bigint; partida:=(fila->>'partida_id')::bigint;
    select pedido_id into pedido from hermes.partida_abierta where id=partida;
    accion:='APLICACION_'||case tg_op when 'INSERT' then 'CREADA' when 'DELETE' then 'RETIRADA' else 'MODIFICADA' end;
  elsif tg_table_name='saldo_uso_partida' then
    if tg_op='UPDATE' and a=d then return new; end if;
    uso:=(fila->>'uso_id')::bigint; partida:=(fila->>'partida_id')::bigint;
    select pedido_id into pedido from hermes.partida_abierta where id=partida;
    accion:='SALDO_APLICACION_'||case tg_op when 'INSERT' then 'CREADA' when 'DELETE' then 'RETIRADA' else 'MODIFICADA' end;
  elsif tg_table_name='saldo_cliente_uso' then
    if tg_op='UPDATE' and (a->'anulado_en',a->'monto') is not distinct from (d->'anulado_en',d->'monto') then return new; end if;
    if fila->>'pedido_id' is null then return new; end if;
    uso:=(fila->>'id')::bigint; pedido:=(fila->>'pedido_id')::bigint;
    accion:=case when d->>'anulado_en' is not null then 'SALDO_REVERTIDO' else 'SALDO_APLICADO' end;
    a:=case when a is not null then jsonb_build_object('monto',a->'monto','anulado_en',a->'anulado_en','motivo',a->'motivo_anulacion') end;
    d:=jsonb_build_object('monto',d->'monto','anulado_en',d->'anulado_en','motivo',d->'motivo_anulacion',
      'turno',hermes.cobro_turno((fila->>'sesion_caja_id')::bigint,true));
  else
    if tg_op='UPDATE' and (a->'estado',a->'total') is not distinct from (d->'estado',d->'total') then return new; end if;
    partida:=(fila->>'id')::bigint; pedido:=(fila->>'pedido_id')::bigint;
    accion:=case when tg_op='INSERT' then 'PARTIDA_CREADA' else 'PARTIDA_ACTUALIZADA' end;
    a:=case when a is not null then jsonb_build_object('total',a->'total','estado',a->'estado') end;
    d:=jsonb_build_object('total',d->'total','estado',d->'estado');
  end if;
  insert into hermes.cobro_evento(accion,entidad,entidad_id,pago_id,partida_id,pedido_id,uso_id,movimiento_caja_id,actor,antes,despues)
  values(accion,tg_table_name,coalesce((fila->>'id')::bigint,uso),pago,partida,pedido,uso,movimiento,hermes.cobro_actor_sesion(),a,d);
  if tg_table_name='pago_aplicacion' and tg_op='UPDATE'
    and (a->>'partida_id',a->>'pago_id') is distinct from (d->>'partida_id',d->>'pago_id') then
    insert into hermes.cobro_evento(accion,entidad,entidad_id,pago_id,partida_id,pedido_id,actor,antes,despues)
    select 'APLICACION_REASIGNADA_DESDE',tg_table_name,(fila->>'id')::bigint,(a->>'pago_id')::bigint,
      pa.id,pa.pedido_id,hermes.cobro_actor_sesion(),a,d from hermes.partida_abierta pa where pa.id=(a->>'partida_id')::bigint;
  end if;

  if tg_table_name='pago' and tg_op='UPDATE' and a->>'estado' is distinct from d->>'estado' then
    for r in select v.*,ap.monto monto_aplicado from hermes.v_partida_estado v join hermes.pago_aplicacion ap on ap.partida_id=v.partida_id where ap.pago_id=pago loop
      perform hermes.registrar_corte_cobro(r.partida_id,
        r.pendiente+r.monto_aplicado*((case when d->>'estado' in ('CONFIRMADO','ACREDITADO') then 1 else 0 end)-(case when a->>'estado' in ('CONFIRMADO','ACREDITADO') then 1 else 0 end)),
        r.en_revision-r.monto_aplicado*((case when d->>'estado'='PROPUESTO' then 1 else 0 end)-(case when a->>'estado'='PROPUESTO' then 1 else 0 end)),true);
    end loop;
  elsif tg_table_name='pago_aplicacion' then
    if tg_op<>'INSERT' then select * into viejo_pago from hermes.pago where id=(a->>'pago_id')::bigint; end if;
    if tg_op<>'DELETE' then select * into nuevo_pago from hermes.pago where id=(d->>'pago_id')::bigint; end if;
    for r in select * from hermes.v_partida_estado where partida_id in ((a->>'partida_id')::bigint,(d->>'partida_id')::bigint) loop
      monto_nuevo:=case when (d->>'partida_id')::bigint=r.partida_id and nuevo_pago.estado::text in ('CONFIRMADO','ACREDITADO') then (d->>'monto')::numeric else 0 end;
      monto_viejo:=case when (a->>'partida_id')::bigint=r.partida_id and viejo_pago.estado::text in ('CONFIRMADO','ACREDITADO') then (a->>'monto')::numeric else 0 end;
      revisado_nuevo:=case when (d->>'partida_id')::bigint=r.partida_id and nuevo_pago.estado::text='PROPUESTO' then (d->>'monto')::numeric else 0 end;
      revisado_viejo:=case when (a->>'partida_id')::bigint=r.partida_id and viejo_pago.estado::text='PROPUESTO' then (a->>'monto')::numeric else 0 end;
      perform hermes.registrar_corte_cobro(r.partida_id,r.pendiente+monto_nuevo-monto_viejo,r.en_revision-revisado_nuevo+revisado_viejo,true);
    end loop;
  elsif tg_table_name='saldo_uso_partida' then
    for r in select v.* from hermes.v_partida_estado v where partida_id in ((a->>'partida_id')::bigint,(d->>'partida_id')::bigint) loop
      monto_nuevo:=case when (d->>'partida_id')::bigint=r.partida_id and exists(select 1 from public.saldo_cliente_uso where id=(d->>'uso_id')::bigint and anulado_en is null) then (d->>'monto')::numeric else 0 end;
      monto_viejo:=case when (a->>'partida_id')::bigint=r.partida_id and exists(select 1 from public.saldo_cliente_uso where id=(a->>'uso_id')::bigint and anulado_en is null) then (a->>'monto')::numeric else 0 end;
      perform hermes.registrar_corte_cobro(r.partida_id,r.pendiente+monto_nuevo-monto_viejo,r.en_revision,true);
    end loop;
  elsif tg_table_name='saldo_cliente_uso' then
    for r in select v.*,su.monto monto_aplicado from hermes.v_partida_estado v join hermes.saldo_uso_partida su on su.partida_id=v.partida_id where su.uso_id=(fila->>'id')::bigint loop
      monto_nuevo:=case when tg_op<>'DELETE' and d->>'anulado_en' is null then r.monto_aplicado else 0 end;
      monto_viejo:=case when tg_op<>'INSERT' and a->>'anulado_en' is null then r.monto_aplicado else 0 end;
      perform hermes.registrar_corte_cobro(r.partida_id,r.pendiente+monto_nuevo-monto_viejo,r.en_revision,true);
    end loop;
  elsif tg_table_name='partida_abierta' and tg_op='UPDATE' then
    select * into r from hermes.v_partida_estado where partida_id=partida;
    perform hermes.registrar_corte_cobro(partida,r.pendiente-((d->>'total')::numeric-(a->>'total')::numeric),r.en_revision,a->>'estado'<>'ANULADA');
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function hermes.capturar_cobro_evento() from public,anon,authenticated,service_role;
create trigger zz_cobro_caja_traza after insert on public.movimiento_caja for each row execute function hermes.capturar_cobro_evento();
create trigger zz_cobro_pago_traza after insert or update on hermes.pago for each row execute function hermes.capturar_cobro_evento();
create trigger zz_cobro_aplicacion_traza after insert or update or delete on hermes.pago_aplicacion for each row execute function hermes.capturar_cobro_evento();
create trigger zz_cobro_saldo_partida_traza after insert or update or delete on hermes.saldo_uso_partida for each row execute function hermes.capturar_cobro_evento();
create trigger zz_cobro_saldo_traza after insert or update on public.saldo_cliente_uso for each row execute function hermes.capturar_cobro_evento();
create trigger zz_cobro_partida_traza after insert or update on hermes.partida_abierta for each row execute function hermes.capturar_cobro_evento();

create function hermes.detalle_cobro_interno(p_pedido bigint,p_partida bigint,p_antes bigint,p_limite integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
declare ids bigint[]; pagos_ids bigint[]; cliente bigint; pedido jsonb; partidas jsonb; pagos jsonb; saldos jsonb;
  resumen jsonb; eventos jsonb; total_eventos bigint; siguiente bigint; ultimo bigint;
begin
  if p_limite is null or p_limite<1 or p_limite>100 or (p_antes is not null and p_antes<=0) then raise exception 'Paginación inválida'; end if;
  if p_pedido is not null then
    select jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,'total',p.total),h.id into pedido,cliente
      from public.pedido p left join hermes.cliente h on h.pos_cliente_id=p.cliente_id where p.id=p_pedido;
    if pedido is null then raise exception 'Pedido inexistente'; end if;
    select coalesce(array_agg(id),'{}'::bigint[]) into ids from hermes.partida_abierta where pedido_id=p_pedido;
  else
    select cliente_id into cliente from hermes.partida_abierta where id=p_partida;
    if not found then raise exception 'Partida inexistente'; end if;
    ids:=array[p_partida];
  end if;
  select coalesce(array_agg(p.id order by p.id),'{}'::bigint[]) into pagos_ids from hermes.pago p where p.cliente_id=cliente and (
    exists(select 1 from hermes.pago_aplicacion a where a.pago_id=p.id and a.partida_id=any(ids))
    or exists(select 1 from public.movimiento_caja m where m.pedido_id=p_pedido and p.idempotencia_clave='pos-pago-mov-'||m.id)
    or exists(select 1 from hermes.movimiento_cuenta m where m.pago_id=p.id and m.partida_id=any(ids))
    or exists(select 1 from hermes.cobro_evento e where e.pago_id=p.id and (e.partida_id=any(ids) or e.pedido_id=p_pedido))
  );
  select jsonb_build_object(
    'vigentes',count(*) filter(where estado::text<>'ANULADA'),
    'saldadas',count(*) filter(where estado::text<>'ANULADA' and pendiente=0 and en_revision=0),
    'anuladas',count(*) filter(where estado::text='ANULADA')) into resumen
    from hermes.v_partida_estado where partida_id=any(ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',v.partida_id,'documento',v.documento_interno,'referencia',v.referencia,
    'estado',v.estado,'entrega_numero',pa.entrega_numero,'parent_id',pa.parent_partida_id,'total',v.total,'aplicado',v.imputado,
    'en_revision',v.en_revision,'pendiente',v.pendiente,
    'saldada',v.estado::text<>'ANULADA' and v.pendiente=0 and v.en_revision=0,
    'saldada_en',case when v.estado::text<>'ANULADA' and v.pendiente=0 and v.en_revision=0 and corte.accion='PARTIDA_SALDADA' then corte.creado_en end,
    'fecha_saldado_fuente',case when v.estado::text<>'ANULADA' and v.pendiente=0 and v.en_revision=0 and corte.accion='PARTIDA_SALDADA' then 'AUDITADA' else 'NO_REGISTRADA' end
    ) order by coalesce(pa.entrega_numero,1),v.partida_id),'[]'::jsonb) into partidas
    from hermes.v_partida_estado v join hermes.partida_abierta pa on pa.id=v.partida_id
    left join lateral(select accion,creado_en from hermes.cobro_evento where partida_id=v.partida_id and accion in ('PARTIDA_SALDADA','PARTIDA_REABIERTA') order by id desc limit 1) corte on true
    where v.partida_id=any(ids);

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'medio',p.medio,'monto',p.monto,'estado',p.estado,
    'fecha_recepcion',p.fecha_recepcion,'creado_en',coalesce(ec.creado_en,m.creado_en,ep.creado_en,p.creado_en),'referencia',p.referencia,
    'cobrado_por',case when m.id is not null then coalesce(ec.actor,hermes.cobro_actor(m.creado_por)) else coalesce(ep.actor,hermes.cobro_actor(p.creado_por)) end,
    'verificado_por',case when p.confirmado_por is not null then coalesce(ev.actor,hermes.cobro_actor(p.confirmado_por)) end,
    'verificado_en',coalesce(ev.creado_en,p.confirmado_en),'turno',coalesce(ec.despues->'turno',hermes.cobro_turno(m.sesion_caja_id)),
    'devuelto',coalesce((to_jsonb(p)->>'devuelto_monto')::numeric,0),
    'aplicado_pedido',(select coalesce(sum(a.monto),0) from hermes.pago_aplicacion a where a.pago_id=p.id and a.partida_id=any(ids)),
    'aplicaciones',(select coalesce(jsonb_agg(jsonb_build_object('partida_id',a.partida_id,'monto',a.monto) order by a.partida_id),'[]'::jsonb) from hermes.pago_aplicacion a where a.pago_id=p.id and a.partida_id=any(ids)),
    'sin_asignar',greatest(p.monto-coalesce((to_jsonb(p)->>'devuelto_monto')::numeric,0)-(select coalesce(sum(a.monto),0) from hermes.pago_aplicacion a where a.pago_id=p.id),0)
    ) order by coalesce(m.creado_en,p.creado_en),p.id),'[]'::jsonb) into pagos
    from hermes.pago p
    left join public.movimiento_caja m on p.idempotencia_clave='pos-pago-mov-'||m.id
    left join lateral(select actor,despues,creado_en from hermes.cobro_evento where movimiento_caja_id=m.id and accion='COBRO_REGISTRADO' order by id limit 1) ec on true
    left join lateral(select actor,creado_en from hermes.cobro_evento where pago_id=p.id and accion='PAGO_REGISTRADO' order by id limit 1) ep on true
    left join lateral(select actor,creado_en from hermes.cobro_evento where pago_id=p.id and accion in ('PAGO_CONFIRMADO','PAGO_ACREDITADO','PAGO_RECHAZADO','PAGO_ANULADO') order by id desc limit 1) ev on true
    where p.id=any(pagos_ids);

  select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'monto',u.monto,'creado_en',u.creado_en,'anulado_en',u.anulado_en,
    'motivo',u.motivo_anulacion,'aplicado_por',coalesce(e.actor,hermes.cobro_actor(coalesce(u.creado_por_id::text,u.creado_por))),
    'turno',coalesce(e.despues->'turno',hermes.cobro_turno(u.sesion_caja_id)),
    'aplicaciones',(select coalesce(jsonb_agg(jsonb_build_object('partida_id',a.partida_id,'monto',a.monto) order by a.partida_id),'[]'::jsonb) from hermes.saldo_uso_partida a where a.uso_id=u.id and a.partida_id=any(ids))
    ) order by u.creado_en,u.id),'[]'::jsonb) into saldos
    from public.saldo_cliente_uso u left join lateral(select actor,despues from hermes.cobro_evento where uso_id=u.id and accion='SALDO_APLICADO' order by id limit 1) e on true
    where u.pedido_id=p_pedido or exists(select 1 from hermes.saldo_uso_partida a where a.uso_id=u.id and a.partida_id=any(ids));

  select count(*) into total_eventos from hermes.cobro_evento e where e.pedido_id=p_pedido or e.partida_id=any(ids) or e.pago_id=any(pagos_ids);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb),min(e.id) into eventos,ultimo from (
    select id,accion,creado_en,actor,pago_id,partida_id,uso_id,antes,despues from hermes.cobro_evento
    where (pedido_id=p_pedido or partida_id=any(ids) or pago_id=any(pagos_ids)) and (p_antes is null or id<p_antes)
    order by id desc limit p_limite
  ) e;
  if exists(select 1 from hermes.cobro_evento where id<ultimo and (pedido_id=p_pedido or partida_id=any(ids) or pago_id=any(pagos_ids))) then siguiente:=ultimo; end if;
  return jsonb_build_object('pedido',pedido,'partida_enfocada',p_partida,'resumen',resumen,'partidas',partidas,'pagos',pagos,'saldos',saldos,
    'historial',eventos,'historial_total',total_eventos,'siguiente',siguiente,
    'captura_desde',(select min(creado_en) from hermes.cobro_evento where accion='TRAZA_HABILITADA'));
end $$;
revoke all on function hermes.detalle_cobro_interno(bigint,bigint,bigint,integer) from public,anon,authenticated,service_role;

create function public.consultar_detalle_cobro_pedido(p_pedido_id bigint,p_antes_id bigint default null,p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
begin
  if auth.uid() is null or not exists(select 1 from public.perfil where id=auth.uid() and activo and rol::text in ('admin','gerente','cajero','vendedor','vendedor_mayoreo')) then
    raise exception 'No autorizado para consultar cobros' using errcode='42501'; end if;
  if p_pedido_id is null or p_pedido_id<=0 then raise exception 'Pedido inválido'; end if;
  return hermes.detalle_cobro_interno(p_pedido_id,null,p_antes_id,p_limite);
end $$;
revoke all on function public.consultar_detalle_cobro_pedido(bigint,bigint,integer) from public,anon,service_role;
grant execute on function public.consultar_detalle_cobro_pedido(bigint,bigint,integer) to authenticated;

create function hermes.obtener_detalle_cobro_partida(p_partida_id bigint,p_antes_id bigint default null,p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,hermes as $$
declare pedido bigint;
begin
  if auth.uid() is null or hermes.rol_actual() is null
    or not exists(select 1 from public.perfil where id=auth.uid() and activo and hermes_acceso) then
    raise exception 'Acceso a Hermes requerido' using errcode='42501'; end if;
  select pedido_id into pedido from hermes.partida_abierta where id=p_partida_id;
  if not found then raise exception 'Partida inexistente'; end if;
  return hermes.detalle_cobro_interno(pedido,p_partida_id,p_antes_id,p_limite);
end $$;
revoke all on function hermes.obtener_detalle_cobro_partida(bigint,bigint,integer) from public,anon,service_role;
grant execute on function hermes.obtener_detalle_cobro_partida(bigint,bigint,integer) to authenticated;

-- Ampliación compatible: contador de partidas saldadas en la lista de Seller.
-- Consulta de sólo lectura. No confirma pagos ni modifica pedidos o saldos.
create or replace function public.consultar_cobros_pedidos(p_pedido_ids bigint[])
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, hermes as $$
declare resultado jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.perfil where id = auth.uid() and activo
      and rol::text in ('admin','gerente','cajero','vendedor','vendedor_mayoreo')
  ) then
    raise exception 'No autorizado para consultar cobros' using errcode = '42501';
  end if;
  if p_pedido_ids is null or cardinality(p_pedido_ids) < 1 or cardinality(p_pedido_ids) > 200
    or exists (select 1 from unnest(p_pedido_ids) id where id is null or id <= 0) then
    raise exception 'Pedidos inválidos';
  end if;

  with pedidos as (
    select p.id, p.estado, p.categoria, p.cliente_id, p.total pedido_total from public.pedido p where p.id = any(p_pedido_ids)
  ), resumen as (
    select p.id, p.estado, p.categoria, p.pedido_total,
      count(ve.partida_id) filter (where ve.estado::text <> 'ANULADA') as partidas,
      count(ve.partida_id) filter (where ve.estado::text <> 'ANULADA' and ve.pendiente=0 and ve.en_revision=0) as partidas_saldadas,
      coalesce(sum(ve.total) filter (where ve.estado::text <> 'ANULADA'), 0) as total,
      coalesce(sum(greatest(ve.imputado, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as aplicado,
      coalesce(sum(greatest(ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as en_revision,
      -- Sumar pendientes por partida: el excedente de una no paga automáticamente otra.
      coalesce(sum(greatest(ve.pendiente, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as pendiente,
      coalesce(sum(greatest(ve.pendiente - ve.en_revision, 0)) filter (where ve.estado::text <> 'ANULADA'), 0) as por_cobrar,
      coalesce(bool_or(ve.pendiente < 0 or ve.en_revision > greatest(ve.pendiente, 0)
        or ve.total is null or ve.pendiente is null or hc.pos_cliente_id is distinct from p.cliente_id)
        filter (where ve.estado::text <> 'ANULADA'), false) as inconsistente
    from pedidos p left join hermes.v_partida_estado ve on ve.pedido_id = p.id
      left join hermes.cliente hc on hc.id = ve.cliente_id
    group by p.id, p.estado, p.categoria, p.pedido_total
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pedido_id', id, 'partidas', partidas, 'partidas_saldadas', partidas_saldadas, 'total', total, 'aplicado', aplicado,
    'en_revision', en_revision, 'pendiente', pendiente, 'por_cobrar', por_cobrar,
    'estado', case
      when categoria::text = 'TIENDA' then 'no_aplica'
      when estado::text = 'CANCELADO' and partidas > 0 then 'revisar'
      when estado::text = 'CANCELADO' then 'cancelado'
      when partidas = 0 then 'sin_partida'
      when pedido_total is null or total <> pedido_total then 'revisar'
      when inconsistente then 'revisar'
      when en_revision > 0 then 'por_verificar'
      when pendiente = 0 and total = 0 then 'sin_pendiente'
      when pendiente = 0 then 'pagado'
      when aplicado > 0 then 'parcial'
      else 'pendiente'
    end
  ) order by id), '[]'::jsonb) into resultado from resumen;
  return resultado;
end $$;
revoke all on function public.consultar_cobros_pedidos(bigint[]) from public, anon, service_role;
grant execute on function public.consultar_cobros_pedidos(bigint[]) to authenticated;
comment on function public.consultar_cobros_pedidos(bigint[]) is
  'Lectura de cobros para Seller: partidas vigentes, confirmados y propuestas separados; no usa el saldo global del cliente.';
