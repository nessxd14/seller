import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

export async function testComisionesCobro(db, claims) {
 const admin='00000000-0000-0000-0000-000000000001', caja='00000000-0000-0000-0000-000000000002', gerente='00000000-0000-0000-0000-000000000004'
 await claims(admin)
 // Esquema histórico de comisiones omitido del fixture financiero original.
 const fase1=await fs.readFile(new URL('../../db/migrations/2026-09-12_comisiones.sql',import.meta.url),'utf8')
 await db.exec(fase1.slice(fase1.indexOf('create table comision_regla'),fase1.indexOf('-- creado_por quedó')))
 const fase2=await fs.readFile(new URL('../../db/migrations/2026-09-17_comisiones_fase2.sql',import.meta.url),'utf8')
 await db.exec(fase2.slice(fase2.indexOf('create table comision_liquidacion'),fase2.indexOf('-- FK que quedó')))
 await db.exec(`alter table public.comision_devengo add column tiene_personalizado_comisionable boolean not null default false;
 create or replace function public.comision_es_gerente() returns boolean language sql stable security definer as $$select exists(select 1 from public.perfil where id=auth.uid() and activo and rol='gerente')$$;
 create or replace function public.comision_puede_ver(p_vendedor_email text) returns boolean language sql stable security definer as $$select public.comision_es_gerente() or p_vendedor_email=(select email from public.perfil where id=auth.uid() and activo)$$;`)
 await db.query("insert into public.perfil(id,nombre,rol,activo,hermes_acceso,email) values($1,'Gerente de prueba','gerente',true,true,'gerente@test.invalid')",[gerente])
 const control=async()=>(await db.query('select count(*) n,sum(monto) monto from hermes.movimiento_cuenta')).rows
 const antes=await control()
 await db.exec(await fs.readFile(new URL('../migrations/20261018000738_comisiones_cobro_consistente.sql',import.meta.url),'utf8'))
 assert.deepEqual(await control(),antes,'Actualizar comisiones no modifica la cartera')
 await db.exec("update public.sesion_caja set estado='ABIERTA' where id=900001")
 const create=async id=>{
  await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero,creado_por) values($1,'MAYOR',900001,100,100,$2,'vendedor@test.invalid')",[id,`COM-${id}`])
  await db.query("insert into public.pedido_linea(pedido_id,estado,cantidad_base,cantidad_despachada,precio_unitario,subtotal) values($1,'POR_DESPACHAR',10,0,10,100)",[id])
  const partida=(await db.query('select id from hermes.partida_abierta where pedido_id=$1',[id])).rows[0].id
  await db.query("insert into public.comision_devengo(origen,pedido_id,vendedor_email,documento_fecha,base_comisionable,total_documento,porcentaje,monto) values('PEDIDO',$1,'vendedor@test.invalid',current_date,100,100,0.01,1)",[id])
  return partida
 }
 const dev=async id=>(await db.query('select * from public.comision_devengo where pedido_id=$1',[id])).rows[0]
 const estado=async id=>(await db.query('select public.consultar_cobros_pedidos(array[$1]::bigint[]) r',[id])).rows[0].r[0]
 const pagar=async(id,monto=100)=>{
  await claims(caja)
  const r=(await db.query("select public.registrar_cobro_cation(p_pedido_id=>$1,p_cliente_id=>900001,p_monto=>$2,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>$3) r",[id,monto,`com-pago-${id}`])).rows[0].r
  await claims(gerente)
  return r
 }
 const liquidar=async id=>(await db.query("select public.comision_crear_liquidacion('vendedor@test.invalid',array[$1]::bigint[],'EFECTIVO','Prueba') id",[(await dev(id)).id])).rows[0].id
 const pa=await create(886001)
 assert.equal((await dev(886001)).estado,'POTENCIAL')
 const pago=await pagar(886001)
 assert.equal((await dev(886001)).cobro_estado,'por_verificar')
 await assert.rejects(()=>liquidar(886001),/cambió|condiciones/)
 await db.query("select hermes.confirmar_pago($1,'Autor enviado incorrecto')",[pago.pagoId])
 let d=await dev(886001)
 assert.equal(d.estado,'DEVENGADA')
 assert.equal(d.cobro_estado,(await estado(886001)).estado)
 assert.equal(d.partidas_saldadas,1)
 assert.equal(d.vendedor_email,'vendedor@test.invalid','El cobrador o verificador no se convierte en vendedor')
 const lote=await liquidar(886001)
 await assert.rejects(()=>liquidar(886001),/ya fue liquidada/)
 await db.query('delete from hermes.pago_aplicacion where pago_id=$1 and partida_id=$2',[pago.pagoId,pa])
 d=await dev(886001)
 assert.equal(d.estado,'LIQUIDADA','Una deuda reabierta no borra dinero ya liquidado')
 assert.match(d.revision_motivo,/ya liquidada/)
 await assert.rejects(()=>db.query("select public.comision_anular_liquidacion($1,' ')",[lote]),/motivo/)
 await db.query("select public.comision_anular_liquidacion($1,'Pago retirado de la partida')",[lote])
 assert.equal((await dev(886001)).estado,'POTENCIAL','Anular el lote reevalúa la deuda actual')
 await db.query('insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values($1,$2,100)',[pago.pagoId,pa])
 assert.equal((await dev(886001)).estado,'DEVENGADA')
 const historial=(await db.query('select public.comision_historial($1) r',[(await dev(886001)).id])).rows[0].r
 assert(historial.some(e=>e.despues.estado==='LIQUIDADA'&&e.actor.id===gerente))
 assert(historial.some(e=>e.despues.revision_motivo))
 await assert.rejects(()=>db.query("update hermes.comision_evento set actor='{}'"),/inmutable/)
 await claims(caja)
 await assert.rejects(()=>liquidar(886001),/Solo el gerente/)
 await claims(gerente)
 await create(886002)
 await db.query("select public.aplicar_saldo_pedido(886002,100,900001,'com-saldo-886002')")
 assert.equal((await dev(886002)).estado,'DEVENGADA','El saldo a favor aplicado cuenta igual que en Seller')
 assert.equal((await dev(886002)).cobro_estado,(await estado(886002)).estado)
 const root=await create(886003)
 const pagado=await pagar(886003)
 await db.query("select hermes.confirmar_pago($1,'Prueba')",[pagado.pagoId])
 const hija=(await db.query("insert into hermes.partida_abierta(cliente_id,cliente_nombre,cliente_categoria,documento_interno,inicio_computo,pedido_id,total,estado,creado_por,parent_partida_id,partida_raiz_id,entrega_numero) select cliente_id,cliente_nombre,cliente_categoria,'COM-HIJA',inicio_computo,pedido_id,25,'ABIERTA','Prueba',id,id,2 from hermes.partida_abierta where id=$1 returning id",[root])).rows[0].id
 await db.query('update public.pedido set total=125,subtotal=125 where id=886003')
 d=await dev(886003)
 assert.equal(d.estado,'POTENCIAL')
 assert.equal(d.partidas_saldadas,1); assert.equal(d.partidas_vigentes,2)
 assert.match(d.revision_motivo,/importe del pedido cambió/)
 await assert.rejects(()=>db.query("select public.comision_revisar_base($1,124,125,1.25,'Revisado')",[d.id]),/pedido cambió/)
 await assert.rejects(()=>db.query("select public.comision_revisar_base($1,125,125,1.25,' ')",[d.id]),/motivo/)
 await db.query("select public.comision_revisar_base($1,125,125,1.25,'Partida hija incorporada al pedido')",[d.id])
 assert.equal(Number((await dev(886003)).monto),1.25)
 assert((await db.query('select public.comision_historial($1) r',[d.id])).rows[0].r.some(e=>e.despues.motivo_revision_base))
 const nuevo=(await db.query("insert into hermes.pago(cliente_id,medio,monto,estado,fecha_recepcion,creado_por,idempotencia_clave,confirmado_por,confirmado_en) values(900001,'EFECTIVO',25,'CONFIRMADO',now(),'Prueba','com-hija-pago','Prueba',now()) returning id")).rows[0].id
 await db.query('insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values($1,$2,25)',[nuevo,hija])
 assert.equal((await dev(886003)).estado,'DEVENGADA')
 // Reasignar el reparto debe retirar la elegibilidad del pedido de origen.
 const destino=await create(886004)
 await db.query('update hermes.pago_aplicacion set partida_id=$1 where pago_id=$2 and partida_id=$3',[destino,pagado.pagoId,root])
 assert.equal((await dev(886003)).estado,'POTENCIAL')
 assert.equal((await dev(886004)).estado,'DEVENGADA')
 // Cancelación resuelta con dinero: las tres opciones conservan el pago original.
 for(const [id,opcion] of [[886010,'SALDO_FAVOR'],[886011,'REASIGNACION'],[886012,'DEVOLUCION']]) {
  await create(id); const cobro=await pagar(id); await db.query("select hermes.confirmar_pago($1,'Prueba')",[cobro.pagoId])
  let target=null
  if(opcion==='REASIGNACION') target=await create(886013)
  const version=(await db.query('select hermes.version_resolucion($1) v',[id])).rows[0].v
  await db.query("select hermes.resolver_incidencia_pedido($1,'CANCELACION_RESUELTA',$2,'Cliente canceló',$3,$4,'[]',$5,$6,$7,$8,true,$9)",[id,opcion,version,`com-resolver-${id}`,target,opcion==='DEVOLUCION'?900001:null,opcion==='DEVOLUCION'?'EFECTIVO':null,opcion==='DEVOLUCION'?'Recibo de prueba':null,opcion==='DEVOLUCION'])
  assert.equal((await dev(id)).estado,'ANULADA')
  assert.equal((await estado(id)).estado,'cancelado')
  assert.equal(Number((await db.query('select monto from hermes.pago where id=$1',[cobro.pagoId])).rows[0].monto),100)
 }
 for(const f of ['hermes.resumen_cobro_pedidos(bigint[])','hermes.sincronizar_comision_pedido(bigint)','hermes.actualizar_comision_desde_cobro()'])
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') permitido",[f])).rows[0].permitido,false)
 assert.equal((await db.query("select has_function_privilege('anon','public.comision_historial(bigint,bigint)','EXECUTE') permitido")).rows[0].permitido,false)
 // Pedido cobrado por la operación nativa, con libro coherente, para las carreras reales.
 await create(886020)
 const concurrente=await pagar(886020)
 await db.query("select hermes.confirmar_pago($1,'Prueba de concurrencia')",[concurrente.pagoId])
 assert.equal((await dev(886020)).estado,'DEVENGADA')
 console.log('OK: comisión y Seller comparten cobro; saldo a favor, hijas, reasignación, tres resoluciones, liquidación única, reapertura, motivo, identidad y auditoría')
}
