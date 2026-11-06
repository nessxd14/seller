import { describe, expect, it } from 'vitest'
import { contenidoQrTraslado } from '../qrTraslado'

describe('QR del ticket de traslado', () => {
  it('con id numérico arma el enlace de alistado y recepción en Almacén', () => {
    const qr = contenidoQrTraslado('123')
    expect(qr.ok).toBe(true)
    if (qr.ok) expect(qr.enlace).toMatch(/\/operaciones\/traslados\/123\?escanear=1$/)
  })
  it('con un id inválido no rompe la pantalla: devuelve el motivo', () => {
    const qr = contenidoQrTraslado('transfer-seed-1')
    expect(qr.ok).toBe(false)
    if (!qr.ok) expect(qr.error).toMatch(/identificador/)
  })
})
