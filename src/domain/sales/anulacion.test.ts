import { describe, expect, it } from 'vitest'
import { badgeDevolucion, explicarDevolucion, mensajeAnulacion } from './anulacion'

describe('explicarDevolucion', () => {
  it('cajero: la solicitud la revisa Ness o el gerente', () => {
    expect(explicarDevolucion({ cobrado: 50 }, false)).toBe('Ness o el gerente revisarán tu solicitud.')
  })
  it('turno del cobro abierto: devuelve desde ese turno y afecta su arqueo', () => {
    expect(explicarDevolucion({ cobrado: 50, sesionCobroId: '7', sesionCobroAbierta: true }, true)).toBe('Se devolverá Bs 50,00 desde el turno #7 (afecta su arqueo).')
  })
  it('turno del cobro cerrado: fuera de arqueo, a nombre de quien anula', () => {
    expect(explicarDevolucion({ cobrado: 50, sesionCobroId: '7', sesionCobroAbierta: false }, true)).toBe('El turno del cobro ya cerró: Bs 50,00 se devuelve fuera de arqueo, a tu nombre.')
  })
  it('sin cobro: no hay dinero que devolver', () => {
    expect(explicarDevolucion({ cobrado: 0 }, true)).toBe('No hay dinero que devolver.')
  })
  it('turno desconocido: línea genérica', () => {
    expect(explicarDevolucion({ cobrado: 50 }, true)).toBe('La devolución se registra según el turno donde se cobró.')
    expect(explicarDevolucion({}, true)).toBe('La devolución se registra según el turno donde se cobró.')
  })
})

describe('badgeDevolucion', () => {
  it('distingue turno abierto, fuera de arqueo y sin cobro', () => {
    expect(badgeDevolucion({ cobrado: 10, sesionCobroAbierta: true, sesionCobroId: '3' })).toEqual({ tipo: 'turno', texto: 'Devuelve desde turno #3' })
    expect(badgeDevolucion({ cobrado: 10, sesionCobroAbierta: false, sesionCobroId: '3' })).toEqual({ tipo: 'fuera-de-arqueo', texto: 'Fuera de arqueo' })
    expect(badgeDevolucion({ cobrado: 0, sesionCobroAbierta: false })).toEqual({ tipo: 'sin-cobro', texto: 'Sin cobro' })
  })
})

describe('mensajeAnulacion', () => {
  it('menciona explícitamente la devolución fuera de arqueo', () => {
    expect(mensajeAnulacion('VTA-1', { tipo: 'anulada', resultado: { ventaId: '1', estado: 'ANULADA', devuelto: 20, fueraDeArqueo: true } })).toContain('FUERA DE ARQUEO')
  })
  it('solicitud enviada', () => {
    expect(mensajeAnulacion('VTA-1', { tipo: 'solicitada', resultado: { solicitudId: '1', ventaId: '1', estado: 'SOLICITADA' } })).toContain('Solicitud de anulación enviada')
  })
})
