// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CashPage } from '../CashPage'
import { CashSessionProvider } from '../../../context/CashSessionContext'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'
import type { TurnoResumen, TurnoSesion } from '../../../application/shared/models'

// Brief Caja-1 — blind count (decisión no negociable): un cajero nunca debe ver
// "esperado"/"diferencia" en la pantalla de Caja; un gerente sí. resumen_turno ya lo
// esconde server-side (esperadoEfectivoBs: null para cajero) — este test cubre que el
// frontend efectivamente respeta ese null y no lo recalcula por su cuenta.
const { getSession, getResumenTurno, sesionAbierta, cajeroSession, gerenteSession, resumenBase } = vi.hoisted(() => {
  const sesionAbierta: TurnoSesion = {
    id: '1', cajaId: 1, cajaNombre: 'Caja Tienda', estado: 'ABIERTA', aperturaBs: 500,
    cajeroId: 'u1', abiertaPor: 'natalia@roari.com', abiertaEn: new Date().toISOString(), diferenciaRelevoBs: null,
  }
  const resumenBase: Omit<TurnoResumen, 'esperadoEfectivoBs'> = {
    aperturaBs: 500, ventasPorMetodo: { EFECTIVO: 200 }, ventasRetailPorMetodo: { EFECTIVO: 200 }, ventasVtdPorMetodo: {},
    cantidadVtdCobradas: 0, vtdPorCobrar: { cantidad: 0, totalBs: 0 }, anticiposPorMetodo: {}, anulacionesPorMetodo: {},
    gastosPorEstado: {}, remesasBs: 0, inyeccionesBs: 0, cantidadVentas: 1, pagosPendientesVerificacion: 0,
    pagosRechazados: [], diferenciaRelevoBs: null,
  }
  const cajeroSession: AuthSession = { user: { id: 'u1', name: 'Natalia Cajera', role: 'cajero', active: true, email: 'natalia@roari.com' }, expiresAt: '2999-01-01T00:00:00Z' }
  const gerenteSession: AuthSession = { user: { id: 'u2', name: 'Rony Gerente', role: 'gerente', active: true, email: 'rony@roari.com' }, expiresAt: '2999-01-01T00:00:00Z' }
  return { getSession: vi.fn(), getResumenTurno: vi.fn(), sesionAbierta, cajeroSession, gerenteSession, resumenBase }
})

vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { getSession },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 50000, status: 'open', movements: [] }) },
  turnoService: {
    getSesionAbierta: vi.fn().mockResolvedValue(sesionAbierta),
    getUltimaSesionCerrada: vi.fn().mockResolvedValue(null),
    resumen: (...args: unknown[]) => getResumenTurno(...args),
    misTickets: vi.fn().mockResolvedValue([]),
    gastosPendientes: vi.fn().mockResolvedValue([]),
    turnosEnRevision: vi.fn().mockResolvedValue([]),
    faltantesPendientes: vi.fn().mockResolvedValue([]),
  },
  ventaDirectaService: { listAbiertas: vi.fn().mockResolvedValue([]) },
  sensitiveOperations: { execute: vi.fn() },
}))

afterEach(cleanup)

describe('CashPage — conteo ciego (Brief Caja-1 B3)', () => {
  it('rol cajero: no muestra esperado ni diferencia en ningún lado de la pantalla', async () => {
    getSession.mockResolvedValue(cajeroSession)
    getResumenTurno.mockResolvedValue({ ...resumenBase, esperadoEfectivoBs: null })
    render(<CashSessionProvider><CashPage notify={() => {}} /></CashSessionProvider>)

    await waitFor(() => expect(screen.getByText('Caja Tienda')).toBeTruthy())
    // Un cajero no tiene permiso cash_supervise, así que ni siquiera ve la etiqueta
    // "Efectivo esperado" (el bloque entero es isManager-only) — y por supuesto
    // tampoco ningún monto ni la palabra "diferencia" en el resto de la pantalla.
    await waitFor(() => expect(screen.queryByText(/Mostrador \(VTA\)/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/esperad/i)
    expect(document.body.textContent).not.toMatch(/diferenc/i)
  })

  it('rol gerente: sí muestra esperado', async () => {
    getSession.mockResolvedValue(gerenteSession)
    getResumenTurno.mockResolvedValue({ ...resumenBase, esperadoEfectivoBs: 700 })
    render(<CashSessionProvider><CashPage notify={() => {}} /></CashSessionProvider>)

    await waitFor(() => expect(screen.getByText('Caja Tienda')).toBeTruthy())
    await waitFor(() => expect(document.body.textContent).toMatch(/Bs\s*700/))
  })
})

// Brief Caja VTD tarea 2: "Mostrador (VTA)" y "Ventas directas (VTD)" reemplazan la
// sección única, y "VTD por cobrar" es informativo — nunca entra al arqueo.
describe('CashPage — resumen VTA/VTD (Brief Caja VTD)', () => {
  it('separa ventas de mostrador y VTD, y muestra la tarjeta VTD por cobrar', async () => {
    getSession.mockResolvedValue(gerenteSession)
    getResumenTurno.mockResolvedValue({
      ...resumenBase,
      ventasRetailPorMetodo: { EFECTIVO: 150 },
      ventasVtdPorMetodo: { QR: 300 },
      cantidadVtdCobradas: 2,
      vtdPorCobrar: { cantidad: 3, totalBs: 450 },
      esperadoEfectivoBs: 700,
    })
    render(<CashSessionProvider><CashPage notify={() => {}} /></CashSessionProvider>)

    await waitFor(() => expect(screen.getByText('Mostrador (VTA)')).toBeTruthy())
    expect(screen.getByText('Ventas directas (VTD)')).toBeTruthy()
    expect(screen.getByText('VTD por cobrar')).toBeTruthy()
    expect(document.body.textContent).toMatch(/3 ventas · Bs\s*450/)
  })
})
