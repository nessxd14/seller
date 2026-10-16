// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowLine } from '../../application/shared/models'
import { DocumentoExportable, type ExportableDoc } from '../DocumentoExportable'

vi.mock('../../infrastructure/services', () => ({
  customerService: { list: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue({ name: 'Cliente', document: '123456', address: 'Calle Beni 123', phone: '70000000' }) },
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

afterEach(() => { cleanup(); localStorage.clear() })

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
    expect(document.querySelector('style')?.textContent).toContain('counter(pages)')
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText(/Fotografiar TODAS las páginas/)).toBeTruthy()
    // "Origen" solo aparece cuando la entrega tiene referencia propia (si no, el encabezado ya dice el pedido).
    expect(screen.queryByText('Pedido PED-04821')).toBeNull()
    fireEvent.change(screen.getByLabelText('Referencia de esta entrega (opcional)'), { target: { value: 'Entrega 2' } })
    expect(screen.getByText('Pedido PED-04821')).toBeTruthy()
    // Bultos: input editable, precarga vacío (no hay caller que lo pase todavía).
    expect(screen.getByPlaceholderText('Ej. 3 cajas · 1 rollo')).toBeTruthy()
  })

  it('mantiene el flujo completo, repite la referencia y QR en el encabezado de tabla y conserva una sola firma final', async () => {
    const lines: WorkflowLine[] = Array.from({ length: 29 }, (_, i) => ({ ...baseLine, id: `l${i}`, name: `Producto ${i}` }))
    const doc: ExportableDoc = { ...baseDoc, lines, orderId: 'ord-1' }
    render(<DocumentoExportable mode="nota-entrega" doc={doc} onClose={() => {}} />)
    await screen.findByText(/NOTA DE/)
    expect(document.querySelectorAll('.doc-page')).toHaveLength(1)
    expect(document.querySelectorAll('.doc-delivery-item')).toHaveLength(29)
    expect(screen.getByText('Producto 28')).toBeTruthy()
    expect(screen.getAllByText(/Entrega \(nombre y firma\)/)).toHaveLength(1)
    await waitFor(() => expect(document.querySelector('.doc-delivery-repeat img.doc-qr')).toBeTruthy())
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

describe('datos operativos del impreso', () => {
  it('guarda los datos del documento y los recupera al reabrir, sin mezclarlos con otro', async () => {
    const view = render(<DocumentoExportable mode="cotizacion" doc={baseDoc} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Lugar / dirección de entrega'), { target: { value: 'Depósito Norte' } })
    fireEvent.change(screen.getByLabelText('Plazo de entrega'), { target: { value: '3 días hábiles' } })
    fireEvent.click(screen.getByText('Guardar datos para reimpresión'))
    expect(screen.getByRole('status').textContent).toContain('Datos guardados')
    view.unmount()
    const reopened = render(<DocumentoExportable mode="cotizacion" doc={baseDoc} onClose={() => {}} />)
    expect((screen.getByLabelText('Lugar / dirección de entrega') as HTMLInputElement).value).toBe('Depósito Norte')
    expect(document.querySelector('.print-document')?.textContent).toContain('3 días hábiles')
    reopened.rerender(<DocumentoExportable mode="cotizacion" doc={{ ...baseDoc, number: 'COT-OTRA' }} onClose={() => {}} />)
    expect((screen.getByLabelText('Lugar / dirección de entrega') as HTMLInputElement).value).toBe('')
  })

  it('imprime datos del cliente por ID y la fecha real del pedido', async () => {
    render(<DocumentoExportable mode="pedido" doc={{ ...baseDoc, customerId: 'c1', createdAt: '2026-10-16T14:00:00Z' }} onClose={() => {}} />)
    await waitFor(() => expect(document.querySelector('.print-document')?.textContent).toContain('Calle Beni 123'))
    expect(document.querySelector('.print-document')?.textContent).toContain('123456')
    expect(document.querySelector('.print-document')?.textContent).toContain('16/10/2026')
    expect(document.querySelector('.print-document')?.textContent).toContain('10:00')
  })

  it('imprime despacho y pendiente en su presentación y usa los totales guardados', () => {
    const line: WorkflowLine = { ...baseLine, quantity: 6, dispatchedQuantity: 2.5, presentacionNombre: 'Caja', factorUnidadBase: 12, lineStatus: 'POR_DESPACHAR' }
    render(<DocumentoExportable mode="pedido" doc={{ ...baseDoc, lines: [line], subtotalCents: 99900, totalCents: 98000 }} onClose={() => {}} />)
    const row = document.querySelector('.doc-order-table tbody tr')!
    const cells = row.querySelectorAll('td')
    expect(cells[4].textContent).toBe((2.5).toLocaleString('es-BO'))
    expect(cells[5].textContent).toBe((3.5).toLocaleString('es-BO'))
    expect(row.textContent).toContain('Entrega parcial')
    expect(document.querySelector('.doc-totals')?.textContent).toContain('980')
  })

  it('la nota manual incluye recibido, transporte y referencia y excluye líneas retiradas', () => {
    render(<DocumentoExportable mode="nota-entrega" doc={{ ...baseDoc, lines: [baseLine, { ...baseLine, id: 'retirada', name: 'Producto retirado', lineStatus: 'RETIRADA' }] }} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Referencia de esta entrega (opcional)'), { target: { value: 'Entrega 2 - Norte' } })
    fireEvent.change(screen.getByLabelText('Transportista'), { target: { value: 'Transporte Beni' } })
    const print = document.querySelector('.print-document')!
    expect(print.textContent).toContain('Registro manual')
    expect(print.textContent).toContain('Entrega 2 - Norte')
    expect(print.textContent).toContain('Transporte Beni')
    expect(print.textContent).toContain('Recibido')
    expect(print.textContent).not.toContain('Producto retirado')
    expect(document.querySelectorAll('.doc-delivery-item')).toHaveLength(1)
  })

  it('conserva plazo, condiciones y observaciones en el rollo', () => {
    render(<DocumentoExportable mode="cotizacion" doc={{ ...baseDoc, terms: 'Entrega coordinada', notes: 'Recepción de lunes a viernes' }} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Plazo de entrega'), { target: { value: '48 horas' } })
    fireEvent.change(screen.getByDisplayValue('Carta'), { target: { value: 'rollo-80' } })
    const print = document.querySelector('.doc-roll')!
    expect(print.textContent).toContain('48 horas')
    expect(print.textContent).toContain('Entrega coordinada')
    expect(print.textContent).toContain('Recepción de lunes a viernes')
  })
})
