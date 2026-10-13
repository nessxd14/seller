import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

// Se ejecuta sobre PGlite con las migraciones financieras previas y datos sintéticos.
export async function testBajasTrazabilidad(db, claims) {
  const admin = '00000000-0000-0000-0000-000000000001'
  const caja = '00000000-0000-0000-0000-000000000002'
  await db.exec(`alter table public.pedido_evento add column if not exists creado_en timestamptz default now();
    alter table public.pedido_linea add column if not exists modificado_por text;
    alter table public.pedido_linea add column if not exists modificado_en timestamptz;
    alter table public.pedido add column if not exists alerta_lineas_en timestamptz;
    create or replace function public.guardar_version_pedido(bigint,text,text) returns void language sql as $$ select $$;
    create or replace function public.app_puede_inventariar() returns boolean language sql as $$ select exists(select 1 from public.perfil where id=auth.uid() and activo and rol<>'cajero') $$;
    create or replace function public.app_puede_rechazar_pedido_completo() returns boolean language sql as $$ select exists(select 1 from public.perfil where id=auth.uid() and activo and rol in ('admin','gerente','almacenero')) $$;`)
  // Reproduce un pedido cancelado por la integración anterior, aún con deuda y propuesta.
  await claims(admin)
  await db.exec("update public.sesion_caja set estado='ABIERTA' where id=900001; insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values(880090,'MAYOR',900001,100,100,'BAJA-LEGADO')")
  const legacyPayment = (await db.query("select public.registrar_cobro_hermes(p_pedido_id=>880090,p_cliente_id=>900001,p_monto=>10,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-legacy-propuesta') r")).rows[0].r
  await db.query("update public.pedido set estado='CANCELADO' where id=880090")
  const before = await db.query('select count(*)::int as n from hermes.movimiento_cuenta')
  await db.exec(await fs.readFile(new URL('../migrations/20261013155427_hermes_bajas_trazabilidad.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await db.query('select count(*)::int as n from hermes.movimiento_cuenta'), before, 'La instalación no corrige datos históricos')
  await assert.rejects(() => db.query("select hermes.confirmar_pago($1,'otro')",[legacyPayment.pagoId]),/pedido cancelado/)
  assert.equal((await db.query('select estado from hermes.pago where id=$1',[legacyPayment.pagoId])).rows[0].estado,'PROPUESTO')
  assert.deepEqual(await db.query('select count(*)::int as n from hermes.movimiento_cuenta'),before,'La confirmación bloqueada no crea abonos')
  assert.equal((await db.query("select public.registrar_cobro_hermes(p_pedido_id=>880090,p_cliente_id=>900001,p_monto=>10,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-legacy-propuesta') r")).rows[0].r.movementId,legacyPayment.movementId,'Los cobros históricos conservan su reintento sin registrar dinero nuevo')
  await claims(admin)
  await db.exec("update public.sesion_caja set estado='ABIERTA' where id=900001")
  const actor = (await db.query('select nombre from public.perfil where id=$1',[admin])).rows[0].nombre
  const create = async (id) => {
    await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values($1,'MAYOR',900001,100,100,$2)",[id,`BAJA-TEST-${id}`])
    await db.query("insert into public.pedido_linea(pedido_id,estado,cantidad_base,cantidad_despachada,precio_unitario,subtotal) values($1,'POR_DESPACHAR',10,0,10,100)",[id])
    return (await db.query('select id from hermes.partida_abierta where pedido_id=$1',[id])).rows[0].id
  }
  const cancel = id => db.query("select public.anular_pedido_con_cartera($1,'Cliente cancela')",[id])
  const pa = await create(880001)
  const manualHito = (await db.query("insert into hermes.hito(partida_abierta_id,orden,nombre) values($1,99,'Revisión manual') returning id",[pa])).rows[0].id
  const manualDoc = (await db.query("insert into hermes.documento(hito_id,etiqueta,tipo,estado) values($1,'Respaldo sintético','ANEXO','SUBIDO') returning id",[manualHito])).rows[0].id
  await assert.rejects(() => db.query("select hermes.anular_partida($1,'Directa','otro')",[pa]),/Seller/)
  await assert.rejects(() => db.query("select public.anular_pedido(880001,'  ','otro')"),/motivo/)
  await assert.rejects(() => db.query('select public.anular_pedido_con_cartera(880001,$1)', ['\n\t']),/motivo/)
  await claims(caja)
  await assert.rejects(() => cancel(880001),/rol/)
  await claims(admin)
  const saldo = async () => Number((await db.query('select sum(monto) s from hermes.movimiento_cuenta where partida_id=$1',[pa])).rows[0].s)
  assert.equal(await saldo(),100)
  await cancel(880001)
  assert.equal(await saldo(),0)
  const baja = (await db.query('select estado,anulada_por,anulada_usuario_id,motivo_anulacion from hermes.partida_abierta where id=$1',[pa])).rows[0]
  assert.equal(baja.estado,'ANULADA'); assert.equal(baja.anulada_por,actor); assert.equal(baja.anulada_usuario_id,admin)
  assert.equal(baja.motivo_anulacion,'Cliente cancela')
  await assert.rejects(() => db.query("select hermes.completar_hito($1,'usuario falso')",[manualHito]),/dado de baja/)
  await assert.rejects(() => db.query("select hermes.revisar_documento($1,true,'usuario falso')",[manualDoc]),/dado de baja/)
  await cancel(880001)
  assert.equal((await db.query("select count(*)::int n from hermes.movimiento_cuenta where partida_id=$1 and tipo='NOTA_CREDITO'",[pa])).rows[0].n,1)
  const history = (await db.query('select hermes.obtener_historial_partida($1) r',[pa])).rows[0].r
  assert.equal(history.eventos.length,2); assert(history.eventos.every(e=>e.usuario===actor && e.usuario_id===admin))
  const beforeLatePayment = (await db.query('select count(*)::int n from public.movimiento_caja')).rows[0].n
  await assert.rejects(() => db.query("select public.registrar_cobro_hermes(p_pedido_id=>880001,p_cliente_id=>900001,p_monto=>10,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-cobro-posterior')"),/cancelado/)
  assert.equal((await db.query('select count(*)::int n from public.movimiento_caja')).rows[0].n,beforeLatePayment,'No registra dinero nuevo sobre un pedido cancelado')
  await assert.rejects(() => db.query("select public.restaurar_pedido_con_cartera(880001,'Reabrir')"),/cartera ya fue dada de baja/)

  const proposed = await create(880002)
  const payment = (await db.query("select public.registrar_cobro_hermes(p_pedido_id=>880002,p_cliente_id=>900001,p_monto=>10,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-propuesta') r")).rows[0].r
  assert.equal((await db.query("select public.registrar_cobro_hermes(p_pedido_id=>880002,p_cliente_id=>900001,p_monto=>10,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-propuesta') r")).rows[0].r.movementId,payment.movementId,'El guard de cancelación no duplica cobros en un reintento')
  await assert.rejects(() => cancel(880002),/pagos aplicados o por verificar/)
  assert.equal((await db.query('select estado from hermes.partida_abierta where id=$1',[proposed])).rows[0].estado,'ABIERTA')
  await db.query("select hermes.confirmar_pago($1,'otro')",[payment.pagoId])
  await assert.rejects(() => cancel(880002),/pagos aplicados o por verificar/)
  const partial = await create(880003)
  await db.query('update public.pedido_linea set cantidad_despachada=2 where pedido_id=880003')
  await assert.rejects(() => cancel(880003),/entregas/)
  const lineId = (await db.query('select id from public.pedido_linea where pedido_id=880003')).rows[0].id
  await assert.rejects(() => db.query("select public.rechazar_pedido_linea($1,'Sin stock','otro')",[lineId]),/entregas/)
  assert.equal((await db.query('select estado from hermes.partida_abierta where id=$1',[partial])).rows[0].estado,'ABIERTA')
  const rejected = await create(880004)
  await assert.rejects(() => db.query("select public.rechazar_pedido(880004,'','otro')"),/motivo/)
  await db.query("select public.rechazar_pedido(880004,'Sin disponibilidad','otro')")
  assert.equal((await db.query('select estado from public.pedido where id=880004')).rows[0].estado,'ABIERTO')
  await db.query("select hermes.sincronizar_entrega_pedido(880004,current_date,'otro')")
  assert.equal((await db.query('select fecha_entrega from hermes.partida_abierta where id=$1',[rejected])).rows[0].fecha_entrega,null)
  const rejection = (await db.query('select hermes.obtener_historial_partida($1) r',[rejected])).rows[0].r
  assert.equal(rejection.pedido.lineas_rechazadas,1); assert.equal(rejection.eventos[0].motivo,'Sin disponibilidad')
  assert.equal(rejection.eventos[0].usuario,actor)
  await assert.rejects(() => db.query("update public.pedido_evento set motivo='Motivo cambiado' where pedido_id=880004"),/historial conserva/)
  await assert.rejects(() => db.query('delete from public.pedido_evento where pedido_id=880004'),/historial conserva/)
  await cancel(880004)
  await create(880005)
  await assert.rejects(() => db.query("update public.pedido set estado='CANCELADO' where id=880005"),/operación de Seller|origen está cancelada/)
  await db.query("update hermes.partida_abierta set fecha_factura=current_date where pedido_id=880005")
  await assert.rejects(() => cancel(880005),/factura/)
  // Una baja manual sin pedido conserva la autoría del servidor y no duplica crédito.
  const manual = await create(880006)
  await db.query('update hermes.partida_abierta set pedido_id=null where id=$1',[manual])
  await db.query("select hermes.anular_partida_auditada($1,'Corrección documentada')",[manual])
  assert.equal((await db.query('select anulada_por from hermes.partida_abierta where id=$1',[manual])).rows[0].anulada_por,actor)
  await db.query("select hermes.anular_partida($1,'Corrección documentada','suplantado')",[manual])
  assert.equal(Number((await db.query('select sum(monto) n from hermes.movimiento_cuenta where partida_id=$1',[manual])).rows[0].n),0)
  // Rechazar una línea individual mantiene autor y vínculo de línea.
  const single = await create(880007)
  const singleLine = (await db.query('select id from public.pedido_linea where pedido_id=880007')).rows[0].id
  await db.query("select public.rechazar_pedido_linea($1,'Producto no disponible','suplantado')",[singleLine])
  const singleHistory = (await db.query('select hermes.obtener_historial_partida($1) r',[single])).rows[0].r
  assert.equal(singleHistory.eventos[0].pedido_linea_id,singleLine)
  assert.equal(singleHistory.eventos[0].usuario_id,admin)
  // Raíz e hija se revierten juntas, sin alterar el saldo de otros pedidos.
  const root = await create(880008)
  await db.exec("update public.perfil set rol='gerente' where id='00000000-0000-0000-0000-000000000001'")
  const child = (await db.query("select hermes.partir_partida($1,40,'prueba') id",[root])).rows[0].id
  await db.exec("update public.perfil set rol='admin' where id='00000000-0000-0000-0000-000000000001'")
  await cancel(880008)
  assert.equal((await db.query("select count(*)::int n from hermes.partida_abierta where pedido_id=880008 and estado='ANULADA'")).rows[0].n,2)
  assert.equal((await db.query('select hermes.obtener_historial_partida($1) r',[child])).rows[0].r.pedido.id,880008)
  // Todas las categorías consultan historial; no depende del origen mayorista.
  await db.query("update hermes.partida_abierta set cliente_categoria='INSTITUCIONAL' where id=$1",[single])
  assert.equal((await db.query('select hermes.obtener_historial_partida($1) r',[single])).rows[0].r.eventos.length,1)
  await db.query("update hermes.partida_abierta set cliente_categoria='CORPORATIVO' where id=$1",[single])
  assert.equal((await db.query('select hermes.obtener_historial_partida($1) r',[single])).rows[0].r.eventos.length,1)
  // Crédito preexistente: restaurar su uso no equivale a inventar un reembolso de caja.
  await db.query("insert into public.cliente(id,nombre,tipo_precio,activo) values(880009,'Crédito de prueba','mayorista',true)")
  const creditCustomer = (await db.query('select id from hermes.cliente where pos_cliente_id=880009')).rows[0].id
  await db.query("insert into hermes.movimiento_cuenta(cliente_id,tipo,monto,idempotencia_clave,fecha_efectiva,creado_por) values($1,'SALDO_APERTURA',-100,'baja-credito-apertura',current_date,'prueba')",[creditCustomer])
  await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values(880009,'MAYOR',880009,100,100,'BAJA-CREDITO')")
  await db.query("insert into public.pedido_linea(pedido_id,estado,cantidad_base,cantidad_despachada,precio_unitario,subtotal) values(880009,'POR_DESPACHAR',10,0,10,100)")
  await db.query("select public.aplicar_saldo_pedido(880009,100,900001,'baja-uso-credito')")
  await db.query("update hermes.partida_abierta set fecha_factura=current_date where pedido_id=880009")
  await assert.rejects(() => cancel(880009),/factura/)
  assert.equal((await db.query('select anulado_en from public.saldo_cliente_uso where pedido_id=880009')).rows[0].anulado_en,null,'La baja fallida revierte también la liberación del crédito')
  await db.query('update hermes.partida_abierta set fecha_factura=null where pedido_id=880009')
  await cancel(880009)
  assert.equal((await db.query('select motivo_anulacion from public.saldo_cliente_uso where pedido_id=880009')).rows[0].motivo_anulacion,'Cliente cancela')
  assert.equal(Number((await db.query('select sum(monto) n from hermes.movimiento_cuenta where cliente_id=$1',[creditCustomer])).rows[0].n),-100)
  // Operación mixta: completar líneas terminales no equivale a entregar el pedido entero.
  const mixed = await create(880010)
  const mixedLine = (await db.query('select id from public.pedido_linea where pedido_id=880010')).rows[0].id
  await db.query("insert into public.pedido_linea(pedido_id,estado,cantidad_base,cantidad_despachada,precio_unitario,subtotal) values(880010,'DESPACHADA',1,1,10,10)")
  await db.query("select public.rechazar_linea_pedido_auditada($1,'Sin stock')",[mixedLine])
  assert.equal((await db.query('select estado from public.pedido where id=880010')).rows[0].estado,'COMPLETADO')
  assert.equal((await db.query('select fecha_entrega from hermes.partida_abierta where id=$1',[mixed])).rows[0].fecha_entrega,null)
  assert.equal((await db.query('select count(*)::int n from public.pendiente_sync_hermes_despacho where pedido_id=880010')).rows[0].n,0)
  await db.query('insert into public.pendiente_sync_hermes_despacho(pedido_id,fecha_completado) values(880010,current_date)')
  await db.query('select hermes.sincronizar_pedido_pos(880010,current_date)')
  const pending = (await db.query('select sincronizado_en,ultimo_error from public.pendiente_sync_hermes_despacho where pedido_id=880010')).rows[0]
  assert.equal(pending.sincronizado_en,null); assert.equal(pending.ultimo_error,'sin_entrega_verificable')
  // Los movimientos totalmente revertidos no son una entrega vigente; los parciales sí.
  await create(880011)
  const reversedLine = (await db.query('select id from public.pedido_linea where pedido_id=880011')).rows[0].id
  await db.query('insert into public.pedido_despacho_evento(id,pedido_linea_id,cantidad_base,revertido) values(880011,$1,10,false)',[reversedLine])
  await db.query('insert into public.pedido_despacho_movimiento(id,evento_id,cantidad_base,cantidad_revertida) values(880011,880011,10,10)')
  await cancel(880011)
  await create(880012)
  const partlyReversedLine = (await db.query('select id from public.pedido_linea where pedido_id=880012')).rows[0].id
  await db.query('insert into public.pedido_despacho_evento(id,pedido_linea_id,cantidad_base,revertido) values(880012,$1,10,false)',[partlyReversedLine])
  await db.query('insert into public.pedido_despacho_movimiento(id,evento_id,cantidad_base,cantidad_revertida) values(880012,880012,10,9)')
  await db.query("update public.pedido_linea set estado='RECHAZADO' where id=$1",[partlyReversedLine])
  await assert.rejects(() => cancel(880012),/entregas/)
  // Un reintento de sincronización respeta la entrega registrada y se reconoce como aplicado.
  const delivered = await create(880013)
  await db.query("update public.pedido_linea set estado='DESPACHADA',cantidad_despachada=10 where pedido_id=880013")
  await db.query('select public.recalcular_estado_pedido(880013)')
  const originalDate = (await db.query('select fecha_entrega from hermes.partida_abierta where id=$1',[delivered])).rows[0].fecha_entrega
  assert(originalDate)
  await db.query('update public.pendiente_sync_hermes_despacho set sincronizado_en=null where pedido_id=880013')
  await db.query('select hermes.sincronizar_pedido_pos(880013,current_date)')
  assert.deepEqual((await db.query('select fecha_entrega from hermes.partida_abierta where id=$1',[delivered])).rows[0].fecha_entrega,originalDate)
  assert((await db.query('select sincronizado_en from public.pendiente_sync_hermes_despacho where pedido_id=880013')).rows[0].sincronizado_en)
  await create(880014)
  await db.query('update public.pedido set recibido_en=now() where id=880014')
  await assert.rejects(() => cancel(880014),/entregas/)
  // Pagar antes de completar documentos conserva su gestión; no es una baja.
  const paid = await create(880016)
  const paidHito = (await db.query("insert into hermes.hito(partida_abierta_id,orden,nombre) values($1,99,'Revisión documental') returning id",[paid])).rows[0].id
  const paidDoc = (await db.query("insert into hermes.documento(hito_id,etiqueta,tipo,estado) values($1,'Respaldo sintético','ANEXO','SUBIDO') returning id",[paidHito])).rows[0].id
  const paidPayment = (await db.query("select public.registrar_cobro_hermes(p_pedido_id=>880016,p_cliente_id=>900001,p_monto=>100,p_metodo=>'EFECTIVO',p_sesion_id=>900001,p_idempotencia=>'baja-pago-documentado') r")).rows[0].r
  await db.query("select hermes.confirmar_pago($1,'operador de prueba')",[paidPayment.pagoId])
  assert.equal((await db.query('select estado from hermes.partida_abierta where id=$1',[paid])).rows[0].estado,'PAGADA')
  await db.query("select hermes.revisar_documento($1,true,'operador de prueba')",[paidDoc])
  await db.query("select hermes.completar_hito($1,'operador de prueba')",[paidHito])
  assert.equal((await db.query('select estado from hermes.documento where id=$1',[paidDoc])).rows[0].estado,'APROBADO')
  // Si una hija no puede darse de baja, se revierten las bajas previas de la raíz.
  const rollbackRoot = await create(880017)
  await db.exec("update public.perfil set rol='gerente' where id='00000000-0000-0000-0000-000000000001'")
  const rollbackChild = (await db.query("select hermes.partir_partida($1,40,'operador de prueba') id",[rollbackRoot])).rows[0].id
  await db.exec("update public.perfil set rol='admin' where id='00000000-0000-0000-0000-000000000001'")
  await db.query('update hermes.partida_abierta set fecha_factura=current_date where id=$1',[rollbackChild])
  const beforeChildFailure = (await db.query('select count(*)::int n,sum(monto) saldo from hermes.movimiento_cuenta where partida_id in ($1,$2)',[rollbackRoot,rollbackChild])).rows[0]
  await assert.rejects(() => cancel(880017),/factura/)
  assert.deepEqual((await db.query('select count(*)::int n,sum(monto) saldo from hermes.movimiento_cuenta where partida_id in ($1,$2)',[rollbackRoot,rollbackChild])).rows[0],beforeChildFailure)
  assert.equal((await db.query('select estado from hermes.partida_abierta where id=$1',[rollbackRoot])).rows[0].estado,'ABIERTA')
  // Restaurar sigue siendo posible cuando no se había dado de baja deuda de Hermes.
  await db.query("insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero) values(880018,'TIENDA',990003,100,100,'BAJA-SIN-CARTERA')")
  await cancel(880018)
  await db.query("select public.restaurar_pedido_con_cartera(880018,'Cancelación operativa equivocada')")
  assert.equal((await db.query('select estado from public.pedido where id=880018')).rows[0].estado,'ABIERTO')
  assert.equal((await db.query("select count(*)::int n from public.pedido_evento where pedido_id=880018 and accion in ('ANULADO','RESTAURADO')")).rows[0].n,2)
  // La baja manual no puede desconectarse de una venta que sigue vigente.
  const saleLinked = await create(880019)
  const activeSale = (await db.query("select id from public.venta where estado<>'ANULADA' order by id limit 1")).rows[0].id
  await db.query('update hermes.partida_abierta set pedido_id=null,venta_id=$1 where id=$2',[activeSale,saleLinked])
  await assert.rejects(() => db.query("select hermes.anular_partida_auditada($1,'Baja manual')",[saleLinked]),/venta vigente/)
  assert.equal((await db.query('select estado from hermes.partida_abierta where id=$1',[saleLinked])).rows[0].estado,'ABIERTA')
  for (const signature of ['hermes.obtener_historial_partida(bigint)','hermes.anular_partida_auditada(bigint,text)','public.anular_pedido_con_cartera(bigint,text)','public.restaurar_pedido_con_cartera(bigint,text)','hermes.anular_partida(bigint,text,text)','public.anular_pedido(bigint,text,text)','public.rechazar_pedido(bigint,text,text)','public.rechazar_pedido_auditado(bigint,text)','public.rechazar_linea_pedido_auditada(bigint,text)']) {
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') ok",[signature])).rows[0].ok,false)
  }
  assert.equal((await db.query("select has_function_privilege('authenticated','hermes.baja_partida_interna(bigint,text,text)','execute') ok")).rows[0].ok,false)
  const authenticatedPartida = await create(880015)
  const authenticatedLine = (await db.query('select id from public.pedido_linea where pedido_id=880015')).rows[0].id
  await db.exec('set role authenticated')
  await db.query("select public.rechazar_linea_pedido_auditada($1,'Rechazo desde sesión normal')",[authenticatedLine])
  assert.equal((await db.query('select hermes.obtener_historial_partida($1) r',[authenticatedPartida])).rows[0].r.eventos[0].usuario_id,admin)
  assert.equal((await db.query('select hermes.obtener_historial_partida($1) r',[pa])).rows[0].r.pedido.id,880001)
  await assert.rejects(() => db.query("select hermes.baja_partida_interna($1,'No permitido','otro')",[pa]),/permission denied/)
  await db.exec('reset role')
  // Aun con permiso de INSERT, un cliente no puede inventar cancelaciones en la bitácora.
  await db.exec('grant insert on public.pedido_evento to authenticated; set role authenticated')
  await assert.rejects(() => db.query("insert into public.pedido_evento(pedido_id,accion,motivo,usuario) values(880001,'ANULADO','Inventado','Suplantado')"),/operación autorizada/)
  await db.exec('reset role')
  await claims('00000000-0000-0000-0000-000000000003')
  await assert.rejects(() => db.query('select hermes.obtener_historial_partida($1)',[pa]),/Sin acceso/)
  await claims(admin)
  console.log('OK: bajas coordinadas, motivo/autor, expediente cerrado, cobros posteriores y propuestas históricas bloqueados, entregas/reversiones, rollback de hijas, restauración e idempotencia')
}
