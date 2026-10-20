import { expect, it } from 'vitest'
import type { TransferLine } from '../../application/shared/models'
import { cantidadDevolucion, puedeDespacharTraslado, recibibleTraslado, sucursalPermiteTraslado } from './transfers'
const base: TransferLine = { id: '1', productId: '1', name: 'QA', sku: 'QA', cantidadBase: 10, estado: 'DESPACHADA', cantidadDespachada: 6, cantidadRecibida: 0 }
it('sólo devuelve lo recibido, respetando cero y excluyendo líneas rechazadas o movidas', () => {
  expect(cantidadDevolucion(base)).toBe(0)
  expect(cantidadDevolucion({ ...base, cantidadRecibida: undefined })).toBe(6)
  for (const estado of ['CAMBIADA', 'RECHAZADO', 'POR_DESPACHAR'] as const) {
    expect(cantidadDevolucion({ ...base, estado, cantidadRecibida: 6 })).toBe(0)
    expect(recibibleTraslado({ ...base, estado })).toBe(false)
  }
})
it('el vendedor recibe en su sucursal y no puede despachar', () => {
  const session = { user: { id: 'u', name: 'QA', active: true, role: 'vendedor' as const, sucursalId: 2 }, expiresAt: '2999-01-01' }
  expect(puedeDespacharTraslado(session)).toBe(false)
  expect(sucursalPermiteTraslado(session, 2)).toBe(true)
  expect(sucursalPermiteTraslado(session, 1)).toBe(false)
})
