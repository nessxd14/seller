// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowLine } from '../../application/shared/models'
import { DocumentoExportable, type ExportableDoc } from '../DocumentoExportable'

vi.mock('../../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]) },
  listLineIdentifiers: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../config/empresaStore', () => ({
  empresaStore: { razonSocial: 'Cation y Asociados', direccion: '', ciudad: '', celular: '', correo: '', nit: '', logoSrc: '', selloUrl: '', firmaUrl: '', firmaNombre: '', firmaCargo: '' },
  loadEmpresaConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../infrastructure/supabase/PerfilRepository.supabase', () => ({
  resolveNombrePorEmail: vi.fn().mockResolvedValue('Cristian M.'),
}))
// jsdom no implementa canvas — qrcode.toDataURL() lo necesita para dibujar. El QR real
// se prueba a ojo en la maqueta HTML del brief; acá solo importa que el componente pida
// generarlo cuando corresponde (orderId presente) y no rompa el render cuando no.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,fake') },
}))

afterEach(cleanup)

const baseLine: WorkflowLine = {
  id: 'l1', productId: 'p1', name: 'Resma papel bond A4', sku: 'SKU1',
  quantity: 40, unitPriceCents: 3800, discountBasisPoints: 0,
}

const baseDoc: ExportableDoc = {
  number: 'COT-2026-00231', customerName: 'Hospital Regional Beni', channel: 'institucional',
  lines: [baseLine],
}

describe('DocumentoExportable — cotización', () => {
  it('mantiene precios, totales y sin QR', async () => {
    render(<DocumentoExportable mode="cotizacion" doc={baseDoc} onClose={() => {}} />)
    expect(await screen.findByText('COTIZACIÓN')).toBeTruthy()
    expect(screen.getByText('Subtotal')).toBeTruthy()
    expect(screen.getAllByText('Total').length).toBeGreaterThan(0)
    expect(screen.queryByAltText('Código QR del documento')).toBeNull()
  })
})

describe('DocumentoExportable — pedido', () => {
  it('agrega QR cuando hay orderId, columna Estado, y la leyenda de seguimiento', async () => {
    const cambiada: WorkflowLine = { ...baseLine, id: 'l2', name: 'Marcadores', lineStatus: 'CAMBIADA', replacedByName: 'Marcadores nuevos', replacedByQuantity: 6 }
    const doc: ExportableDoc = { ...baseDoc, lines: [baseLine, cambiada], orderId: 'ord-1' }
    render(<DocumentoExportable mode="pedido" doc={doc} onClose={() => {}} />)
    expect(await screen.findByText('PEDIDO')).toBeTruthy()
    await waitFor(() => expect(screen.getByAltText('Código QR del documento')).toBeTruthy())
    expect(screen.getByText('Cambiada → Marcadores nuevos')).toBeTruthy()
    expect(screen.getByText(/Documento interno de seguimiento/)).toBeTruthy()
    expect(screen.getAllByText('Total').length).toBeGreaterThan(0)
  })
})

describe('DocumentoExportable — nota de entrega', () => {
  it('no muestra precios ni totales, y sí las columnas C/P/N/R y la leyenda de Telegram', async () => {
    const doc: ExportableDoc = { ...baseDoc, orderId: 'ord-1', originOrderNumber: 'PED-04821' }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    expect(await screen.findByText(/NOTA DE/)).toBeTruthy()
    expect(screen.queryByText('P/U')).toBeNull()
    expect(screen.queryByText('Subtotal')).toBeNull()
    expect(screen.getByText('Página 1 de 1')).toBeTruthy()
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText(/Fotografiar TODAS las páginas/)).toBeTruthy()
    expect(screen.getByText('Pedido #PED-04821')).toBeTruthy()
    // Bultos: input editable, precarga vacío (no hay caller que lo pase todavía).
    expect(screen.getByPlaceholderText('Ej. 3 cajas · 1 rollo')).toBeTruthy()
  })

  it('pagina cuando hay más líneas que las que entran en una hoja, muestra la cabecera compacta desde la página 2 y firmas solo en la última', async () => {
    // Página 1: 12 líneas (membrete completo, más alto). Páginas siguientes: 16 (cabecera
    // compacta) — ver NE_LINES_FIRST_PAGE/NE_LINES_OTHER_PAGES en el componente. 29 líneas
    // da 12 + 16 + 1 = 3 páginas.
    const lines: WorkflowLine[] = Array.from({ length: 29 }, (_, i) => ({ ...baseLine, id: `l${i}`, name: `Producto ${i}` }))
    const doc: ExportableDoc = { ...baseDoc, lines }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    expect(await screen.findByText('Página 1 de 3')).toBeTruthy()
    expect(screen.getByText('Página 2 de 3')).toBeTruthy()
    expect(screen.getByText('Página 3 de 3')).toBeTruthy()
    expect(screen.getAllByText(/Entrega \(nombre y firma\)/)).toHaveLength(1)
    // Brief 1.2 (Parte 2): cabecera compacta en páginas 2 y 3, completa solo en la 1.
    expect(document.querySelectorAll('.doc-page-header-compact')).toHaveLength(2)
  })

  it('siempre muestra una fecha real, aunque documentDate venga vacío (brief 1.4)', async () => {
    const doc: ExportableDoc = { ...baseDoc, documentDate: undefined }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    await screen.findByText(/NOTA DE/)
    expect(screen.getByText(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/)).toBeTruthy()
  })

  it('nunca renderiza el placeholder de Bultos como si fuera un valor cargado (brief 1.3)', async () => {
    const doc: ExportableDoc = { ...baseDoc }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    await screen.findByText(/NOTA DE/)
    // El texto del placeholder solo vive en el atributo `placeholder` del input de
    // pantalla (oculto en @media print) — la versión que SÍ imprime es una línea en
    // blanco (.doc-fill), nunca el texto "Ej. ...".
    expect(screen.queryByText(/Ej\. 3 cajas/)).toBeNull()
    const printFill = document.querySelector('.doc-bultos-print')
    expect(printFill?.querySelector('.doc-fill')).toBeTruthy()
  })
})

describe('DocumentoExportable — formato rollo (80mm)', () => {
  it('cotización en rollo: mismo contenido, apilado, sin QR', async () => {
    render(<DocumentoExportable mode="cotizacion" doc={baseDoc} onClose={() => {}} />)
    await screen.findByText('COTIZACIÓN')
    const select = screen.getByDisplayValue('Carta') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'rollo-80' } })
    expect(screen.getAllByText(/RESMA PAPEL BOND A4/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/TOTAL/).length).toBeGreaterThan(0)
    expect(screen.queryByAltText('Código QR del documento')).toBeNull()
  })

  it('nota de entrega en rollo: sin paginado, con QR y marcador de fin', async () => {
    const doc: ExportableDoc = { ...baseDoc, orderId: 'ord-1' }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    await screen.findByText(/NOTA DE/)
    const select = screen.getByDisplayValue('Carta') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'rollo-80' } })
    await waitFor(() => expect(screen.getByAltText('Código QR del documento')).toBeTruthy())
    expect(screen.getByText('— FIN —')).toBeTruthy()
    expect(screen.getByText(/Fotografiar TODO el rollo/)).toBeTruthy()
    expect(screen.queryByText(/Página \d de \d/)).toBeNull()
  })
})
