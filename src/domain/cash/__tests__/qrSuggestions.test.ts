import { describe, expect, it } from 'vitest'
import { sugerirPagosQr, type MovimientoSinVincular, type PagoPendienteQr } from '../qrSuggestions'

const pago = (overrides: Partial<PagoPendienteQr> = {}): PagoPendienteQr => ({
  ventaPagoId: '1',
  montoBs: 150,
  creadoEn: '2026-09-28T10:00:00-04:00',
  ...overrides,
})

const movimiento = (overrides: Partial<MovimientoSinVincular> = {}): MovimientoSinVincular => ({
  id: 'm1',
  importeBs: 150,
  fechaTransaccion: '2026-09-28T10:02:00-04:00',
  ...overrides,
})

describe('sugerirPagosQr', () => {
  it('marca "fuerte" cuando hay un único candidato dentro de tolerancia', () => {
    const [sugerencia] = sugerirPagosQr([pago()], [movimiento()])
    expect(sugerencia.fuerza).toBe('fuerte')
    expect(sugerencia.candidatos).toHaveLength(1)
  })

  it('marca "debil" cuando hay varios candidatos dentro de tolerancia', () => {
    const [sugerencia] = sugerirPagosQr(
      [pago()],
      [movimiento({ id: 'm1', importeBs: 150.5 }), movimiento({ id: 'm2', importeBs: 149.5 })],
    )
    expect(sugerencia.fuerza).toBe('debil')
    expect(sugerencia.candidatos).toHaveLength(2)
  })

  it('marca "ninguna" cuando ningún movimiento cae dentro de tolerancia de monto', () => {
    const [sugerencia] = sugerirPagosQr([pago()], [movimiento({ importeBs: 500 })])
    expect(sugerencia.fuerza).toBe('ninguna')
    expect(sugerencia.candidatos).toHaveLength(0)
  })

  it('descarta un movimiento fuera de la ventana de 10 minutos aunque el monto calce', () => {
    const [sugerencia] = sugerirPagosQr([pago()], [movimiento({ fechaTransaccion: '2026-09-28T10:15:00-04:00' })])
    expect(sugerencia.fuerza).toBe('ninguna')
  })

  it('acepta una diferencia de monto dentro del 2% (mínimo Bs 1)', () => {
    const [sugerencia] = sugerirPagosQr([pago({ montoBs: 100 })], [movimiento({ importeBs: 101.5 })])
    expect(sugerencia.fuerza).toBe('fuerte')
  })

  it('rechaza una diferencia de monto por encima del 2%', () => {
    const [sugerencia] = sugerirPagosQr([pago({ montoBs: 100 })], [movimiento({ importeBs: 103 })])
    expect(sugerencia.fuerza).toBe('ninguna')
  })

  it('ordena los candidatos por diferencia de monto y luego de tiempo', () => {
    const [sugerencia] = sugerirPagosQr(
      [pago({ montoBs: 150 })],
      [
        movimiento({ id: 'lejos-en-tiempo', importeBs: 150, fechaTransaccion: '2026-09-28T10:08:00-04:00' }),
        movimiento({ id: 'exacto', importeBs: 150, fechaTransaccion: '2026-09-28T10:01:00-04:00' }),
        movimiento({ id: 'monto-distinto', importeBs: 149, fechaTransaccion: '2026-09-28T10:01:00-04:00' }),
      ],
    )
    expect(sugerencia.candidatos.map((c) => c.movimiento.id)).toEqual(['exacto', 'lejos-en-tiempo', 'monto-distinto'])
  })
})
