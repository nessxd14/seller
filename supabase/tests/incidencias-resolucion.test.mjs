import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const admin='00000000-0000-0000-0000-000000000001'
const caja='00000000-0000-0000-0000-000000000002'
const create = async (db,id,total=100) => {
 await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values($1,'MAYOR',900001,$2,$2,$3)",[id,total,`INC-${id}`])
 await db.query("insert into public.pedido_linea(pedido_id,estado,cantidad_base,cantidad_despachada,precio_unitario,subtotal) values($1,'POR_DESPACHAR',10,0,$2,$3)",[id,total/10,total])
 return (await db.query('select id from hermes.partida_abierta where pedido_id=$1',[id])).rows[0].id
}
const pay = async (db,id,monto,confirm=true) => {
 const r=(await db.query("select public.registrar_cobro_hermes(p_pedido_id=>$1,p_cliente_id=>900001,p_monto=>$2,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>$3) r",[id,monto,`inc-pay-${id}`])).rows[0].r
 if(confirm) await db.query("select hermes.confirmar_pago($1,'Prueba')",[r.pagoId])
 return r.pagoId
}
// Se crean con las reglas anteriores para reproducir el legado, antes de las bajas auditadas.
export async function prepararIncidenciasHistoricas(db,claims) {
 await claims(admin)
 await db.exec("update public.sesion_caja set estado='ABIERTA' where id=900001")
 for(const [id,confirmed] of [[881001,true],[881002,false],[881003,true]]) {
  await create(db,id)
  await pay(db,id,100,confirmed)
  await db.query("update public.pedido set estado='CANCELADO' where id=$1",[id])
 }
}

export async function testIncidenciasResolucion(db,claims) {
 await claims(admin)
 await db.exec(`alter table public.pedido_linea add column if not exists cantidad_presentacion numeric;
 alter table public.pedido_linea add column if not exists nota text;
 alter table public.pedido_linea add column if not exists descripcion text;`)
 const before=(await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0]
 await db.exec(await fs.readFile(new URL('../migrations/20261013210748_hermes_incidencias_resolucion.sql',import.meta.url),'utf8'))
 assert.deepEqual((await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0],before)
 const version = async id => (await db.query('select hermes.version_resolucion($1) v',[id])).rows[0].v
 const request = async (id,opcion='SALDO_FAVOR',extra={}) => ({id,opcion,version:await version(id),clave:`incidencia-${id}-${opcion}`,tipo:'CANCELACION_RESUELTA',lineas:[],destino:null,turno:null,medio:null,ref:null,recepcion:false,devuelto:false,...extra})
 const resolve = r => db.query("select hermes.resolver_incidencia_pedido($1,$2,$3,'Solicitud del cliente',$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) r",
  [r.id,r.tipo,r.opcion,r.version,r.clave,JSON.stringify(r.lineas),r.destino,r.turno,r.medio,r.ref,r.recepcion,r.devuelto])
 const saldo = async () => Number((await db.query('select sum(monto) s from hermes.movimiento_cuenta where cliente_id=(select id from hermes.cliente where pos_cliente_id=900001)')).rows[0].s)
 const getPa = async id => (await db.query('select id,total,estado from hermes.partida_abierta where pedido_id=$1',[id])).rows[0]

 const listed=(await db.query("select hermes.obtener_incidencias('',0,2,true) r")).rows[0].r
 assert.equal(listed.items.length,2); assert(listed.total>=3)
 const detail=(await db.query('select hermes.obtener_resolucion_pedido(881001) r')).rows[0].r
 assert.equal(detail.pedido.id,881001); assert.equal(detail.pagos.length,1); assert.equal(detail.puede_resolver,true)

 const first=await request(881001)
 const originalPay=(await db.query("select id from hermes.pago where idempotencia_clave=(select 'pos-pago-mov-'||id from public.movimiento_caja where pedido_id=881001 and tipo='ANTICIPO')")).rows[0].id
 const oldSaldo=await saldo()
 const result=(await resolve(first)).rows[0].r
 assert.equal(result.dinero_resuelto,'100.00')
 assert.equal((await getPa(881001)).estado,'ANULADA')
 assert.equal(await saldo(),oldSaldo-100)
 assert.equal((await db.query('select saldo_favor from hermes.v_anticipo_cliente where pago_id=$1',[originalPay])).rows[0].saldo_favor,'100.00')
 assert((await db.query('select hermes.obtener_historial_partida($1) r',[(await getPa(881001)).id])).rows[0].r.eventos.some(e=>e.accion==='CANCELACION_RESUELTA'))
 assert.equal((await db.query('select count(*)::int n from hermes.pago_aplicacion where pago_id=$1',[originalPay])).rows[0].n,0)
 const once=(await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0]
 assert.deepEqual((await resolve(first)).rows[0].r,result)
 assert.deepEqual((await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0],once)
 await assert.rejects(()=>resolve({...first,opcion:'DEVOLUCION'}),/otra resolución/)

 const target=await create(db,881010)
 const proposed=await request(881002,'REASIGNACION',{destino:target})
 await assert.rejects(()=>resolve(proposed),/recepción/)
 const reassigned=(await resolve({...proposed,recepcion:true})).rows[0].r
 assert.equal(reassigned.dinero_resuelto,'100.00')
 assert.equal((await getPa(881002)).estado,'ANULADA')
 assert.equal((await getPa(881010)).estado,'PAGADA')
 const proposalPay=(await db.query('select pago_id from hermes.resolucion_pago where operacion_id=$1',[reassigned.operacion_id])).rows[0].pago_id
 assert.equal((await db.query('select estado from hermes.pago where id=$1',[proposalPay])).rows[0].estado,'CONFIRMADO')
 assert.equal((await db.query('select monto from hermes.pago_aplicacion where pago_id=$1 and partida_id=$2',[proposalPay,target])).rows[0].monto,'100.00')

 const refund=await request(881003,'DEVOLUCION',{turno:900001,medio:'EFECTIVO',ref:'Recibo de devolución',devuelto:true})
 await assert.rejects(()=>resolve({...refund,devuelto:false}),/confirmación/)
 await db.query("update public.sesion_caja set estado='CERRADA' where id=900001")
 await assert.rejects(()=>resolve(refund),/abierto/)
 assert.equal((await getPa(881003)).estado,'PAGADA')
 await db.query("update public.sesion_caja set estado='ABIERTA' where id=900001")
 const cashBefore=(await db.query("select count(*)::int n from public.movimiento_caja where tipo='ANULACION'")).rows[0].n
 const moneyBefore=await saldo()
 const fundsBefore=Number((await db.query('select coalesce(sum(disponible),0) n from hermes.fuentes_saldo_disponible((select id from hermes.cliente where pos_cliente_id=900001))')).rows[0].n)
 const returned=(await resolve(refund)).rows[0].r
 assert.equal(await saldo(),moneyBefore)
 assert.equal((await db.query("select count(*)::int n from public.movimiento_caja where tipo='ANULACION'")).rows[0].n,cashBefore+1)
 const refundedPay=(await db.query('select pago_id from hermes.resolucion_pago where operacion_id=$1',[returned.operacion_id])).rows[0].pago_id
 assert.deepEqual((await db.query('select monto,devuelto_monto,estado from hermes.pago where id=$1',[refundedPay])).rows[0],{monto:'100.00',devuelto_monto:'100.00',estado:'CONFIRMADO'})
 assert.equal(Number((await db.query('select coalesce(sum(disponible),0) n from hermes.fuentes_saldo_disponible((select id from hermes.cliente where pos_cliente_id=900001))')).rows[0].n),fundsBefore,'La devolución no consume crédito dos veces')
 await resolve(refund)
 assert.equal((await db.query("select count(*)::int n from public.movimiento_caja where tipo='ANULACION'")).rows[0].n,cashBefore+1)

 const part=await create(db,881020)
 const partialPay=await pay(db,881020,100)
 const line=(await db.query('select id from public.pedido_linea where pedido_id=881020')).rows[0].id
 await db.query('update public.pedido_linea set cantidad_despachada=4 where id=$1',[line])
 const partial=await request(881020,'SALDO_FAVOR',{tipo:'REMANENTE_CANCELADO',lineas:[{linea_id:line,cantidad:6}]})
 await assert.rejects(()=>resolve({...partial,tipo:'CANCELACION_RESUELTA'}),/entrega/)
 const s=await saldo()
 const reduced=(await resolve(partial)).rows[0].r
 assert.equal(reduced.reduccion,'60.00')
 assert.equal(reduced.dinero_resuelto,'60.00')
 assert.equal((await getPa(881020)).total,'40.00')
 assert.equal((await db.query('select cantidad_base,subtotal,estado from public.pedido_linea where id=$1',[line])).rows[0].cantidad_base,'4')
 assert.equal((await db.query('select monto from hermes.pago_aplicacion where partida_id=$1 and pago_id=$2',[part,partialPay])).rows[0].monto,'40.00')
 assert.equal(await saldo(),s-60)
 assert.equal((await db.query('select saldo_favor from hermes.v_anticipo_cliente where pago_id=$1',[partialPay])).rows[0].saldo_favor,'60.00')
 assert.equal((await db.query("select count(*)::int n from hermes.fuentes_saldo_disponible((select id from hermes.cliente where pos_cliente_id=900001)) f join hermes.movimiento_cuenta m on m.id=f.movimiento_id where m.idempotencia_clave like 'resolucion-%-reduccion-%'")).rows[0].n,0,'La reducción de deuda no duplica el saldo disponible')
 assert.deepEqual((await resolve(partial)).rows[0].r,reduced)

 // El descuento se reparte proporcionalmente; lo entregado conserva su importe.
 const root=await create(db,881040)
 await db.exec("update public.perfil set rol='gerente' where id='00000000-0000-0000-0000-000000000001'")
 const child=(await db.query("select hermes.partir_partida($1,40,'Prueba') id",[root])).rows[0].id
 await db.exec("update public.perfil set rol='admin' where id='00000000-0000-0000-0000-000000000001'")
 await db.query('update hermes.partida_abierta set fecha_entrega=current_date where id=$1',[root])
 const splitLine=(await db.query('select id from public.pedido_linea where pedido_id=881040')).rows[0].id
 await db.query('update public.pedido_linea set cantidad_despachada=6 where id=$1',[splitLine])
 const split=await request(881040,'SALDO_FAVOR',{tipo:'REMANENTE_CANCELADO',lineas:[{linea_id:splitLine,cantidad:3}]})
 await resolve(split)
 assert.equal((await db.query('select total from hermes.partida_abierta where id=$1',[root])).rows[0].total,'60.00')
 assert.equal((await db.query('select total from hermes.partida_abierta where id=$1',[child])).rows[0].total,'10.00')
 assert.equal((await db.query('select sum(total) t from hermes.partida_abierta where pedido_id=881040')).rows[0].t,'70.00')

 await create(db,881041,90)
 await db.query('update public.pedido set subtotal=100,descuento_general=10 where id=881041')
 await db.query('update public.pedido_linea set subtotal=100,precio_unitario=10 where pedido_id=881041')
 const discountLine=(await db.query('select id from public.pedido_linea where pedido_id=881041')).rows[0].id
 await resolve(await request(881041,'SALDO_FAVOR',{tipo:'REMANENTE_CANCELADO',lineas:[{linea_id:discountLine,cantidad:3}]}))
 assert.deepEqual((await db.query('select total,subtotal,descuento_general from public.pedido where id=881041')).rows[0],{total:'63.00',subtotal:'70.00',descuento_general:'7.00'})

 const partialRefundPart=await create(db,881042)
 const partialRefundPay=await pay(db,881042,100)
 const partialRefundLine=(await db.query('select id from public.pedido_linea where pedido_id=881042')).rows[0].id
 const partialRefund=await request(881042,'DEVOLUCION',{tipo:'REMANENTE_CANCELADO',lineas:[{linea_id:partialRefundLine,cantidad:3}],turno:900001,medio:'EFECTIVO',ref:'Devolución parcial',devuelto:true})
 await resolve(partialRefund)
 assert.equal((await db.query('select devuelto_monto from hermes.pago where id=$1',[partialRefundPay])).rows[0].devuelto_monto,'30.00')
 assert.equal((await db.query('select monto from hermes.pago_aplicacion where pago_id=$1 and partida_id=$2',[partialRefundPay,partialRefundPart])).rows[0].monto,'70.00')
 assert.equal((await db.query('select count(*)::int n from hermes.v_anticipo_cliente where pago_id=$1',[partialRefundPay])).rows[0].n,0)

 // Caja sin fondos, entrega contra cantidades y factura: todo queda igual al fallar.
 await create(db,881043);await pay(db,881043,100)
 await db.query("insert into public.sesion_caja(id,caja_id,estado,monto_apertura,cajero_id) values(881099,1,'ABIERTA',0,$1)",[admin])
 await assert.rejects(()=>resolve({...refund,id:881043,version:null,clave:'inc-sin-version'}),/información cambió/)
 const noCash=await request(881043,'DEVOLUCION',{turno:881099,medio:'EFECTIVO',ref:'Recibo',devuelto:true})
 await assert.rejects(()=>resolve(noCash),/efectivo suficiente/)
 assert.equal((await getPa(881043)).estado,'PAGADA')
 const invalidQty=await request(881020,'SALDO_FAVOR',{tipo:'REMANENTE_CANCELADO',lineas:[{linea_id:line,cantidad:1}],clave:'inc-cantidad-entregada'})
 await assert.rejects(()=>resolve(invalidQty),/Cantidad no cancelable/)
 await create(db,881044)
 await db.query('update hermes.partida_abierta set fecha_factura=current_date where pedido_id=881044')
 const invoiced=await request(881044)
 await assert.rejects(()=>resolve(invoiced),/factura/)
 const salePart=await create(db,881046)
 const activeSale=(await db.query("select id from public.venta where estado<>'ANULADA' order by id limit 1")).rows[0].id
 await db.query('update hermes.partida_abierta set venta_id=$1 where id=$2',[activeSale,salePart])
 const linkedSale=await request(881046)
 await assert.rejects(()=>resolve(linkedSale),/venta vigente/)

 await create(db,881045)
 const net=await saldo()
 await db.query("insert into hermes.movimiento_cuenta(cliente_id,tipo,monto,idempotencia_clave,fecha_efectiva,creado_por) values((select id from hermes.cliente where pos_cliente_id=900001),'SALDO_APERTURA',$1,'inc-saldo-restauracion',current_date,'Prueba')",[-Math.max(net,0)-200])
 await db.query("select public.aplicar_saldo_pedido(881045,100,900001,'inc-uso-saldo')")
 const wallet=await request(881045)
 const walletDetail=(await db.query('select hermes.obtener_resolucion_pedido(881045) r')).rows[0].r
 assert.equal(walletDetail.saldo_aplicado,'100.00')
 await assert.rejects(()=>resolve({...wallet,opcion:'DEVOLUCION'}),/restaura el saldo/)
 const restored=(await resolve(wallet)).rows[0].r
 assert.equal(restored.saldo_restaurado,'100.00');assert.equal(restored.dinero_resuelto,'100.00')
 assert.equal((await getPa(881045)).estado,'ANULADA')

 await create(db,881030)
 const insufficientTarget=await create(db,881031,10)
 await pay(db,881030,100)
 const badDestination=await request(881030,'REASIGNACION',{destino:insufficientTarget})
 const beforeFailure=(await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0]
 await assert.rejects(()=>resolve(badDestination),/supera/)
 assert.deepEqual((await db.query('select count(*)::int n,sum(monto) total from hermes.movimiento_cuenta')).rows[0],beforeFailure)
 assert.equal((await db.query('select estado from public.pedido where id=881030')).rows[0].estado,'ABIERTO')
 await db.query('update public.pedido set referencia=$1 where id=881030',['Cambio concurrente'])
 await assert.rejects(()=>resolve(badDestination),/información cambió/)
 await claims(caja)
 const latestVersion=await version(881030)
 await assert.rejects(()=>resolve({...badDestination,version:latestVersion}),/administrador/)
 await claims(admin)
 assert.equal((await db.query("select has_function_privilege('anon','hermes.resolver_incidencia_pedido(bigint,text,text,text,text,text,jsonb,bigint,bigint,text,text,boolean,boolean)','execute') ok")).rows[0].ok,false)
 await db.exec('set role authenticated')
 await assert.rejects(()=>db.query('delete from hermes.resolucion_operacion where id=$1',[result.operacion_id]),/permission denied/)
 await db.exec('reset role')
 await assert.rejects(()=>db.query("update hermes.resolucion_operacion set motivo='Otro' where id=$1",[result.operacion_id]),/conserva/)
 await db.exec('set role authenticated')
 const authorized=(await db.query('select hermes.obtener_resolucion_pedido(881030) r')).rows[0].r
 assert.equal(authorized.puede_resolver,true)
 await assert.rejects(()=>db.query("insert into public.pedido_evento(pedido_id,accion,motivo,usuario) values(881020,'REMANENTE_CANCELADO','Falso','Otro')"),/operación autorizada/)
 await db.exec('reset role')
 console.log('OK: incidencias; cancelación con saldo, reasignación, propuesta verificada, devolución registrada, remanente entregado, saldos, rollback, versiones e idempotencia')
}
