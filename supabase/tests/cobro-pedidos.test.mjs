import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

export async function testCobroPedidos(db, claims) {
  const admin = '00000000-0000-0000-0000-000000000001'
  const caja = '00000000-0000-0000-0000-000000000002'
  const inactive = '00000000-0000-0000-0000-000000000003'
  await claims(admin)
  const before = (await db.query('select count(*)::int n, sum(monto) s from hermes.movimiento_cuenta')).rows
  await db.exec(await fs.readFile(new URL('../migrations/20261017221149_seller_estado_cobro_pedidos.sql', import.meta.url), 'utf8'))
  assert.deepEqual((await db.query('select count(*)::int n, sum(monto) s from hermes.movimiento_cuenta')).rows, before, 'Instalar la consulta no modifica saldos')
  const create = async id => {
    await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values($1,'MAYOR',900001,100,100,$2)", [id, `COBRO-VISUAL-${id}`])
    return (await db.query('select id from hermes.partida_abierta where pedido_id=$1', [id])).rows[0].id
  }
  const query = async ids => (await db.query('select public.consultar_cobros_pedidos($1::bigint[]) r', [ids])).rows[0].r
  let paymentSequence = 0
  const payment = async (partida, monto, estado = 'CONFIRMADO') => {
    const id = (await db.query("insert into hermes.pago(cliente_id,medio,monto,estado,fecha_recepcion,creado_por,idempotencia_clave,confirmado_por,confirmado_en,motivo_rechazo) values(900001,'EFECTIVO',$1,$2,now(),'Prueba cobro',$3,'Admin prueba',now(),'Rechazo de prueba') returning id", [monto, estado, `cobro-visual-${++paymentSequence}`])).rows[0].id
    await db.query('insert into hermes.pago_aplicacion(pago_id,partida_id,monto) values($1,$2,$3)', [id, partida, monto])
  }
  const pa = await create(885001)
  assert.equal((await query([885001]))[0].estado, 'pendiente')
  await payment(pa, 40)
  assert.equal((await query([885001]))[0].estado, 'parcial')
  await payment(pa, 60, 'PROPUESTO')
  let r = (await query([885001]))[0]
  assert.equal(r.estado, 'por_verificar')
  assert.equal(Number(r.por_cobrar), 0, 'El pago registrado por verificar no se pide otra vez')
  assert.equal(Number(r.pendiente), 60, 'La propuesta no cuenta como confirmada')
  await db.query("update hermes.pago set estado='CONFIRMADO' where id in (select pago_id from hermes.pago_aplicacion where partida_id=$1)", [pa])
  assert.equal((await query([885001]))[0].estado, 'pagado')
  const child = (await db.query("insert into hermes.partida_abierta(cliente_id,cliente_nombre,cliente_categoria,documento_interno,inicio_computo,pedido_id,total,estado,creado_por,parent_partida_id,partida_raiz_id,entrega_numero) select cliente_id,cliente_nombre,cliente_categoria,'COBRO-HIJA-PRUEBA',inicio_computo,pedido_id,25,'ABIERTA','Prueba',id,id,2 from hermes.partida_abierta where id=$1 returning id", [pa])).rows[0].id
  await db.query('update public.pedido set total=125,subtotal=125 where id=885001')
  r = (await query([885001]))[0]
  assert.equal(r.estado, 'parcial')
  assert.equal(r.partidas, 2)
  assert.equal(Number(r.pendiente), 25)
  await payment(child, 25)
  assert.equal((await query([885001]))[0].estado, 'pagado')
  const unpaid = await create(885002)
  await db.query("insert into hermes.movimiento_cuenta(cliente_id,tipo,monto,idempotencia_clave,creado_por,fecha_efectiva) values(900001,'ANTICIPO',-10000,'cobro-visual-credito','Prueba',current_date)")
  assert.equal((await query([885002]))[0].estado, 'pendiente', 'Crédito global no paga la partida')
  await payment(unpaid, 100, 'RECHAZADO')
  assert.equal((await query([885002]))[0].estado, 'pendiente', 'Un pago rechazado no cancela deuda')
  await db.query("select public.anular_pedido_con_cartera(885002,'Cancelación de prueba para consulta visual')")
  assert.equal((await query([885002]))[0].estado, 'cancelado')
  assert.equal((await query([880090]))[0].estado, 'revisar')
  assert.deepEqual(await query([999999999]), [])
  assert.equal((await query([885001, 885001])).length, 1)
  await assert.rejects(() => query([]), /Pedidos inválidos/)
  await assert.rejects(() => query(Array(201).fill(885001)), /Pedidos inválidos/)
  await assert.rejects(() => query([null]), /Pedidos inválidos/)
  await claims(inactive)
  await assert.rejects(() => query([885001]), /No autorizado/)
  await db.query("select set_config('request.jwt.claims','',false)")
  await assert.rejects(() => query([885001]), /No autorizado/)
  assert.equal((await db.query("select has_function_privilege('anon','public.consultar_cobros_pedidos(bigint[])','EXECUTE') permitido")).rows[0].permitido, false)
  await claims(caja)
  await db.exec('grant usage on schema public, auth to authenticated; set role authenticated')
  assert.equal((await query([885001]))[0].estado, 'pagado')
  await db.exec('reset role')
  await claims(admin)
  console.log('OK: cobros por partidas, hijas, propuestas, rechazados, crédito global, cancelación histórica, permisos y consulta authenticated')
}
