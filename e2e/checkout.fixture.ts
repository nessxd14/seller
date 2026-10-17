import { type Page } from '@playwright/test'
import type { CajaAlmacenRecord } from '../src/application/shared/cajaAlmacen'
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const seller='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
export async function fixture(page:Page, options: { openVtd?: boolean; products?: boolean } = {}) {
  const writes:{name:string;body:Record<string,unknown>}[]=[]
  const runtimeErrors: string[]=[]
  page.on('pageerror',e=>runtimeErrors.push(e.message))
  page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Maximum update depth'))runtimeErrors.push(m.text())})
  let warehouse: CajaAlmacenRecord = { operacion: null, vtds: [] }
  await page.addInitScript(id=>{
    const encode=(v:object)=>btoa(JSON.stringify(v)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_')
    const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp:4102444800,role:'authenticated'})}.test`
    localStorage.setItem('sb-zxoxougwgstrarwymlvd-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id,email:'caja@test.invalid',app_metadata:{provider:'email'},user_metadata:{}}}))
  },actor)
  await page.routeWebSocket('**/*.supabase.co/**',ws=>ws.close())
  await page.route('https://*.supabase.co/**',async route=>{
    const request=route.request();const name=new URL(request.url()).pathname.split('/').pop()!
    const body=request.method()==='POST'?request.postDataJSON():{}
    let data:unknown=[]
    if(options.products && name==='producto')data=[{id:44,nombre:'Material de Almacén QA',sku_interno:'QA-44',unidad_base:'UNIDAD',precio_base:150,activo:true}]
    if(options.products && name==='presentacion')data=[{id:44,producto_id:44,nombre:'Unidad',es_base:true,activo:true,factor_unidad_base:1}]
    if(options.products && name==='ubicacion')data=[{id:31,sucursal_id:1,codigo_zona:'VENTAS DIRECTAS'}]
    if(name==='perfil')data=[{id:actor,nombre:'Caja de prueba',email:'caja@test.invalid',rol:'cajero',activo:true}]
    if(name==='sesion_caja')data=[{id:900,caja_id:1,caja:{nombre:'Caja Tienda'},estado:'ABIERTA',cajero_id:actor,monto_apertura:0,abierta_en:new Date().toISOString()}]
    if(name==='vendedores_caja')data=[{id:seller,nombre:'Ana de prueba'}]
    if(name==='consultar_saldo_disponible')data={sinCuenta:true,disponible:0}
    if(name==='v_vtd_por_cobrar')data=[{venta_id:13,numero:'VTD-2026-0013',total:150,estado:options.openVtd ? 'ABIERTA' : 'COMPLETADA',pago_posterior:!options.openVtd,cobro_exigible:true,creado_en:new Date().toISOString()}]
    if(name==='pedidos_vendedor_cola')data=[{pedido_id:9,codigo:'PDV-9',numero_dia:3,estado:'ENVIADO',vendedor:'Ana de prueba',total:40,lineas:1,enviado_en:new Date().toISOString()}]
    if(name==='tomar_pedido_vendedor')data={pedido_id:9,codigo:'PDV-9',numero_dia:3,fecha:'2026-10-07',estado:'EN_CAJA',vendedor:'Ana de prueba',nota:'Revisar cantidad y precio',total:40,lineas:[{linea_id:31,orden:1,producto_id:null,nombre:'Sello solicitado',es_personalizado:true,unidad_medida:'UNIDAD',cantidad:2,precio_unitario:20,subtotal:40,es_base:true,factor:1}]}
    if(name==='cliente')data=[{id:83,nombre:'Cliente de prueba',tipo_precio:'mayorista',documento:'TEST',activo:true}]
    if(name==='consultar_hermes_pos')data=body.p_operacion==='saldo'?{saldo_confirmado:100,saldo_provisional:40,situacion:'DEUDOR'}:[]
    if(name==='pedidos_cobro_cliente')data=[{id:5,numero:'PED-2026-0005',pendiente:40}]
    if(name==='estado_banco_qr')data={en_linea:false}
    if(['registrar_venta','cobrar_vtd','cobrar_pedido_vendedor'].includes(name)) throw Error('El navegador intentó un cobro separado: '+name)
    if(name==='checkout_caja'){
      writes.push({name,body})
      data={id:1,numero:'CJA-20261007-1',total:body.p_pedido_ids.length?210:170,ventas:[14,13],vendedor:'Ana de prueba',cliente:null,creado_en:new Date().toISOString(),lineas:[{descripcion:'Servicio de mostrador',cantidad:1,precio:20,subtotal:20,origen:'Mostrador'},...(body.p_pedido_ids.length?[{descripcion:'Sello solicitado',cantidad:2,precio:20,subtotal:40,origen:'Mostrador'}]:[]),{descripcion:'Producto VTD',cantidad:15,precio:10,subtotal:150,origen:'VTD-2026-0013'}],pagos:body.p_pagos,descuento:0,saldo_favor:0,cambio:0}
    }
    if(name==='operar_caja_almacen') {
      if(body.p_accion==='crear_vtd') {
        writes.push({name,body})
        warehouse={operacion:{id:body.p_operacion_id,sesion_id:900,cajero_id:actor,revision:1,estado:'ACTIVA',comprobante:null,cerrado_en:null,borrador:body.p_datos.borrador},vtds:[{venta_id:13,numero:'VTD-2026-0013',total:150,cliente_id:null,cliente:null,version:0,estado:'SOLICITADO'}]}
      }
      if(body.p_accion==='vincular') warehouse={operacion:{id:body.p_operacion_id,sesion_id:900,cajero_id:actor,revision:1,estado:'ACTIVA',comprobante:null,cerrado_en:null,borrador:body.p_datos.borrador},vtds:[{venta_id:13,numero:'VTD-2026-0013',total:150,cliente_id:null,cliente:null,version:0,estado:options.openVtd?'SOLICITADO':'ENTREGADO'}]}
      if(body.p_accion==='guardar'&&warehouse.operacion){warehouse.operacion.borrador=body.p_datos.borrador;warehouse.operacion.revision++}
      if(body.p_accion==='completar'&&warehouse.operacion){warehouse.operacion.estado='COMPLETADA';warehouse.operacion.cerrado_en=new Date().toISOString()}
      data=warehouse.operacion?.cerrado_en && body.p_accion==='actual' ? {operacion:null,vtds:[]} : warehouse
    }
    if(name==='checkout_caja'&&warehouse.operacion){warehouse.operacion.comprobante={id:1,numero:'CJA-20261007-1',total:170};warehouse.operacion.estado='COBRADA';warehouse.operacion.revision++}
    if(name==='registrar_cobro_cation'){writes.push({name,body});data={movementId:44,pagoId:45}}
    if(name==='venta')data=[{id:14,numero:'VTA-TEST',estado:'COMPLETADA',creado_en:new Date().toISOString(),total:20,subtotal:20,descuento_total:0}]
    if(name==='venta_pago')data=[{metodo:'EFECTIVO',monto:20,estado_verificacion:'NO_APLICA'}]
    if(request.headers().accept?.includes('vnd.pgrst.object') && Array.isArray(data))data=data[0]??null
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'content-range':'0-0/1'}})
  })
  return Object.assign(writes, { runtimeErrors, deliver: () => { warehouse.vtds.forEach(v => { v.estado = 'EN_CAJA' }) } })
}
export async function normalItem(page:Page){
  await page.getByRole('button',{name:'+ Ítem personalizado',exact:true}).click()
  await page.getByLabel('Descripción',{exact:true}).fill('Servicio de mostrador')
  await page.getByLabel('Precio unitario (Bs)',{exact:true}).fill('20')
  await page.getByLabel('Precio unitario (Bs)',{exact:true}).press('Tab')
  await page.getByRole('button',{name:'Agregar al carrito',exact:true}).click()
}
export async function addVtd(page:Page){
  await page.getByRole('button',{name:/\+ Agregar VTD/}).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Agregar (1)',exact:true}).click()
}
