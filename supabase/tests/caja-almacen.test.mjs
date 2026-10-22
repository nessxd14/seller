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
  // Disponibilidad parcial: Almacén reporta faltante y Caja ajusta la VTD y devuelve la diferencia.
  // En producción `en_espera` llegó por una migración manual posterior a la del repo.
  await db.exec('alter table public.caja_operacion_almacen add column if not exists en_espera boolean not null default false')
  await db.exec(await fs.readFile(new URL('../migrations/20261022170000_caja_almacen_ajuste_faltante.sql',import.meta.url),'utf8'))
  await db.exec(`insert into public.venta(id,numero,total,subtotal,estado,cobro_exigible,ubicacion_id,sesion_caja_id) values
      (992001,'VTD-TEST-AJ1',240,240,'ABIERTA',true,990001,900001),(992002,'VTD-TEST-AJ2',240,240,'ABIERTA',true,990001,900001),
      (992003,'VTD-TEST-AJ3',240,240,'ABIERTA',true,990001,900001),(992004,'VTD-TEST-AJ4',240,240,'ABIERTA',true,990001,900001),
      (992005,'VTD-TEST-AJ5',240,240,'ABIERTA',true,990001,900001);
    insert into public.venta_linea(venta_id,producto_id,presentacion_id,cantidad,cantidad_presentacion,precio_unitario)
      select id,990001,990001,6,6,40 from public.venta where id between 992001 and 992005;`)
  const linea=async id=>Number((await db.query('select id from public.venta_linea where venta_id=$1',[id])).rows[0].id)
  const ajustar=(opId,vid,version,lineas,devolucion,motivo='Faltante en Almacén')=>rpc('ajustar',opId,{venta_id:vid,version,motivo,lineas,...(devolucion?{devolucion}:{})})
  const faltante=async(vid,disp,motivo='Solo hay 5 en estante')=>{await claims(uid(40));const cur=(await rpc('escanear',null,{venta_id:vid})).vtds[0];const l=await linea(vid);return {cur,l,r:await rpc('reportar_faltante',null,{venta_id:vid,version:cur.version,disponibles:[{linea_id:l,cantidad_presentacion:disp}],motivo})}}
  const mov=async vid=>(await db.query("select metodo::text m,monto::float8 monto from public.movimiento_caja where venta_id=$1 and tipo='ANULACION' order by id",[vid])).rows
  const stockBefore=await stock()
  const despachar=async vid=>{await claims(uid(40));const x=(await rpc('consultar_vtd',null,{venta_id:vid})).vtds[0];await rpc('enviar',null,{venta_id:vid,version:x.version,cantidades:cantidades(x)});await claims(uid(2))}
  // A: cobrada, devolución en EFECTIVO.
  const opA='10000000-0000-0000-0000-0000000000a1'
  await claims(uid(2));await rpc('vincular',opA,{vtd_ids:[992001],borrador:{cart:[]}});const recA=await pay(opA,[992001],[],[{metodo:'EFECTIVO',monto:240}])
  let f=await faltante(992001,5);assert.equal(f.r.vtds[0].faltante[0].cantidad_presentacion_disponible,5);assert.ok(f.r.vtds[0].faltante_en)
  const rep=await rpc('reportar_faltante',null,{venta_id:992001,version:f.cur.version,disponibles:[{linea_id:f.l,cantidad_presentacion:5}],motivo:'Solo hay 5 en estante'})
  assert.equal(rep.vtds[0].version,f.cur.version+1,'Reporte idempotente: no avanza la versión dos veces')
  await assert.rejects(()=>rpc('enviar',null,{venta_id:992001,version:f.cur.version+1,cantidades:[]}),/reportó faltante/)
  await assert.rejects(()=>rpc('reportar_faltante',null,{venta_id:992001,version:f.cur.version+1,disponibles:[{linea_id:f.l,cantidad_presentacion:4}],motivo:'x'}),/motivo/)
  await claims(uid(2));const ver=f.cur.version+1
  const dev={destino:'EFECTIVO',realizada:true}
  await assert.rejects(()=>ajustar(opA,992001,ver,[{linea_id:f.l,cantidad_presentacion:7}],dev),/reducir/)
  await assert.rejects(()=>ajustar(opA,992001,ver,[{linea_id:f.l,cantidad_presentacion:0}],dev),/usa Rechazar/)
  await assert.rejects(()=>ajustar(opA,992001,ver-1,[{linea_id:f.l,cantidad_presentacion:5}],dev),/cambió/)
  await assert.rejects(()=>ajustar(opA,992001,ver,[{linea_id:f.l,cantidad_presentacion:5}]),/Confirma la devolución/)
  await assert.rejects(()=>ajustar(opA,992001,ver,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'YA_REGISTRADA',realizada:true,movimiento_id:1}),/gerente/)
  assert.equal((await mov(992001)).length,0,'Los intentos fallidos no dejan movimientos')
  r=await ajustar(opA,992001,ver,[{linea_id:f.l,cantidad_presentacion:5}],dev)
  assert.equal(Number(r.vtds[0].total),200);assert.equal(r.vtds[0].faltante,null);assert.equal(r.vtds[0].lineas[0].cantidad_presentacion,5)
  assert.deepEqual(await mov(992001),[{m:'EFECTIVO',monto:40}])
  assert.equal((await db.query("select count(*)::int n from public.venta_evento where venta_id=992001 and accion='LINEA_CAMBIADA' and cantidad_anterior=6 and cantidad_nueva=5")).rows[0].n,1)
  assert.equal(r.operacion.comprobante.total,recA.total,'El comprobante histórico no cambia')
  await claims(uid(40));d=(await rpc('consultar_vtd',null,{venta_id:992001})).vtds[0]
  r=await rpc('enviar',null,{venta_id:992001,version:d.version,cantidades:cantidades(d)});assert.equal(r.vtds[0].estado,'ENTREGADO','enviar autocompleta tras el ajuste');assert.equal(r.operacion.estado,'COMPLETADA')
  assert.equal(await stock(),stockBefore-5,'Almacén despacha 5 y la integridad de stock se conserva')
  // B: devolución por QR (distinto al pago original) exige referencia.
  const opB='10000000-0000-0000-0000-0000000000a2'
  await claims(uid(2));await rpc('vincular',opB,{vtd_ids:[992002],borrador:{cart:[]}});await pay(opB,[992002],[],[{metodo:'EFECTIVO',monto:240}])
  f=await faltante(992002,5);await claims(uid(2))
  await assert.rejects(()=>ajustar(opB,992002,f.cur.version+1,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'QR',realizada:true}),/referencia/)
  await ajustar(opB,992002,f.cur.version+1,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'QR',realizada:true,referencia:'QR-778'});await despachar(992002)
  assert.deepEqual(await mov(992002),[{m:'QR',monto:40}],'La devolución no tiene que coincidir con el medio original')
  // C: saldo a favor para un cliente con cuenta Hermes; el dinero queda en el cajón.
  const opC='10000000-0000-0000-0000-0000000000a3'
  await claims(uid(41))
  await db.exec(`insert into public.cliente(id,nombre,activo,tipo_precio) values(993001,'Cliente Hermes QA',true,'mayorista') on conflict do nothing;
    insert into hermes.cliente(id,nombre,categoria,activo,pos_cliente_id) values(993001,'Cliente Hermes QA','MAYORISTA',true,993001) on conflict do nothing;
    update public.venta set cliente_id=993001 where id=992003`)
  await claims(uid(2));await rpc('vincular',opC,{vtd_ids:[992003],borrador:{cart:[]}});await db.query("select public.checkout_caja(p_lineas=>'[]',p_pagos=>$1,p_sesion_id=>900001,p_idempotencia=>'checkout:10000000-0000-0000-0000-0000000000a3',p_vtd_ids=>$2,p_cliente_id=>993001)",[JSON.stringify([{metodo:'EFECTIVO',monto:240}]),[992003]])
  f=await faltante(992003,5);await claims(uid(2))
  await ajustar(opC,992003,f.cur.version+1,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'SALDO_FAVOR',realizada:true})
  assert.deepEqual(await mov(992003),[],'Saldo a favor no mueve el cajón');await despachar(992003)
  assert.equal(Number((await db.query("select monto from hermes.movimiento_cuenta where cliente_id=993001 and tipo='NOTA_CREDITO'")).rows[0].monto),-40)
  const opE='10000000-0000-0000-0000-0000000000a4'
  await claims(uid(2));await rpc('vincular',opE,{vtd_ids:[992004],borrador:{cart:[]}});await pay(opE,[992004],[],[{metodo:'EFECTIVO',monto:240}])
  f=await faltante(992004,5);await claims(uid(2))
  await assert.rejects(()=>ajustar(opE,992004,f.cur.version+1,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'SALDO_FAVOR',realizada:true}),/cliente registrado/)
  await ajustar(opE,992004,f.cur.version+1,[{linea_id:f.l,cantidad_presentacion:5}],{destino:'EFECTIVO',realizada:true});await despachar(992004)
  // D: operación sin cobrar: solo baja el total, sin dinero.
  const opD='10000000-0000-0000-0000-0000000000a5'
  await rpc('vincular',opD,{vtd_ids:[992005],borrador:{cart:[]}})
  const l5=await linea(992005);d=(await rpc('actual',opD)).vtds.find(x=>x.venta_id===992005)
  await assert.rejects(()=>ajustar(opD,992005,d.version,[{linea_id:l5,cantidad_presentacion:5}],{destino:'EFECTIVO',realizada:true}),/no tiene importe/)
  r=await ajustar(opD,992005,d.version,[{linea_id:l5,cantidad_presentacion:5}]);assert.equal(Number(r.vtds.find(x=>x.venta_id===992005).total),200);assert.deepEqual(await mov(992005),[])
  await rpc('rechazar',opD,{venta_id:992005,motivo:'Cierre de la prueba'});await rpc('cerrar_rechazo',opD)
  assert.equal((await db.query("select has_function_privilege('anon','caja_almacen.operar(text,uuid,bigint,jsonb)','EXECUTE') allowed")).rows[0].allowed,false)
  console.log('OK: Caja–Almacén, VTA vinculada habilitada, bloqueo persistente, un encargado, cobro único, rechazo y retorno real idempotentes; faltante y ajuste de VTD con devolución')
}
