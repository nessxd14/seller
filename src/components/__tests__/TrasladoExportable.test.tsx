// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TransferRecord } from '../../application/shared/models'
import { TrasladoExportable } from '../TrasladoExportable'

vi.mock('../../infrastructure/services', () => ({
  listLineIdentifiers: vi.fn().mockResolvedValue({}),
}))

// El proyecto no usa `globals: true` en la config de vitest, así que el auto-cleanup
// que @testing-library/react registra vía el `afterEach` global no se activa —
// Modal hace createPortal a document.body, y sin este cleanup explícito cada test se
// acumula sobre el DOM del anterior (de ahí "Found multiple elements").
afterEach(cleanup)

const baseTransfer: TransferRecord = {
  id: '7',
  numero: 'TRA-2026-00007',
  motivo: 'REPOSICION',
  estado: 'SOLICITADO',
  sucursalOrigenId: 1,
  sucursalDestinoId: 2,
  solicitadoPor: 'Rony',
  solicitadoEn: '2026-08-08T14:32:00Z',
  creadoEn: '2026-08-08T14:32:00Z',
  lines: [
    { id: 'l1', productId: '101', name: 'Goma Eva Azul', sku: 'GEA-1', cantidadBase: 5 },
    { id: 'l2', productId: '102', name: 'Caja de folders', sku: 'CF-1', cantidadBase: 72, presentacionId: 9, presentacionNombre: 'Caja', cantidadPresentacion: 3 },
  ],
}

describe('TrasladoExportable', () => {
  it('SOLICITADO: hoja de picking — sin columnas de despachado/recibido ni ningún importe', async () => {
    render(<TrasladoExportable transfer={baseTransfer} onClose={() => {}} />)
    expect(await screen.findByText('SOLICITUD DE TRASLADO')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(table.querySelector('thead')?.textContent ?? '').not.toContain('Despachado')
    expect(table.querySelector('thead')?.textContent ?? '').not.toContain('Recibido')
    expect(table.textContent ?? '').not.toMatch(/Bs\s?\d/)
  })

  it('línea con presentacionId y factor 24 (SOLICITADO) muestra las dos cantidades', async () => {
    const transfer: TransferRecord = {
      ...baseTransfer,
      lines: [{ id: 'l1', productId: '101', name: 'Caja de tornillos', sku: 'CT-1', cantidadBase: 240, presentacionId: 5, presentacionNombre: 'Caja', cantidadPresentacion: 10 }],
    }
    render(<TrasladoExportable transfer={transfer} onClose={() => {}} />)
    await screen.findByText('SOLICITUD DE TRASLADO')
    // factor = 240 / 10 = 24: cantidad en presentación (10 Caja) y equivalencia en base (240 u)
    expect(screen.getByText('10 Caja')).toBeTruthy()
    expect(screen.getByText('240 u')).toBeTruthy()
  })

  it('EN_TRANSITO: una línea despachada incompleta queda marcada y aparece la nota al pie', async () => {
    const transfer: TransferRecord = {
      ...baseTransfer,
      estado: 'EN_TRANSITO',
      despachadoPor: 'Almacén',
      despachadoEn: '2026-08-08T15:00:00Z',
      lines: [
        { id: 'l1', productId: '101', name: 'Goma Eva Azul', sku: 'GEA-1', cantidadBase: 10, cantidadDespachada: 6 },
        { id: 'l2', productId: '102', name: 'Marcador negro', sku: 'MN-1', cantidadBase: 4, cantidadDespachada: 4 },
      ],
    }
    render(<TrasladoExportable transfer={transfer} onClose={() => {}} />)
    expect(await screen.findByText('GUÍA DE TRASLADO')).toBeTruthy()
    // Modal hace createPortal a document.body, no al container de render(): las
    // aserciones estructurales tienen que buscar en document, no en `container`.
    const incompleteRows = document.body.querySelectorAll('.doc-line-incompleta')
    expect(incompleteRows).toHaveLength(1)
    expect(incompleteRows[0].textContent).toContain('Goma Eva Azul')
    expect(screen.getByText(/se despacharon incompletas/)).toBeTruthy()
  })

  it('RECIBIDO sin diferencias: la columna Dif. queda vacía en todas las filas', async () => {
    const transfer: TransferRecord = {
      ...baseTransfer,
      estado: 'RECIBIDO',
      despachadoPor: 'Almacén',
      recibidoPor: 'Tienda',
      lines: [
        { id: 'l1', productId: '101', name: 'Goma Eva Azul', sku: 'GEA-1', cantidadBase: 10, cantidadDespachada: 10, cantidadRecibida: 10 },
        { id: 'l2', productId: '102', name: 'Marcador negro', sku: 'MN-1', cantidadBase: 4, cantidadDespachada: 4, cantidadRecibida: 4 },
      ],
    }
    render(<TrasladoExportable transfer={transfer} onClose={() => {}} />)
    expect(await screen.findByText('CONSTANCIA DE RECEPCIÓN')).toBeTruthy()
    expect(document.body.querySelectorAll('.doc-diff-flag')).toHaveLength(0)
  })

  it('RECIBIDO con diferencia: aparece el número correcto en Dif.', async () => {
    const transfer: TransferRecord = {
      ...baseTransfer,
      estado: 'RECIBIDO',
      despachadoPor: 'Almacén',
      recibidoPor: 'Tienda',
      lines: [
        { id: 'l1', productId: '101', name: 'Goma Eva Azul', sku: 'GEA-1', cantidadBase: 10, cantidadDespachada: 10, cantidadRecibida: 8 },
      ],
    }
    render(<TrasladoExportable transfer={transfer} onClose={() => {}} />)
    await screen.findByText('CONSTANCIA DE RECEPCIÓN')
    const diffCells = document.body.querySelectorAll('.doc-diff-flag')
    expect(diffCells).toHaveLength(1)
    expect(diffCells[0].textContent).toBe('−2')
  })
})
