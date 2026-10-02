import { expect, test, type Page } from '@playwright/test'

// Datos sintéticos e HTTP interceptado: jamás genera movimientos en las bases reales.
const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const openedAt = '2026-10-02T12:00:00Z'
const turno = { id: 900, caja_id: 1, caja: { nombre: 'Caja Tienda' }, estado: 'ABIERTA', monto_apertura: 500, cajero_id: userId, abierta_por: 'Cajero de prueba', abierta_en: openedAt, cerrada_en: null, diferencia_relevo: null }
const summary = { apertura: 500, ventas: { EFECTIVO: 120, QR: 80 }, ventas_retail: { EFECTIVO: 120 }, ventas_vtd: { QR: 80 }, cantidad_vtd_cobradas: 1, vtd_por_cobrar: { cantidad: 0, total: 0 }, anticipos: { EFECTIVO: 350 }, anulaciones: {}, gastos: { aprobado: 25 }, remesas: 0, inyecciones: 0, cantidad_ventas: 1, pagos_pendientes_verificacion: 0, pagos_rechazados: [], diferencia_relevo: null, esperado_efectivo: 945 }
const movements = [
  { id: 903, tipo: 'EGRESO', subtipo: 'GASTO', metodo: 'EFECTIVO', monto: 25, nota: 'Flete', creado_en: openedAt, cliente: null, pedido: null, venta: null, caja_gasto: { motivo: 'Flete a Carlos por entrega PED-PRUEBA-001', estado: 'APROBADO', comprobante_path: null } },
  { id: 902, tipo: 'ANTICIPO', subtipo: null, metodo: 'EFECTIVO', monto: 350, nota: 'Anticipo sin imputar', creado_en: openedAt, cliente: { nombre: 'Cliente con un nombre muy largo para comprobar el ajuste de texto en móvil' }, pedido: null, venta: null, caja_gasto: null },
  { id: 901, tipo: 'VENTA', subtipo: null, metodo: 'EFECTIVO', monto: 120, nota: '', creado_en: openedAt, cliente: null, pedido: null, venta: { numero: 'VTA-PRUEBA-001' }, caja_gasto: null },
]

async function fixture(page: Page, role = 'gerente', initialOpen = true, authenticate = true, lostPaymentResponse = false, lostExpenseResponse = false) {
  let open = initialOpen
  const writes: { name: string; body: Record<string, unknown> }[] = []
  if (authenticate) await page.addInitScript(({ id, role }) => {
    const encode = (v: object) => btoa(JSON.stringify(v)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: 4102444800, role: 'authenticated' })}.test`
    localStorage.setItem('sb-zxoxougwgstrarwymlvd-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id, email: 'prueba@example.test', app_metadata: { provider: 'email' }, user_metadata: { role } } }))
  }, { id: userId, role })
  await page.routeWebSocket('**/*.supabase.co/**', (ws) => ws.close())
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const name = url.pathname.split('/').pop()!
    const rpc = url.pathname.includes('/rpc/')
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
    let data: unknown = []
    if (name === 'perfil') data = [{ id: userId, nombre: 'Usuario de prueba local', email: 'prueba@example.test', rol: role, activo: true }]
    if (name === 'sesion_caja') data = open ? [turno] : []
    if (name === 'movimiento_caja') data = url.searchParams.get('select') === 'venta_id' ? [{ venta_id: 1 }] : movements
    if (name === 'venta') data = [{ id: 1, numero: 'VTA-PRUEBA-001', total: 120, creado_en: openedAt }]
    if (name === 'venta_pago') data = [{ venta_id: 1, metodo: 'EFECTIVO', monto: 120, estado_verificacion: 'VERIFICADO' }]
    if (name === 'cliente') data = [{ id: 83, nombre: 'Cliente de prueba', tipo_precio: 'MINORISTA', documento: '123456', activo: true }]
    if (name === 'resumen_turno') data = { ...summary, esperado_efectivo: role === 'cajero' ? null : summary.esperado_efectivo }
    if (name === 'estado_banco_qr') data = { ultimo_latido: openedAt, minutos_desde: 0, en_linea: true }
    if (name === 'consultar_hermes_pos') data = body.p_operacion === 'saldo' ? { saldo_confirmado: 350, saldo_provisional: 350, situacion: 'DEUDOR' } : []
    if (rpc && ['abrir_turno', 'registrar_movimiento_turno', 'registrar_cobro_hermes'].includes(name)) {
      writes.push({ name, body })
      if (name === 'abrir_turno') { open = true; data = { sesion_id: 900 } }
      if (name === 'registrar_movimiento_turno') data = { movimiento_id: 904, gasto_id: 1 }
      if (name === 'registrar_cobro_hermes') data = { movementId: 905, pagoId: 906, saldoProvisional: 0 }
      if (name === 'registrar_cobro_hermes' && lostPaymentResponse && writes.filter((w) => w.name === name).length === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'Respuesta perdida de prueba' }) })
        return
      }
      if (name === 'registrar_movimiento_turno' && lostExpenseResponse && writes.filter((w) => w.name === name).length === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'Respuesta perdida del gasto' }) })
        return
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'content-range': '0-0/1' } })
  })
  return writes
}

test('gerente ve ventas, anticipos y gastos del mismo turno en escritorio', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pagos y anticipos de clientes' })).toBeVisible()
  await expect(page.getByText('Flete a Carlos por entrega PED-PRUEBA-001')).toBeVisible()
  await expect(page.getByText('Anticipo sin imputar')).toBeVisible()
  const advances = page.locator('details').filter({ has: page.getByRole('heading', { name: 'Pagos y anticipos de clientes' }) })
  await advances.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(advances.getByText('Efectivo', { exact: true })).toBeVisible()
  await expect(advances.getByText('Incluidos en los ingresos de este turno; separados de las ventas.')).toBeVisible()
  await page.keyboard.press('Enter')
  await page.screenshot({ path: '.ui-review.local/caja-desktop.png', fullPage: true })
  await page.getByRole('combobox', { name: 'Filtrar movimientos' }).selectOption('ANTICIPO')
  await expect(page.getByText('Anticipo sin imputar')).toBeVisible()
  await expect(page.getByText('Flete a Carlos por entrega PED-PRUEBA-001')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Filtrar movimientos' }).selectOption('REMESA')
  await expect(page.getByRole('status')).toContainText('No hay movimientos de este tipo')
  await page.getByRole('button', { name: 'Ver todos los movimientos' }).click()
  await expect(page.getByText('Flete a Carlos por entrega PED-PRUEBA-001')).toBeVisible()
})

test('móvil permite inspeccionar el turno sin desbordar ni ocultar el detalle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Actividad del turno' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
  await page.screenshot({ path: '.ui-review.local/caja-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Turnos', exact: true }).click()
  await page.getByRole('button', { name: /Caja Tienda · #900/ }).click()
  await expect(page.getByText('Anticipo sin imputar')).toBeVisible()
  await page.setViewportSize({ width: 360, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('heading', { name: 'Actividad del turno' }).scrollIntoViewIfNeeded()
  const navigation = await page.getByRole('navigation', { name: 'Vistas de caja' }).boundingBox()
  expect(navigation!.y).toBeGreaterThanOrEqual(76)
  expect(navigation!.y + navigation!.height).toBeLessThan(200)
  await page.getByRole('button', { name: 'En vivo', exact: true }).click()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.getByText('Turno #900', { exact: true })).toBeVisible()
})

test('apertura del cajero conserva el conteo ciego y registra denominaciones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const writes = await fixture(page, 'cajero', false)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Cuenta el efectivo recibido' })).toBeVisible()
  const hundreds = page.getByLabel('Cantidad de billetes/monedas de 100', { exact: true })
  await hundreds.fill('2'); await hundreds.press('Tab')
  await page.screenshot({ path: '.ui-review.local/caja-apertura-mobile.png', fullPage: true })
  const halfCoins = page.getByLabel('Cantidad de billetes/monedas de 0.5', { exact: true })
  await halfCoins.fill('4'); await halfCoins.press('Tab')
  await expect(page.locator('.cash-opening-count > footer').getByText('Bs 202,00', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Abrir mi turno' }).click()
  await expect(page.getByRole('heading', { name: 'Actividad del turno' })).toBeVisible()
  expect(writes.filter((w) => w.name === 'abrir_turno')).toHaveLength(1)
  expect(writes.find((w) => w.name === 'abrir_turno')?.body).toMatchObject({ p_caja_id: 1, p_denominaciones: { '100': 2, '0.5': 4 } })
  await expect(page.getByText('Efectivo esperado', { exact: true })).toHaveCount(0)
})

test('un gasto exige detalle y conserva monto, motivo e idempotencia', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined }) })
  const writes = await fixture(page, 'gerente', true, true, false, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Mi caja', exact: true }).click()
  await page.getByRole('button', { name: 'Registrar gasto', exact: true }).click()
  await page.getByLabel('Monto (Bs)', { exact: true }).fill('25')
  await page.getByLabel('Monto (Bs)', { exact: true }).press('Tab')
  await page.getByLabel('Detalle del gasto').fill('Taxi')
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeDisabled()
  await page.getByLabel('Detalle del gasto').fill('Flete a Carlos por entrega PED-PRUEBA-001')
  await page.screenshot({ path: '.ui-review.local/caja-gasto-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No se pudo registrar el movimiento')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Registrar gasto', exact: true })).toHaveCount(0)
  const movement = writes.find((w) => w.name === 'registrar_movimiento_turno')
  expect(movement?.body).toMatchObject({ p_sesion_id: 900, p_subtipo: 'GASTO', p_monto: 25, p_motivo: 'Flete a Carlos por entrega PED-PRUEBA-001' })
  expect(String(movement?.body.p_idempotencia)).toHaveLength(36)
  const attempts = writes.filter((w) => w.name === 'registrar_movimiento_turno')
  expect(attempts).toHaveLength(2)
  expect(attempts[1].body.p_idempotencia).toBe(attempts[0].body.p_idempotencia)
})

test('login móvil mantiene controles legibles y requiere sesión', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page, 'gerente', false, false)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Tu caja, donde estés.' })).toBeVisible()
  expect(await page.getByLabel('Correo de Seller').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px')
  await page.screenshot({ path: '.ui-review.local/caja-login-mobile.png', fullPage: true })
})

test('Seller comparte el desglose y permite volver del diálogo al botón de gasto', async ({ page }) => {
  await fixture(page)
  await page.goto('http://127.0.0.1:5180')
  await page.getByRole('button', { name: 'Caja', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pagos y anticipos de clientes' })).toBeVisible()
  await page.screenshot({ path: '.ui-review.local/seller-caja-desktop.png', fullPage: true })
  const expense = page.getByRole('button', { name: 'Registrar gasto', exact: true })
  await expense.click()
  await expect(page.getByRole('dialog', { name: 'Registrar gasto' })).toBeVisible()
  await page.getByLabel('Detalle del gasto').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Registrar gasto' })).toHaveCount(0)
  await expect(expense).toBeFocused()
})

test('cajero registra pago en la cartera actual y reintenta sin cambiar su clave', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined }) })
  const writes = await fixture(page, 'cajero', true, true, true)
  await page.goto('http://127.0.0.1:5180')
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click()
  await page.getByLabel('Buscar cliente para registrar pago').fill('Cliente')
  await page.getByRole('button', { name: /Cliente de prueba/ }).click()
  await page.getByLabel('Monto (Bs)', { exact: true }).fill('25')
  await page.getByLabel('Monto (Bs)', { exact: true }).press('Tab')
  await page.getByLabel(/Dejar como anticipo/).check()
  await page.getByRole('button', { name: 'Confirmar pago', exact: true }).click()
  await expect(page.getByText('Respuesta perdida de prueba')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar pago', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pago registrado', exact: true })).toBeVisible()
  const attempts = writes.filter((w) => w.name === 'registrar_cobro_hermes')
  expect(attempts).toHaveLength(2)
  expect(attempts[0].body).toMatchObject({ p_cliente_id: 83, p_sesion_id: 900, p_monto: 25, p_no_imputar: true })
  expect(attempts[1].body.p_idempotencia).toBe(attempts[0].body.p_idempotencia)
})
