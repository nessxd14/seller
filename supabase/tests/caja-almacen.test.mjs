import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

// Extiende la base financiera sintética. Los adaptadores de stock de esta suite
// son los del fixture; la suite WMS comprueba además el Kardex real con cajas x12.
export async function testCajaAlmacen(db, claims) {
  await db.exec(`alter table public.presentacion add column if not exists nombre text default 'Unidad';
    create function public.resolver_ubicacion_salida(bigint,bigint) returns bigint language sql as $$select $2$$;
    create function public.registrar_salida(p_presentacion_id bigint,p_ubicacion_id bigint,p_cantidad_pres numeric,p_referencia text,p_usuario varchar default null,p_fecha date default current_date,p_idempotencia text default null,p_permitir_sobregiro boolean default false) returns bigint language sql as $$select public.registrar_salida($1,$2,$3,$4,$5::text,$6,$7,$8)$$;
    create function public.registrar_entrada(p_presentacion_id bigint,p_ubicacion_id bigint,p_cantidad_pres numeric,p_referencia text,p_usuario varchar default null,p_fecha date default current_date,p_costo_unitario numeric default null,p_idempotencia text default null) returns bigint language sql as $$select public.registrar_entrada($1,$2,$3,$4,$5::text,$6,$7::text,$8)$$;
    update public.sesion_caja set estado='ABIERTA' where id=900001;
    insert into public.perfil(id,nombre,rol,activo,email,sucursal_id) values
      ('00000000-0000-0000-0000-000000000040','Almacén QA','almacenero',true,'almacen@qa.invalid',2),
      ('00000000-0000-0000-0000-000000000041','Otra caja QA','cajero',true,'otra@qa.invalid',2),
      ('00000000-0000-0000-0000-000000000042','Otro almacén QA','operario',true,'otro@qa.invalid',99);
    insert into public.sesion_caja(id,caja_id,estado,monto_apertura,cajero_id) values(990041,1,'ABIERTA',100,'00000000-0000-0000-0000-000000000041');
    insert into public.venta(id,numero,total,subtotal,estado,cobro_exigible,ubicacion_id,sesion_caja_id) values
      (991001,'VTD-TEST-NEW1',30,30,'ABIERTA',true,990001,900001),
      (991002,'VTD-TEST-NEW2',40,40,'ABIERTA',true,990001,900001),
      (991003,'VTD-TEST-NEW3',50,50,'ABIERTA',true,990001,900001);
    insert into public.venta_linea(venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_unitario) values
      (991001,990001,990001,3,3,10),(991002,990001,990001,4,4,10),(991003,990001,990001,5,5,10);`)
  await db.exec(await fs.readFile(new URL('../migrations/20261017140005_caja_almacen_operacion_unica.sql',import.meta.url),'utf8'))
  const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
  const op='10000000-0000-0000-0000-000000000001'
  const op2='10000000-0000-0000-0000-000000000002'
  const rpc=async(action,id=op,data={},session=900001)=>(await db.query('select public.operar_caja_almacen($1,$2,$3,$4) r',[action,id,session,JSON.stringify(data)])).rows[0].r
  const stock=async()=>Number((await db.query('select cantidad_base from public.stock_actual where producto_id=990001 and ubicacion_id=990001')).rows[0].cantidad_base)
  const pay=async(id=op,ids=[991001],lines=[{producto_id:990001,cantidad_base:2,precio_unitario:10,sucursal_origen_id:2}],payments=[{metodo:'EFECTIVO',monto:50}])=>(await db.query('select public.checkout_caja(p_lineas=>$1,p_pagos=>$2,p_sesion_id=>900001,p_idempotencia=>$3,p_vtd_ids=>$4) r',[JSON.stringify(lines),JSON.stringify(payments),'checkout:'+id,ids])).rows[0].r
  const cantidades=d=>d.lineas.map(l=>({linea_id:l.linea_id,cantidad_base:l.cantidad_base})).sort((a,b)=>a.linea_id-b.linea_id)
  await claims(uid(2))
  let r=await rpc('vincular',op,{vtd_ids:[991001],borrador:{cart:[],channel:'retail',discount:0,customer:null,pedido:null}})
  assert.equal(r.operacion.id,op)
  assert.equal((await rpc('actual')).operacion.id,op,'Recarga/otra pestaña recupera el mismo pendiente')
  await assert.rejects(()=>rpc('vincular',op2,{vtd_ids:[991002]}),/retoma y resuelve/)
  await assert.rejects(()=>pay(op2,[],[],[]),/operación pendiente/)
  await assert.rejects(()=>pay(op,[],[{producto_id:990001,cantidad_base:2,precio_unitario:10,sucursal_origen_id:2}],[{metodo:'EFECTIVO',monto:20}]),/todas las VTD/)
  await assert.rejects(()=>db.exec("insert into public.venta(numero,estado) values('VTA-BYPASS','ABIERTA')"),/operación pendiente/)
  await assert.rejects(()=>db.exec("insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,venta_id) values(900001,'ANULACION','EFECTIVO',30,991001)"),/operación de Caja/)
  await assert.rejects(()=>db.exec("update public.sesion_caja set estado='CERRADA' where id=900001"),/antes de cerrar/)
  r=await rpc('guardar',op,{revision:r.operacion.revision,borrador:{cart:[{id:999}],channel:'retail'}})
  await assert.rejects(()=>rpc('guardar',op,{revision:0,borrador:{cart:[]}}),/otra pestaña/)
  await claims(uid(41));assert.equal((await rpc('actual')).operacion,null,'Otra caja no hereda el bloqueo')
  await assert.rejects(()=>rpc('vincular',op2,{vtd_ids:[991001]},990041),/otra operación/)
  await claims(uid(2));const before=await stock()
  const receipt=await pay();assert.equal(Number(receipt.total),50,'VTA + VTD se cobran juntas aunque falte el escaneo')
  assert.equal(await stock(),before-2,'El cobro sólo descuenta la VTA')
  assert.equal((await pay()).id,receipt.id,'Respuesta perdida no duplica cobro')
  await assert.rejects(()=>rpc('completar'),/Pendiente de verificación/)
  await assert.rejects(()=>rpc('guardar',op,{revision:r.operacion.revision,borrador:{cart:[]}}),/no edites/)
  await claims(uid(42));await assert.rejects(()=>rpc('consultar_vtd',null,{venta_id:991001}),/otra sucursal/)
  await claims(uid(40));r=await rpc('escanear',null,{venta_id:991001});let d=r.vtds[0]
  r=await rpc('escanear',null,{venta_id:991001});assert.equal(r.vtds[0].version,d.version,'El documento se escanea una vez')
  await assert.rejects(()=>rpc('enviar',null,{venta_id:991001,version:d.version,cantidades:[]}),/Comprueba todas/)
  r=await rpc('enviar',null,{venta_id:991001,version:d.version,cantidades:cantidades(d)});assert.equal(r.vtds[0].estado,'EN_CAJA')
  assert.equal(await stock(),before-5)
  await rpc('enviar',null,{venta_id:991001,version:d.version,cantidades:cantidades(d)});assert.equal(await stock(),before-5,'Reintento no repite salida')
  await claims(uid(2));r=await rpc('completar');assert.equal(r.operacion.estado,'COMPLETADA');assert.equal(await stock(),before-5,'Completar no vuelve a descontar')
  assert.equal((await rpc('completar')).operacion.estado,'COMPLETADA','Cierre idempotente')
  assert.equal((await rpc('actual')).operacion,null)
  // Rechazo cobrado con material ya fuera: dinero se resuelve y el stock espera recepción.
  await rpc('vincular',op2,{vtd_ids:[991002],borrador:{cart:[]}})
  await pay(op2,[991002],[],[{metodo:'EFECTIVO',monto:40}])
  await claims(uid(40));r=await rpc('escanear',null,{venta_id:991002});d=r.vtds[0]
  await rpc('enviar',null,{venta_id:991002,version:d.version,cantidades:cantidades(d)})
  const beforeReject=await stock()
  await claims(uid(2));await assert.rejects(()=>rpc('rechazar',op2,{venta_id:991002,motivo:'Cliente desistió'}),/devolución realizada/)
  r=await rpc('rechazar',op2,{venta_id:991002,motivo:'Cliente desistió',devolucion_realizada:true,referencia:'Recibo QA'})
  assert.equal(r.vtds[0].estado,'RETORNO_PENDIENTE');assert.equal(await stock(),beforeReject)
  const refunds=Number((await db.query("select count(*) n from public.movimiento_caja where venta_id=991002 and tipo='ANULACION'")).rows[0].n)
  await rpc('rechazar',op2,{venta_id:991002,motivo:'Cliente desistió',devolucion_realizada:true,referencia:'Recibo QA'})
  assert.equal(Number((await db.query("select count(*) n from public.movimiento_caja where venta_id=991002 and tipo='ANULACION'")).rows[0].n),refunds)
  await rpc('completar',op2);assert.equal((await rpc('actual')).operacion,null,'La caja se libera y el retorno continúa en Almacén')
  await claims(uid(40));r=await rpc('consultar_vtd',null,{venta_id:991002});d=r.vtds[0]
  await assert.rejects(()=>rpc('recibir_retorno',null,{venta_id:991002,version:d.version,cantidades:[]}),/recepción completa/)
  await rpc('recibir_retorno',null,{venta_id:991002,version:d.version,cantidades:cantidades(d)})
  assert.equal(await stock(),beforeReject+4)
  await rpc('recibir_retorno',null,{venta_id:991002,version:d.version,cantidades:cantidades(d)});assert.equal(await stock(),beforeReject+4)
  // Rechazo antes de salida/cobro: no inventa retorno.
  const op3='10000000-0000-0000-0000-000000000003'
  await claims(uid(2));await rpc('vincular',op3,{vtd_ids:[991003],borrador:{cart:[{id:999}]}})
  r=await rpc('rechazar',op3,{venta_id:991003,motivo:'Solicitud cancelada'})
  assert.equal(r.vtds[0].estado,'CANCELADO')
  await assert.rejects(()=>rpc('cerrar_rechazo',op3),/productos VTA/)
  const vtaAccepted=await pay(op3,[],[{producto_id:990001,cantidad_base:1,precio_unitario:10,sucursal_origen_id:2}],[{metodo:'EFECTIVO',monto:10}])
  assert.equal(Number(vtaAccepted.total),10,'Rechazar Almacén conserva y permite cobrar la VTA aceptada')
  await rpc('completar',op3)
  // Solicitar desde Caja crea y vincula sin cobrar ni abandonar la operación.
  const live=JSON.parse(await fs.readFile(new URL('./caja-almacen.fixture.json',import.meta.url),'utf8'))
  await db.exec(live.functions.find(f=>f.name==='abrir_venta').definition)
  const op4='10000000-0000-0000-0000-000000000004'
  const solicitud={lineas:[{producto_id:990001,presentacion_id:990001,cantidad_presentacion:2,precio_unitario:10}],ubicacion_id:990001,descuento:0}
  r=await rpc('crear_vtd',op4,{solicitud,borrador:{cart:[],channel:'retail'}})
  assert.equal(r.vtds.length,1);assert.equal(Number(r.vtds[0].total),20);assert.equal(r.operacion.comprobante,null)
  assert.equal((await rpc('crear_vtd',op4,{solicitud,borrador:{cart:[]}})).vtds[0].venta_id,r.vtds[0].venta_id)
  await assert.rejects(()=>rpc('crear_vtd',op4,{solicitud:{...solicitud,descuento:1},borrador:{cart:[]}}),/otro contenido/)
  await claims(uid(41));await assert.rejects(()=>rpc('crear_vtd',op4,{solicitud,borrador:{cart:[]}},990041),/otro cajero/)
  await claims(uid(2));await rpc('rechazar',op4,{venta_id:r.vtds[0].venta_id,motivo:'Cancelar solicitud de prueba'});await rpc('cerrar_rechazo',op4)
  assert.equal((await db.query("select has_function_privilege('anon','public.operar_caja_almacen(text,uuid,bigint,jsonb)','EXECUTE') allowed")).rows[0].allowed,false)
  assert.equal((await db.query("select has_table_privilege('authenticated','public.caja_operacion_vtd','UPDATE') allowed")).rows[0].allowed,false)
  await db.exec('set role authenticated');assert.equal((await rpc('actual')).operacion,null);await db.exec('reset role')
  console.log('OK: Caja–Almacén, VTA vinculada habilitada, bloqueo persistente, un encargado, cobro único, rechazo y retorno real idempotentes')
}
