import { expect, test, type Page } from '@playwright/test'
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const seller='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
async function fixture(page:Page) {
  const writes:{name:string;body:Record<string,unknown>}[]=[]
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
    if(name==='perfil')data=[{id:actor,nombre:'Caja de prueba',email:'caja@test.invalid',rol:'cajero',activo:true}]
    if(name==='sesion_caja')data=[{id:900,caja_id:1,caja:{nombre:'Caja Tienda'},estado:'ABIERTA',cajero_id:actor,monto_apertura:0,abierta_en:new Date().toISOString()}]
    if(name==='vendedores_caja')data=[{id:seller,nombre:'Ana de prueba'}]
    if(name==='consultar_saldo_disponible')data={sinCuenta:true,disponible:0}
    if(name==='v_vtd_por_cobrar')data=[{venta_id:13,numero:'VTD-2026-0013',total:150,estado:'COMPLETADA',pago_posterior:true,cobro_exigible:true,creado_en:new Date().toISOString()}]
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
    if(name==='registrar_cobro_cation'){writes.push({name,body});data={movementId:44,pagoId:45}}
    if(name==='venta')data=[{id:14,numero:'VTA-TEST',estado:'COMPLETADA',creado_en:new Date().toISOString(),total:20,subtotal:20,descuento_total:0}]
    if(name==='venta_pago')data=[{metodo:'EFECTIVO',monto:20,estado_verificacion:'NO_APLICA'}]
    if(request.headers().accept?.includes('vnd.pgrst.object') && Array.isArray(data))data=data[0]??null
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'content-range':'0-0/1'}})
  })
  return writes
}
async function normalItem(page:Page){
  await page.getByRole('button',{name:'+ Ítem personalizado',exact:true}).click()
  await page.getByLabel('Descripción',{exact:true}).fill('Servicio de mostrador')
  await page.getByLabel('Precio unitario (Bs)',{exact:true}).fill('20')
  await page.getByLabel('Precio unitario (Bs)',{exact:true}).press('Tab')
  await page.getByRole('button',{name:'Agregar al carrito',exact:true}).click()
}
async function addVtd(page:Page){
  await page.getByRole('button',{name:/\+ Agregar VTD/}).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button',{name:'Agregar (1)',exact:true}).click()
}
test('mostrador y VTD: un pago, selector de vendedor y un documento',async({page})=>{
  const writes=await fixture(page);await page.goto('/')
  await normalItem(page);await addVtd(page)
  await page.getByLabel('Venta realizada por',{exact:true}).selectOption(seller)
  const help=page.getByRole('button',{name:'Mostrar ayuda de pedidos y VTD'})
  await expect(help).toHaveAttribute('aria-expanded','false')
  await page.locator('.cart-panel').screenshot({path:'.ui-review.local/cart-acciones-compactas.png'})
  await page.locator('.cart-source-controls').screenshot({path:'.ui-review.local/cart-botones-compactos.png'})
  await help.focus();await page.keyboard.press('Enter')
  await expect(page.getByRole('button',{name:'Ocultar ayuda de pedidos y VTD'})).toHaveAttribute('aria-expanded','true')
  await expect(page.getByText('Cóbrala junto a los productos de esta venta.')).toBeVisible()
  await page.locator('.cart-panel').screenshot({path:'.ui-review.local/cart-acciones-desplegadas.png'})
  await page.locator('.cart-source-controls').screenshot({path:'.ui-review.local/cart-botones-con-ayuda.png'})
  await page.keyboard.press('Enter')
  await expect(page.getByText('Cóbrala junto a los productos de esta venta.')).toBeHidden()
  await page.screenshot({path:'.ui-review.local/checkout-carrito-desktop.png',fullPage:true})
  await page.getByRole('button',{name:/Cobrar todo/}).click()
  await expect(page.locator('.payment-total')).toContainText('170,00')
  await page.screenshot({path:'.ui-review.local/checkout-pago-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Confirmar cobro',exact:true}).click()
  await expect(page.getByRole('heading',{name:'¡Cobro confirmado!'})).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0].body).toMatchObject({p_vtd_ids:[13],p_vendedor_id:seller,p_pagos:[{metodo:'EFECTIVO',monto:170,recibido:170}]})
  await page.getByRole('button',{name:'Imprimir ticket'}).click()
  await expect(page.locator('.ticket')).toContainText('CJA-20261007-1')
  await expect(page.locator('.ticket')).toContainText('VTD-2026-0013')
  await page.screenshot({path:'.ui-review.local/checkout-comprobante.png',fullPage:true})
})
test('verificar pedido lo agrega al carrito y se cobra con mostrador y VTD',async({page})=>{
  const writes=await fixture(page);await page.goto('/');await normalItem(page)
  await page.getByRole('button',{name:/\+ Pedido de vendedor/}).click()
  await page.getByRole('button',{name:/Ana de prueba/}).click()
  await page.screenshot({path:'.ui-review.local/checkout-verificacion.png',fullPage:true})
  await expect(page.getByRole('button',{name:'Continuar en carrito'})).toBeDisabled()
  await page.getByRole('button',{name:/Verificar: Sello solicitado/}).click()
  await page.getByRole('button',{name:'Continuar en carrito'}).click()
  await expect(page.locator('.cart-pedido-group')).toContainText('Sello solicitado')
  await addVtd(page)
  await page.getByRole('button',{name:/Cobrar todo/}).click()
  await expect(page.locator('.payment-total')).toContainText('210,00')
  await page.getByRole('button',{name:'Confirmar cobro',exact:true}).click()
  await expect(page.getByRole('heading',{name:'¡Cobro confirmado!'})).toBeVisible()
  expect(writes).toHaveLength(1);expect(writes[0].body).toMatchObject({p_pedido_ids:[9],p_vtd_ids:[13]})
  expect((writes[0].body.p_lineas as Record<string,unknown>[])[1]).toMatchObject({pedido_linea_id:31,verificada:true})
})
test('registrar pago en móvil respeta el pedido y su importe pendiente',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  const writes=await fixture(page);await page.goto('/')
  await page.getByRole('button',{name:'Registrar pago',exact:true}).click()
  await page.getByLabel('Buscar cliente para registrar pago').fill('Cliente')
  await page.getByRole('button',{name:/Cliente de prueba/}).click()
  await page.getByRole('button',{name:'Sobre un pedido específico'}).click()
  await page.getByRole('combobox',{name:'Pedido',exact:true}).selectOption('5')
  await page.getByRole('combobox',{name:'Método de pago',exact:true}).selectOption('qr')
  await expect(page.getByLabel('Monto (Bs)',{exact:true})).toHaveValue('40')
  await expect(page.getByRole('button',{name:'Confirmar pago',exact:true})).toBeInViewport()
  await page.screenshot({path:'.ui-review.local/checkout-registrar-pago-movil.png'})
  await page.getByRole('button',{name:'Confirmar pago',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Pago registrado',exact:true})).toBeVisible()
  expect(writes[0].body).toMatchObject({p_pedido_id:5,p_cliente_id:83,p_monto:40,p_metodo:'QR'})
})
test('pedido específico: informa una actualización pendiente y recupera la consulta',async({page})=>{
  const writes=await fixture(page)
  let consultas=0
  await page.route('**/rest/v1/rpc/pedidos_cobro_cliente',async route=>{
    const first=consultas++===0
    await route.fulfill({status:first?404:200,contentType:'application/json',body:JSON.stringify(first?{code:'PGRST202',message:'Function missing from schema cache'}:[{id:5,numero:'PED-2026-0005',pendiente:40}])})
  })
  await page.goto('/')
  await page.getByRole('button',{name:'Registrar pago',exact:true}).click()
  await page.getByLabel('Buscar cliente para registrar pago').fill('Cliente')
  await page.getByRole('button',{name:/Cliente de prueba/}).click()
  await page.getByRole('button',{name:'Sobre un pedido específico'}).click()
  await expect(page.getByRole('alert')).toContainText('Falta activar la actualización')
  await expect(page.getByLabel('Monto (Bs)',{exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'Confirmar pago',exact:true})).toBeDisabled()
  await page.getByRole('button',{name:'Reintentar pedidos'}).click()
  await page.getByRole('combobox',{name:'Pedido',exact:true}).selectOption('5')
  await expect(page.getByText(/Pendiente de este pedido:/)).toContainText('40,00')
  await page.getByLabel('Monto (Bs)',{exact:true}).fill('50')
  await page.getByLabel('Monto (Bs)',{exact:true}).press('Tab')
  await expect(page.getByText(/Supera el pendiente del pedido/)).toContainText('10,00')
  await page.screenshot({path:'.ui-review.local/registrar-pago-pedido-especifico.png',fullPage:true})
  expect(consultas).toBe(2);expect(writes).toHaveLength(0)
})
