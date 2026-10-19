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
  await page.getByRole('button', { name: 'Ver desglose y descuento', exact: true }).click()
  await page.getByLabel('Descuento general', { exact: true }).fill('2')
  await page.getByLabel('Descuento general', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Ocultar desglose', exact: true }).click()
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
