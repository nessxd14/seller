import { describe, expect, it } from 'vitest'
import { qrContentForVtd, qrContentForTraslado } from './qrContent'

describe('QR de la solicitud TRA', () => {
  it('abre el mismo traslado del carrito, sin confundirlo con Pedidos ni TV', () => {
    expect(qrContentForTraslado('112', 'https://almacen.example/ruta')).toBe('https://almacen.example/operaciones/traslados/112?escanear=1')
  })
  it.each(['0', '-1', 'TRA-2026-00083', '../pedidos/112', '9007199254740992'])('rechaza el identificador inválido %s', id => {
    expect(() => qrContentForTraslado(id)).toThrow('identificador válido')
  })
  it('no admite credenciales ni otro protocolo en la dirección', () => {
    expect(() => qrContentForTraslado('112', 'https://u:p@almacen.example')).toThrow('dirección')
    expect(() => qrContentForTraslado('112', 'javascript:alert(1)')).toThrow('dirección')
  })
})

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
