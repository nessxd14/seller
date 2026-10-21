import { expect, test } from '@playwright/test'
import { fixture, normalItem } from './checkout.fixture'

test('cantidad, precio manual y presentación conservan sus reglas en la lista ligera', async ({ page }) => {
  const writes = await fixture(page, { products: true })
  await page.route('**/rest/v1/v_presentacion_precio?**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify([
      { presentacion_id: 44, producto_id: 44, nombre: 'Unidad', es_base: true, activo: true, factor_unidad_base: 1, precio_retail: 150, precio_mayoreo: 150, precio_institucion: 150, precio_corporativo: 150 },
      { presentacion_id: 45, producto_id: 44, nombre: 'Paquete', es_base: false, activo: true, factor_unidad_base: 500, precio_retail: 70000, precio_mayoreo: 65000, precio_institucion: 65000, precio_corporativo: 65000, tiene_precio_propio: true },
      { presentacion_id: 46, producto_id: 44, nombre: 'Caja solo Almacén', es_base: false, activo: true, factor_unidad_base: 1000, vende_tienda: false, vende_almacen: true },
    ]),
  }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Agregar Material de Almacén QA', exact: true }).click()
  const row = page.locator('.cart-item-light')
  await row.getByRole('button', { name: 'Editar cantidad: 1' }).click()
  await row.getByRole('spinbutton', { name: 'Cantidad', exact: true }).fill('3')
  await row.getByRole('spinbutton', { name: 'Cantidad', exact: true }).press('Enter')
  await expect(row.locator('.line-total')).toContainText('450,00')
  await row.locator('[data-line-action="price"]').click()
  await row.getByLabel('Precio unitario Material de Almacén QA', { exact: true }).fill('20')
  await row.getByLabel('Precio unitario Material de Almacén QA', { exact: true }).press('Enter')
  await expect(row.locator('.cart-manual-price')).toBeVisible()
  await expect(row.locator('.line-price-warning')).toContainText('Precio muy bajo')
  await expect(row.getByRole('option', { name: 'Caja solo Almacén', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Mayoreo Precio mayorista/ }).click()
  await expect(row.locator('.line-total')).toContainText('60,00')
  await row.getByLabel('Presentación Material de Almacén QA').selectOption('45')
  await expect(row.locator('.line-equivalence')).toContainText('3 Paquete = 1.500 Unidad')
  await expect(row.locator('.line-total')).toContainText('195.000,00')
  await expect(row.locator('.cart-manual-price')).toHaveCount(0)
  await expect(row.locator('.line-price-warning')).toHaveCount(0)
  await row.getByRole('button', { name: 'Editar Material de Almacén QA', exact: true }).click()
  await expect(page.getByLabel('Precio configurado', { exact: true })).toHaveValue('Bs 65000.00')
  expect(writes).toHaveLength(0)
  expect(writes.runtimeErrors).toEqual([])
})

test('F3, F4, F9 y F8 siguen disponibles con las acciones secundarias plegadas', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/')
  await normalItem(page)
  await page.keyboard.press('F3')
  await expect(page.getByRole('heading', { name: 'Editar línea', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  await page.keyboard.press('F4')
  await expect(page.getByLabel('Precio unitario Servicio de mostrador', { exact: true })).toBeFocused()
  await page.getByLabel('Precio unitario Servicio de mostrador', { exact: true }).fill('25')
  await page.getByLabel('Precio unitario Servicio de mostrador', { exact: true }).press('Enter')
  await page.keyboard.press('F9')
  await expect(page.getByRole('heading', { name: 'Registrar cobro', exact: true })).toBeVisible()
  await expect(page.locator('.payment-total')).toContainText('25,00')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('F8')
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeVisible()
  expect(writes).toHaveLength(0)
  expect(writes.runtimeErrors).toEqual([])
})

test('descuento y cliente permanecen visibles, y el carrito se adapta al ancho disponible', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/')
  await normalItem(page)
  await page.getByRole('button', { name: /\+ Descuento/ }).click()
  await page.getByLabel('Descuento general', { exact: true }).fill('2')
  await page.getByLabel('Descuento general', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Ocultar descuento', exact: true }).click()
  await expect(page.getByLabel('Descuento general', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cliente de mostrador/ })).toBeVisible()
  await expect(page.locator('.grand-total')).toContainText('18,00')
  await page.getByLabel('Descuento general', { exact: true }).fill('0')
  await page.getByLabel('Descuento general', { exact: true }).press('Tab')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport)
    await page.locator('.cart-panel-light').scrollIntoViewIfNeeded()
    const geometry = await page.locator('.cart-panel-light').evaluate(el => {
      const box = el.getBoundingClientRect()
      return { width: box.width, left: box.left, right: box.right, overflow: el.scrollWidth - el.clientWidth }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(viewport.width)
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    await page.getByRole('textbox', { name: 'Buscar productos', exact: true }).focus()
    await page.locator('.cart-panel-light').screenshot({ path: `.ui-review.local/carrito-ligero-${viewport.width}.png` })
  }
  // El shell del POS conserva su tamaño de escritorio; medimos también el componente
  // en un contenedor estrecho sin cambiar el catálogo ni la navegación de la aplicación.
  for (const width of [390, 320]) {
    await page.locator('.cart-panel-light').evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px` }, width)
    expect(await page.locator('.cart-panel-light').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    const row = page.locator('.cart-item-light')
    expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.locator('.cart-panel-light').screenshot({ path: `.ui-review.local/carrito-ligero-panel-${width}.png` })
  }
  expect(writes).toHaveLength(0)
  expect(writes.runtimeErrors).toEqual([])
})

const afterFrame = (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))

test('F3 y F4 actúan sobre la línea activa (la última) aunque no esté seleccionada', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/')
  await normalItem(page, 'Línea A', '20')
  await normalItem(page, 'Línea B', '30')
  await expect(page.locator('.cart-item-selected')).toHaveCount(0)
  await page.keyboard.press('F4')
  await expect(page.getByLabel('Precio unitario Línea B', { exact: true })).toBeFocused()
  await expect(page.locator('.cart-item-selected .cart-line-name')).toHaveText('Línea B')
  await page.getByLabel('Precio unitario Línea B', { exact: true }).press('Escape')
  await afterFrame(page)
  await page.keyboard.press('F3')
  await expect(page.getByRole('heading', { name: 'Editar línea', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Línea B')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  expect(writes.runtimeErrors).toEqual([])
})

test('F10 y Alt+K funcionan con el menú + Agregar cerrado', async ({ page }) => {
  const writes = await fixture(page)
  await page.goto('/')
  await expect(page.locator('[data-pos-action="agregar-vtd"]')).toBeEnabled()
  await expect(page.locator('.cart-add-items')).toBeHidden()
  await page.keyboard.press('F10')
  await expect(page.getByRole('heading', { name: 'Agregar ítem personalizado', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Alt+K')
  await expect(page.getByRole('heading', { name: 'Agregar VTD', exact: true })).toBeVisible()
  expect(writes.runtimeErrors).toEqual([])
})

test('quitar una línea se puede deshacer con el botón y con Ctrl+Z; Ctrl+Z también deshace un agregado', async ({ page }) => {
  const writes = await fixture(page, { products: true })
  await page.goto('/')
  const add = page.getByRole('button', { name: 'Agregar Material de Almacén QA', exact: true })
  const rows = page.locator('.cart-item-light')
  await add.click()
  await expect(rows).toHaveCount(1)
  // Ctrl+Z tras agregar: deshace el agregado.
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(0)
  // Papelera → barra → Deshacer.
  await add.click()
  await page.getByRole('button', { name: 'Eliminar Material de Almacén QA', exact: true }).click()
  await expect(rows).toHaveCount(0)
  await expect(page.locator('.cart-undo-bar')).toContainText('Quitaste Material de Almacén QA')
  await page.locator('.cart-undo-bar').getByRole('button', { name: /Deshacer/ }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.locator('.cart-undo-bar')).toHaveCount(0)
  // Supr → Ctrl+Z restaura la línea; otro Ctrl+Z deshace el agregado original.
  await page.keyboard.press('Delete')
  await expect(rows).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(0)
  expect(writes.runtimeErrors).toEqual([])
})

test('con 8 líneas la lista ligera es compacta: líneas ≤ 60 px y al menos 6 completas a 1366×768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  const writes = await fixture(page, { products: 8 })
  await page.goto('/')
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: i === 0 ? 'Agregar Material de Almacén QA' : `Agregar Producto QA ${44 + i}`, exact: true }).click()
  await expect(page.locator('.cart-item-light')).toHaveCount(8)
  await page.locator('.cart-panel-light').screenshot({ path: '.ui-review.local/carrito-compacto-1366.png' })
  const lines = await page.evaluate(() => {
    const list = document.querySelector('.cart-list')!.getBoundingClientRect()
    return [...document.querySelectorAll('.cart-item-light')].map(row => {
      const box = row.getBoundingClientRect()
      return { height: box.height, selected: row.classList.contains('cart-item-selected'), inside: box.top >= list.top - 0.5 && box.bottom <= list.bottom + 0.5 }
    })
  })
  // La última línea agregada queda seleccionada (muestra sus controles); el resto es la línea compacta.
  for (const line of lines.filter(l => !l.selected)) expect(line.height).toBeLessThanOrEqual(60)
  expect(lines.filter(l => l.inside).length).toBeGreaterThanOrEqual(6)
  // Controles de la línea seleccionada en una sola fila, y sin hueco extra entre la meta y el total.
  const geometry = await page.evaluate(() => {
    const tops = [...document.querySelectorAll('.cart-item-selected .cart-line-tools > *')].map(el => Math.round(el.getBoundingClientRect().top))
    const meta = document.querySelector('.cart-summary-meta')!.getBoundingClientRect()
    const total = document.querySelector('.grand-total')!.getBoundingClientRect()
    return { rows: new Set(tops).size, gap: total.top - meta.bottom, panelOverflow: document.querySelector('.cart-panel-light')!.scrollWidth - document.querySelector('.cart-panel-light')!.clientWidth }
  })
  expect(geometry.rows).toBe(1)
  expect(geometry.gap).toBeLessThanOrEqual(9)
  expect(geometry.panelOverflow).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.locator('.cart-panel-light').screenshot({ path: '.ui-review.local/carrito-compacto-1920.png' })
  expect(writes.runtimeErrors).toEqual([])
})
