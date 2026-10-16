import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

type Mode = 'cotizacion' | 'pedido' | 'nota-entrega'
const OUT = 'test-results/print-pdfs'
mkdirSync(OUT, { recursive: true })

async function pdfPages(page: Page, query: string, name: string, format?: 'A4') {
  await page.goto(`/print-harness.html?${query}`)
  await page.locator('.print-document').first().waitFor()
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete))
  await page.waitForTimeout(400)
  const buffer = await page.pdf({ preferCSSPageSize: !format, format, printBackground: false })
  writeFileSync(`${OUT}/${name}.pdf`, buffer)
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const pages: { text: string; width: number }[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const sheet = await pdf.getPage(i)
    const content = await sheet.getTextContent()
    pages.push({ text: content.items.map((item) => ('str' in item ? item.str : '')).join(' '), width: sheet.view[2] })
  }
  return pages
}

const base = 'long=1&obs=1&sig=1'
const SIZES = [1, 3, 5, 7, 9, 11, 13, 15, 18, 22, 26, 32, 40]
const EXPECTED: Record<string, number> = {
  'cotizacion-9': 1, 'cotizacion-11': 1, 'cotizacion-32': 2, 'pedido-7': 1, 'pedido-22': 2,
  'nota-entrega-3': 1, 'nota-entrega-15': 2, 'nota-entrega-26': 3, 'nota-entrega-40': 4,
}

function assertHardRules(pages: { text: string }[], mode: Mode) {
  pages.forEach((sheet, index) => {
    expect(sheet.text, `hoja ${index + 1} sin pie "Página N de M" (hoja en blanco)`).toMatch(new RegExp(`Página ${index + 1} de ${pages.length}`))
    expect(sheet.text, `hoja ${index + 1} sin ninguna fila de producto`).toMatch(/Producto de prueba número \d+/)
  })
  if (mode === 'nota-entrega') {
    const last = pages[pages.length - 1].text
    expect(last).toMatch(/ENTREGADO/) // encabezado de tabla repetido
    expect(last).toContain('Entrega (nombre y firma)')
    expect(last).toContain('Recibe (nombre, CI y firma)')
  }
}

for (const mode of ['cotizacion', 'pedido', 'nota-entrega'] as Mode[]) {
  for (const n of SIZES) {
    test(`${mode} · ${n} líneas`, async ({ page }) => {
      const pages = await pdfPages(page, `mode=${mode}&n=${n}&${base}`, `${mode}-${n}`)
      assertHardRules(pages, mode)
      const expected = EXPECTED[`${mode}-${n}`]
      if (expected) expect(pages.length).toBe(expected)
    })
  }
}

test('cotizacion · 32 líneas en A4', async ({ page }) => {
  const pages = await pdfPages(page, `mode=cotizacion&n=32&${base}`, 'cotizacion-32-a4', 'A4')
  expect(pages.length).toBe(2)
  pages.forEach((sheet, index) => expect(sheet.text).toMatch(new RegExp(`Página ${index + 1} de 2`)))
})

test('cotizacion · 32 líneas con otro modal debajo', async ({ page }) => {
  const pages = await pdfPages(page, `mode=cotizacion&n=32&nested=1&${base}`, 'cotizacion-32-nested')
  assertHardRules(pages, 'cotizacion')
  expect(pages.length).toBe(2)
})

for (const [mode, n] of [['cotizacion', 12], ['nota-entrega', 8], ['nota-entrega', 30]] as [Mode, number][]) {
  test(`rollo 80 mm · ${mode} · ${n} líneas`, async ({ page }) => {
    const pages = await pdfPages(page, `mode=${mode}&n=${n}&fmt=rollo-80&${base}`, `rollo-${mode}-${n}`)
    expect(pages.length).toBe(1)
    expect(pages[0].width).toBeCloseTo(80 * 72 / 25.4, 0)
  })
}
