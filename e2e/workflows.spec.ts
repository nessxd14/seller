import { expect, test } from '@playwright/test'

test('navega entre módulos principales', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Cotizaciones' }).click()
  await expect(page.getByRole('heading', { name: 'Cotizaciones' })).toBeVisible()
  await page.getByRole('button', { name: 'Pedidos' }).click()
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible()
  await page.getByRole('button', { name: 'Clientes' }).click()
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible()
  await page.getByRole('button', { name: 'Caja' }).click()
  await expect(page.getByRole('heading', { name: 'Caja' })).toBeVisible()
})

test('atajos enfocan búsqueda y agregan coincidencia exacta', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('F2')
  const search=page.getByRole('textbox',{name:'Buscar productos'})
  await expect(search).toBeFocused()
  await search.fill('777100100001')
  await search.press('Enter')
  await expect(page.getByText('1 artículos')).toBeVisible()
})

test('crea cotización mock', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Cotizaciones' }).click()
  await page.getByRole('button', { name: 'Nueva cotización' }).click()
  await page.getByRole('button', { name: 'Agregar producto' }).click()
  await page.getByRole('button', { name: 'Guardar cotización' }).click()
  await expect(page.getByText('Cotización guardada localmente')).toBeVisible()
})

test('venta Retail completa con pago mock', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button',{name:'Agregar',exact:true}).first().click()
  await page.keyboard.press('F9')
  await page.getByRole('button',{name:'QR',exact:true}).click()
  await page.getByRole('button',{name:'Confirmar cobro'}).click()
  await expect(page.getByRole('heading',{name:'¡Cobro confirmado!'})).toBeVisible()
})

test('suspende y restaura una venta', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button',{name:'Agregar',exact:true}).first().click()
  await page.keyboard.press('F8')
  await page.getByRole('button',{name:'Suspendidas'}).click()
  await page.getByRole('button',{name:'Restaurar'}).click()
  await expect(page.getByText('1 artículos')).toBeVisible()
})

test('sesión expirada e inactiva quedan bloqueadas', async ({ page }) => {
  await page.goto('/')
  const selector=page.getByLabel('Sesión mock')
  await selector.selectOption('expired')
  await expect(page.getByRole('heading',{name:'Sesión expirada'})).toBeVisible()
  await selector.selectOption('inactive')
  await expect(page.getByRole('heading',{name:'Acceso restringido'})).toBeVisible()
})

test('conflicto ofrece resolución explícita', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button',{name:'Simular conflicto'}).click()
  await expect(page.getByRole('heading',{name:'Cambios encontrados'})).toBeVisible()
  await page.getByRole('button',{name:'Conservar copia local'}).click()
  await expect(page.getByText('Copia local conservada')).toBeVisible()
})

test('cajero no puede despachar', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Sesión mock').selectOption('cajero')
  await page.getByRole('button',{name:'Pedidos'}).click()
  await expect(page.getByText('Tu rol no permite abrir este módulo')).toBeVisible()
})

test('almacén no puede vender', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Sesión mock').selectOption('almacen')
  await page.getByRole('button',{name:'Pedidos'}).click()
  await expect(page.getByRole('heading',{name:'Pedidos'})).toBeVisible()
  await page.getByRole('button',{name:'Venta',exact:true}).click()
  await expect(page.getByText('Tu rol no permite abrir este módulo')).toBeVisible()
})

test('auditor no puede crear cotizaciones', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Sesión mock').selectOption('auditor')
  await page.getByRole('button',{name:'Cotizaciones'}).click()
  await expect(page.getByRole('heading',{name:'Cotizaciones'})).toBeVisible()
  await page.getByRole('button',{name:'Nueva cotización'}).click()
  await expect(page.getByText('Modo solo lectura')).toBeVisible()
})

test('convierte cotización, crea pedido y bloquea edición', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button',{name:'Cotizaciones'}).click()
  const row=page.locator('article').filter({hasText:'COT-2026-0042'})
  page.once('dialog',(dialog)=>dialog.accept())
  await row.getByTitle('Convertir en pedido').click()
  await expect(page.getByRole('heading',{name:'Pedidos'})).toBeVisible()
  await page.getByRole('button',{name:'Cotizaciones'}).click()
  const converted=page.locator('article').filter({hasText:'COT-2026-0042'})
  await expect(converted.getByText('Convertida')).toBeVisible()
  await expect(converted.getByRole('button',{name:'Editar'})).toBeDisabled()
})

test('almacén realiza despacho parcial mock desde dos ubicaciones', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Sesión mock').selectOption('almacen')
  await page.getByRole('button',{name:'Pedidos'}).click()
  await page.locator('.order-card').filter({hasText:'PED-2026-0187'}).click()
  await expect(page.locator('.allocation-bars').getByText('Almacén',{exact:true})).toBeVisible()
  await expect(page.locator('.allocation-bars').getByText('Tienda',{exact:true})).toBeVisible()
  page.once('dialog',(dialog)=>dialog.accept())
  await page.getByRole('button',{name:'Despacho parcial'}).click()
  await expect(page.locator('.toast').getByText('Despacho parcial simulado')).toBeVisible()
})

for (const scenario of [{name:'sobrante',counted:'510'},{name:'faltante',counted:'490'}]) {
  test(`cierre de caja con ${scenario.name}`, async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Sesión mock').selectOption('cajero')
    await page.getByRole('button',{name:'Caja'}).click()
    await page.getByRole('button',{name:'Abrir Caja 01'}).click()
    await page.getByRole('button',{name:'Confirmar apertura'}).click()
    await page.getByRole('button',{name:'Cerrar caja'}).click()
    await page.getByLabel('Efectivo contado (Bs)').fill(scenario.counted)
    await expect(page.getByText(scenario.name==='sobrante'?'Sobrante':'Faltante')).toBeVisible()
    page.once('dialog',(dialog)=>dialog.accept())
    await page.getByRole('button',{name:'Confirmar cierre'}).click()
    await expect(page.getByText('Cierre guardado en historial local')).toBeVisible()
  })
}

test('pago mixto mock cubre exactamente el total', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button',{name:'Agregar',exact:true}).first().click()
  await page.keyboard.press('F9')
  await page.getByRole('button',{name:'Pago mixto'}).click()
  await expect(page.getByText('El monto coincide con el total')).toBeVisible()
  await page.getByRole('button',{name:'Confirmar cobro'}).click()
  await expect(page.getByRole('heading',{name:'¡Cobro confirmado!'})).toBeVisible()
})
