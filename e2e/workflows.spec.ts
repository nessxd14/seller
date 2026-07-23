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

