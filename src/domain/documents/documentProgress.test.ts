import { describe, expect, it } from 'vitest'
import type { WorkflowLine } from '../../application/shared/models'
import { documentLineProgress, formatDocumentDate } from './documentProgress'

const line: WorkflowLine = { id: '1', productId: '1', name: 'Papel', sku: '', quantity: 6, unitPriceCents: 100, discountBasisPoints: 0 }
describe('cantidades y fechas del documento', () => {
  it('conserva entregas parciales y fracciones de presentación', () => {
    expect(documentLineProgress({ ...line, dispatchedQuantity: 2.5 })).toEqual({ dispatched: 2.5, pending: 3.5 })
    expect(documentLineProgress({ ...line, dispatchedQuantity: 0 })).toEqual({ dispatched: 0, pending: 6 })
  })
  it('distingue estados explícitos de cantidades sin confirmar', () => {
    expect(documentLineProgress(line)).toEqual({ dispatched: null, pending: null })
    expect(documentLineProgress({ ...line, lineStatus: 'DESPACHADA' })).toEqual({ dispatched: 6, pending: 0 })
    expect(documentLineProgress({ ...line, lineStatus: 'POR_DESPACHAR' })).toEqual({ dispatched: 0, pending: 6 })
    expect(documentLineProgress({ ...line, lineStatus: 'CAMBIADA' })).toEqual({ dispatched: null, pending: 0 })
  })
  it('conserva la fecha de calendario y convierte la hora a Bolivia', () => {
    expect(formatDocumentDate('2026-10-16')).toBe('16/10/2026')
    expect(formatDocumentDate('10/11/2026')).toBe('10/11/2026')
    expect(formatDocumentDate('2026-10-16T02:00:00Z')).toContain('15/10/2026')
    expect(formatDocumentDate('2026-10-16T02:00:00Z')).toContain('22:00')
  })
})
