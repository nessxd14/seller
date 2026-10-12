import { describe, expect, it } from 'vitest'
import { qrContentForVtd } from './qrContent'

describe('QR del ticket VTD', () => {
  it('abre el alistado de Almacén con el ID de venta y escaneo automático', () => {
    expect(qrContentForVtd('38', 'https://almacen.example')).toBe('https://almacen.example/operaciones/vtd/38?escanear=1')
  })
  it('usa el origen publicado aunque la configuración tenga una ruta', () => {
    expect(qrContentForVtd('38', 'https://almacen.example/otra/ruta')).toBe('https://almacen.example/operaciones/vtd/38?escanear=1')
  })
  it.each(['', '0', '-1', 'VTD-2026-00008', '../ventas/38'])('rechaza un ID inválido %s', id => {
    expect(() => qrContentForVtd(id)).toThrow('identificador válido')
  })
  it('rechaza direcciones con credenciales o protocolos distintos de HTTP', () => {
    expect(() => qrContentForVtd('38', 'https://user:pass@almacen.example')).toThrow('dirección')
    expect(() => qrContentForVtd('38', 'javascript:alert(1)')).toThrow('dirección')
  })
})
