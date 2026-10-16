// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { docPrintDetailsKey, readDocPrintDetails, saveDocPrintDetails } from './docPrintDetails'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('aísla los datos entre documentos, clientes y tipos', () => {
  const key = docPrintDetailsKey('pedido', 'PED-1', 'c1')
  expect(saveDocPrintDetails(key, { address: 'Depósito Norte', bultos: '3 cajas' })).toBe(true)
  expect(readDocPrintDetails(key)).toEqual({ address: 'Depósito Norte', bultos: '3 cajas' })
  expect(readDocPrintDetails(docPrintDetailsKey('nota-entrega', 'PED-1', 'c1'))).toEqual({})
  expect(readDocPrintDetails(docPrintDetailsKey('pedido', 'PED-1', 'c2'))).toEqual({})
  expect(readDocPrintDetails(docPrintDetailsKey('pedido', 'PED-2', 'c1'))).toEqual({})
})
it('tolera datos dañados o almacenamiento no disponible', () => {
  localStorage.setItem('doc', '{malformed')
  expect(readDocPrintDetails('doc')).toEqual({})
  localStorage.setItem('doc', JSON.stringify({ address: 12, phone: '70000000', unknown: 'no imprimir' }))
  expect(readDocPrintDetails('doc')).toEqual({ phone: '70000000' })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  expect(saveDocPrintDetails('doc', { address: 'Otra' })).toBe(false)
})
