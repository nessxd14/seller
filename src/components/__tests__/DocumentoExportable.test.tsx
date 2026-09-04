// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

  it('pagina cuando hay más líneas que las que entran en una hoja, y muestra firmas solo en la última página', async () => {
    const lines: WorkflowLine[] = Array.from({ length: 9 }, (_, i) => ({ ...baseLine, id: `l${i}`, name: `Producto ${i}` }))
    const doc: ExportableDoc = { ...baseDoc, lines }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    expect(await screen.findByText('Página 1 de 3')).toBeTruthy()
    expect(screen.getByText('Página 2 de 3')).toBeTruthy()
    expect(screen.getByText('Página 3 de 3')).toBeTruthy()
    expect(screen.getAllByText(/Entrega \(nombre y firma\)/)).toHaveLength(1)
  })
})
