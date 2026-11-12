import { describe, expect, it } from 'vitest'
import { consultarHistorialPagosMock } from '../../infrastructure/mock/historialPagos'
import { puedeVerPagos, rangoPorDefectoHistorial, rangoPorDefectoLista, SIN_MOTIVO_ANTICIPO, textoMotivoAnticipo, montoRecibido } from './historialPagos'

describe('Pagos: roles y rangos', () => {
  it('solo admin, gerente, cajero y vendedor_mayoreo consultan', () => {
    for (const r of ['admin', 'gerente', 'cajero', 'vendedor_mayoreo'] as const) expect(puedeVerPagos(r)).toBe(true)
    for (const r of ['reponedor', 'vendedor', 'almacenero', undefined] as const) expect(puedeVerPagos(r)).toBe(false)
  })
  it('rangos por defecto', () => {
    expect(rangoPorDefectoLista('2026-11-12')).toEqual({ desde: '2026-11-10', hasta: '2026-11-12' })
    expect(rangoPorDefectoHistorial('2026-11-12')).toEqual({ desde: '2026-10-01', hasta: '2026-11-12' })
    expect(rangoPorDefectoHistorial('2026-01-05').desde).toBe('2025-12-01')
  })
  it('anticipo sin motivo y SALDO sin dinero', () => {
    expect(textoMotivoAnticipo({ motivo: null, motivoDetalle: null })).toBe(SIN_MOTIVO_ANTICIPO)
    expect(montoRecibido({ clase: 'SALDO', monto: 5 })).toBe(0)
  })
})

describe('Pagos: datos mock', () => {
  const rango = { desde: '2020-01-01', hasta: '2099-12-31' }
  it('las tarjetas (resumen) solo existen para admin y gerente', () => {
    expect(consultarHistorialPagosMock(rango, 'admin').resumen).not.toBeNull()
    expect(consultarHistorialPagosMock(rango, 'cajero').resumen).toBeNull()
  })
  it('historial de BNB: 3 pagos confirmados y recibido 21.199,50; solo confirmados al imprimir', () => {
    const r = consultarHistorialPagosMock({ ...rango, clienteId: 44 }, 'cajero')
    expect(r.cliente?.periodo?.pagos).toBe(3)
    expect(r.cliente?.periodo?.recibido).toBe(21199.5)
    const imp = consultarHistorialPagosMock({ ...rango, clienteId: 44, soloConfirmados: true }, 'cajero')
    expect(imp.filas.every(f => f.estado === 'CONFIRMADO')).toBe(true)
    expect(imp.filas.some(f => f.referenciaImpresion === '5976098039')).toBe(true)
  })
})
