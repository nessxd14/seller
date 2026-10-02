import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

// Extiende la misma base aislada; nunca se ejecuta contra Supabase.
export async function testOrigenMayorista(db, claims) {
  await db.exec(`
    create table public.producto(id bigint primary key,nombre text);
    create table public.cotizacion(id bigint primary key,cliente_id bigint,numero text,
      estado public.estado_cotizacion,fecha date,total numeric,aprobado_por text,aprobado_en timestamptz);
    create table public.cotizacion_linea(id bigint primary key,cotizacion_id bigint,producto_id bigint,
      descripcion text,cantidad_base numeric,cantidad_presentacion numeric,precio_unitario numeric,
      descuento_pct numeric,subtotal numeric);
    create table public.pedido_linea(id bigint primary key,pedido_id bigint,estado public.estado_linea,
      cantidad_base numeric,cantidad_despachada numeric default 0,precio_unitario numeric,subtotal numeric);
    create table public.pedido_despacho_evento(id bigint primary key,pedido_linea_id bigint,
      cantidad_base numeric,revertido boolean default false,creado_en timestamptz default now());
    create table public.pedido_despacho_movimiento(id bigint primary key,evento_id bigint,
      cantidad_base numeric,cantidad_revertida numeric default 0);
    insert into hermes.hito_plantilla(id,categoria,orden,nombre,obligatorio,fase) values
      (900001,'MAYORISTA',1,'Cotización',false,'PREVIA'),
      (900002,'MAYORISTA',2,'Pedido',true,'PREVIA'),
      (900003,'MAYORISTA',3,'Salida de almacén',true,'ENTREGA'),
      (900004,'MAYORISTA',4,'Entrega',false,'ENTREGA'),
      (900005,'MAYORISTA',5,'Pago',true,'ENTREGA');
    insert into hermes.documento_plantilla(id,hito_plantilla_id,orden,etiqueta,tipo) values
      (900001,900001,1,'Cotización aprobada','ANEXO'),
      (900002,900002,1,'Orden de pedido','HABILITANTE'),
      (900003,900003,1,'Foto de salida de almacén','HABILITANTE'),
      (900004,900004,1,'Acta de entrega firmada','HABILITANTE'),
      (900005,900005,1,'Comprobante de pago','HABILITANTE');
  `)
  await db.exec(await fs.readFile(new URL('../migrations/20261001220328_hermes_origen_mayorista.sql',import.meta.url),'utf8'))
  await claims('00000000-0000-0000-0000-000000000001')
  await db.exec(`
    insert into public.cotizacion values(900020,900001,'COT-TEST','APROBADA','2026-09-30',200,'test',now());
    insert into public.producto values(900020,'Producto de prueba');
    insert into public.cotizacion_linea values(900020,900020,900020,null,10,10,20,0,200);
    insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero,cotizacion_origen_id)
      values(900020,'MAYOR',900001,200,200,'PED-TEST-2',900020);
    insert into public.pedido_linea values
      (900020,900020,'POR_DESPACHAR',10,0,20,200),
      (900021,900020,'COMPRADO_DIRECTO',5,0,null,null),
      (900022,900020,'CAMBIADA',100,0,20,2000);
  `)
  const partida=(await db.query("select hermes.abrir_partida(900020,'test') id")).rows[0].id
  const hitos=async()=>Object.fromEntries((await db.query('select nombre,estado,origen_estado,origen_sistema from hermes.hito where partida_abierta_id=$1',[partida])).rows.map(h=>[h.nombre,h]))
  let h=await hitos()
  assert.equal(h.Cotización.estado,'COMPLETO')
  assert.equal(h.Pedido.estado,'COMPLETO')
  assert.equal(h['Salida de almacén'].origen_estado,'PENDIENTE')
  assert.equal(h.Entrega.origen_sistema,null)
  assert.equal(h.Pago.estado,'PENDIENTE')
  assert.equal((await db.query("select tipo from hermes.documento where documento_plantilla_id=900003 and hito_id in(select id from hermes.hito where partida_abierta_id=$1)",[partida])).rows[0].tipo,'ANEXO')
  assert.equal((await db.query("select count(*)::int n from hermes.documento where estado='APROBADO' and hito_id in(select id from hermes.hito where partida_abierta_id=$1)",[partida])).rows[0].n,0,'No inventa aprobaciones de archivos')
  const origen=(await db.query('select hermes.obtener_origen_expediente($1) datos',[partida])).rows[0].datos
  assert.equal(origen.salida.lineas_almacen,1,'No cuenta líneas sustituidas ni compras directas como stock')
  assert.equal(origen.salida.lineas_fuera_almacen,1)
  assert.equal(origen.lineas_cotizacion[0].descripcion,'Producto de prueba')
  const saldoAntes=(await db.query('select saldo_confirmado from hermes.v_saldo_cliente where cliente_id=900001')).rows[0]
  const fechasAntes=(await db.query('select fecha_entrega,fecha_factura from hermes.partida_abierta where id=$1',[partida])).rows[0]
  await db.exec("insert into public.pedido_despacho_evento(id,pedido_linea_id,cantidad_base) values(900001,900020,4)")
  assert.equal((await hitos())['Salida de almacén'].origen_estado,'PARCIAL')
  await db.exec("insert into public.pedido_despacho_evento(id,pedido_linea_id,cantidad_base) values(900002,900020,6)")
  assert.equal((await hitos())['Salida de almacén'].estado,'COMPLETO')
  await db.exec("insert into public.pedido_despacho_movimiento values(900002,900002,6,2)")
  assert.equal((await hitos())['Salida de almacén'].origen_estado,'PARCIAL','La reversión parcial descuenta cantidades')
  await db.exec("update public.pedido_despacho_evento set revertido=true where id in(900001,900002)")
  assert.equal((await hitos())['Salida de almacén'].origen_estado,'PENDIENTE')
  // Un contador inflado no prevalece sobre eventos revertidos.
  await db.exec("update public.pedido_linea set cantidad_despachada=10,estado='DESPACHADA' where id=900020")
  assert.equal((await hitos())['Salida de almacén'].origen_estado,'PENDIENTE')
  await db.exec("update public.pedido_despacho_evento set revertido=false where id in(900001,900002);update public.pedido_despacho_movimiento set cantidad_revertida=0 where id=900002")
  assert.equal((await hitos())['Salida de almacén'].estado,'COMPLETO')
  assert.deepEqual((await db.query('select saldo_confirmado from hermes.v_saldo_cliente where cliente_id=900001')).rows[0],saldoAntes)
  assert.deepEqual((await db.query('select fecha_entrega,fecha_factura from hermes.partida_abierta where id=$1',[partida])).rows[0],fechasAntes,'Despachar no registra la recepción')

  const salida=(await db.query("select id from hermes.hito where partida_abierta_id=$1 and nombre='Salida de almacén'",[partida])).rows[0].id
  const adicional=(await db.query("insert into hermes.documento(hito_id,etiqueta,tipo) values($1,'Requisito específico','HABILITANTE') returning id",[salida])).rows[0].id
  assert.equal((await hitos())['Salida de almacén'].estado,'PENDIENTE','Respeta requisitos adicionales')
  await db.query("update hermes.documento set estado='APROBADO' where id=$1",[adicional])
  assert.equal((await hitos())['Salida de almacén'].estado,'COMPLETO')
  await db.exec("update public.cotizacion set estado='BORRADOR' where id=900020")
  assert.equal((await hitos()).Cotización.estado,'PENDIENTE')
  const cotHito=(await db.query("select id from hermes.hito where partida_abierta_id=$1 and nombre='Cotización'",[partida])).rows[0].id
  await assert.rejects(()=>db.query("select hermes.completar_hito($1,'test')",[cotHito]),/actualiza desde Seller/)
  await db.exec('set role hermes_app')
  await assert.rejects(()=>db.query("update hermes.hito set origen_sistema='ALMACEN' where id=$1",[cotHito]),/actualiza desde Seller/)
  await assert.rejects(()=>db.query("insert into hermes.hito(partida_abierta_id,orden,nombre,origen_sistema,origen_estado) values($1,99,'Falso','SELLER','COMPLETO')",[partida]),/actualiza desde Seller/)
  await db.exec('reset role')
  await db.exec("update public.cotizacion set estado='CONVERTIDA' where id=900020")
  assert.equal((await hitos()).Cotización.estado,'COMPLETO')
  await db.exec("update public.cotizacion set cliente_id=999999 where id=900020")
  assert.equal((await hitos()).Cotización.origen_estado,'REVISION')
  assert.equal((await db.query('select hermes.obtener_origen_expediente($1) datos',[partida])).rows[0].datos.cotizacion,null,'No filtra datos de una cotización de otro cliente')
  await db.exec("update public.pedido set estado='CANCELADO' where id=900020")
  assert.equal((await hitos()).Pedido.origen_estado,'ANULADO')
  assert.equal((await hitos())['Salida de almacén'].estado,'PENDIENTE')
  await db.exec("update public.pedido set estado='ABIERTO' where id=900020")

  await db.exec(`insert into public.pedido(id,categoria,cliente_id,total,subtotal,numero)
    values(900021,'MAYOR',900001,50,50,'PED-DIRECTO');
    insert into public.pedido_linea values(900023,900021,'COMPRADO_DIRECTO',1,0,50,50);`)
  const directo=(await db.query("select hermes.abrir_partida(900021,'test') id")).rows[0].id
  const directos=(await db.query('select nombre,origen_estado from hermes.hito where partida_abierta_id=$1',[directo])).rows
  assert.equal(directos.find(h=>h.nombre==='Cotización').origen_estado,'NO_APLICA')
  assert.equal(directos.find(h=>h.nombre==='Salida de almacén').origen_estado,'NO_APLICA')
  await db.query("update hermes.partida_abierta set estado='PAGADA' where id=$1",[directo])
  await db.exec("update public.pedido set estado='CANCELADO' where id=900021")
  assert.deepEqual((await db.query('select nombre,origen_estado from hermes.hito where partida_abierta_id=$1',[directo])).rows,directos,'Conserva el expediente cerrado')
  await claims('00000000-0000-0000-0000-000000000002')
  await assert.rejects(()=>db.query('select hermes.obtener_origen_expediente($1)',[partida]),/Sin acceso/)
  assert.equal((await db.query("select has_function_privilege('authenticated','hermes.actualizar_origen_mayorista(bigint)','EXECUTE') permitido")).rows[0].permitido,false)
  assert.equal((await db.query("select has_function_privilege('anon','hermes.obtener_origen_expediente(bigint)','EXECUTE') permitido")).rows[0].permitido,false)
  console.log('OK: origen automático, cotización vinculada, compras directas, despachos parciales/revertidos, requisitos extra, seguridad y conservación de saldos/fechas')
}
