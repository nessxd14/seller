// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CashPage } from '../CashPage'
import { CashSessionProvider } from '../../../context/CashSessionContext'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'
import type { TurnoMovimiento, TurnoResumen, TurnoSesion } from '../../../application/shared/models'
import { useEffect } from 'react'

vi.mock('../useCashRefresh', () => ({ useCashRefresh: (refresh: () => Promise<void>) => { useEffect(() => { void refresh() }, [refresh]) } }))

// Brief Caja-1 — blind count (decisión no negociable): un cajero nunca debe ver
// "esperado"/"diferencia" en la pantalla de Caja; un gerente sí. resumen_turno ya lo
// esconde server-side (esperadoEfectivoBs: null para cajero) — este test cubre que el
// frontend efectivamente respeta ese null y no lo recalcula por su cuenta.
const { getSession, getResumenTurno, getSesionAbierta, abrirTurno, cerrarTurno, registrarMovimiento, listarMovimientos, marcarFuera, sesionAbierta, cajeroSession, gerenteSession, resumenBase } = vi.hoisted(() => {
  const sesionAbierta: TurnoSesion = {
    id: '1', cajaId: 1, cajaNombre: 'Caja Tienda', estado: 'ABIERTA', aperturaBs: 500,
    cajeroId: 'u1', abiertaPor: 'natalia@roari.com', abiertaEn: new Date().toISOString(), diferenciaRelevoBs: null,
  }
  const resumenBase: Omit<TurnoResumen, 'esperadoEfectivoBs'> = {
    aperturaBs: 500, ventasPorMetodo: { EFECTIVO: 200 }, ventasRetailPorMetodo: { EFECTIVO: 200 }, ventasVtdPorMetodo: {},
    cantidadVtdCobradas: 0, vtdPorCobrar: { cantidad: 0, totalBs: 0 }, cobrosFueraArqueoBs: 0, anticiposPorMetodo: {}, anulacionesPorMetodo: {},
    gastosPorEstado: {}, remesasBs: 0, inyeccionesBs: 0, cantidadVentas: 1, pagosPendientesVerificacion: 0,
    pagosRechazados: [], diferenciaRelevoBs: null,
  }
  const cajeroSession: AuthSession = { user: { id: 'u1', name: 'Natalia Cajera', role: 'cajero', active: true, email: 'natalia@roari.com' }, expiresAt: '2999-01-01T00:00:00Z' }
  const gerenteSession: AuthSession = { user: { id: 'u2', name: 'Rony Gerente', role: 'gerente', active: true, email: 'rony@roari.com' }, expiresAt: '2999-01-01T00:00:00Z' }
  return { getSession: vi.fn(), getResumenTurno: vi.fn(), getSesionAbierta: vi.fn(), abrirTurno: vi.fn(), cerrarTurno: vi.fn(), registrarMovimiento: vi.fn(), listarMovimientos: vi.fn(), marcarFuera: vi.fn(), sesionAbierta, cajeroSession, gerenteSession, resumenBase }
})

vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { getSession },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 50000, status: 'open', movements: [] }) },
  turnoService: {
    getSesionAbierta: (...args: unknown[]) => getSesionAbierta(...args),
    abrir: (...args: unknown[]) => abrirTurno(...args),
    cerrar: (...args: unknown[]) => cerrarTurno(...args),
    registrarMovimiento: (...args: unknown[]) => registrarMovimiento(...args),
    marcarCobroFueraDeArqueo: (...args: unknown[]) => marcarFuera(...args),
    getUltimaSesionCerrada: vi.fn().mockResolvedValue(null),
    resumen: (...args: unknown[]) => getResumenTurno(...args),
    misTickets: vi.fn().mockResolvedValue([]),
    movimientos: (...args: unknown[]) => listarMovimientos(...args),
    gastosPendientes: vi.fn().mockResolvedValue([]),
    turnosEnRevision: vi.fn().mockResolvedValue([]),
    faltantesPendientes: vi.fn().mockResolvedValue([]),
  },
  ventaDirectaService: { listAbiertas: vi.fn().mockResolvedValue([]) },
  sensitiveOperations: { execute: vi.fn() },
}))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  getSesionAbierta.mockResolvedValue(sesionAbierta)
  listarMovimientos.mockResolvedValue([])
  cerrarTurno.mockResolvedValue({ sesionId: '1', estado: 'CERRADA' })
  registrarMovimiento.mockResolvedValue({ movimientoId: '1' })
  abrirTurno.mockResolvedValue({ sesionId: '1' })
})

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

// ── Brief Caja VTD obligatorio: conteos sin cero, entrega al cierre, fuera del arqueo, "i" ──────

const mov = (over: Partial<TurnoMovimiento>): TurnoMovimiento => ({ id: '1', tipo: 'ANTICIPO', metodo: 'EFECTIVO', montoBs: 40, detalle: '', creadoEn: new Date().toISOString(), fueraDeArqueo: false, ...over })
const montarCaja = () => render(<CashSessionProvider><CashPage notify={notify} /></CashSessionProvider>)
const notify = vi.fn()
const cargarCaja = async (session = cajeroSession, resumen: Record<string, unknown> = {}) => {
  getSession.mockResolvedValue(session)
  getResumenTurno.mockResolvedValue({ ...resumenBase, esperadoEfectivoBs: session === cajeroSession ? null : 700, ...resumen })
  montarCaja()
  await screen.findByText('Mostrador (VTA)')
}
const cantidad = (valor: number) => { const input = screen.getByLabelText('Cantidad de billetes/monedas de 100'); fireEvent.focus(input); fireEvent.change(input, { target: { value: String(valor) } }); fireEvent.blur(input) }
const abrirCierre = async () => { fireEvent.click(screen.getByRole('button', { name: /Cerrar turno/ })); await screen.findByText('¿Entregas efectivo antes de cerrar?') }
const irAlConteo = async () => { await abrirCierre(); fireEvent.click(screen.getByRole('button', { name: 'No entrego nada' })); await screen.findByText('Cuenta el efectivo que queda en el cajón después de la entrega.') }

describe('Abrir turno — conteo en cero (Brief Caja VTD obligatorio B)', () => {
  const abrirVista = async () => { getSession.mockResolvedValue(cajeroSession); getSesionAbierta.mockResolvedValue(null); montarCaja(); await screen.findByRole('button', { name: 'Abrir mi turno' }) }
  const boton = () => screen.getByRole('button', { name: 'Abrir mi turno' }) as HTMLButtonElement

  it('con total 0 el botón está deshabilitado hasta marcar "El cajón está en cero"', async () => {
    await abrirVista()
    expect(boton().disabled).toBe(true)
    const check = screen.getByLabelText('El cajón está en cero') as HTMLInputElement
    expect(check.checked).toBe(false)
    fireEvent.click(check)
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(abrirTurno).toHaveBeenCalledWith({}))
  })

  it('con un conteo > 0 el checkbox desaparece y el botón queda habilitado', async () => {
    await abrirVista()
    cantidad(2)
    expect(screen.queryByLabelText('El cajón está en cero')).toBeNull()
    expect(boton().disabled).toBe(false)
  })
})

describe('Cerrar turno — conteo y entrega (Brief Caja VTD obligatorio B y C)', () => {
  const confirmar = () => screen.getByRole('button', { name: 'Confirmar conteo' }) as HTMLButtonElement

  it('con total 0 exige "El cajón está en cero" y lo envía como cajonVacio = true', async () => {
    await cargarCaja()
    await irAlConteo()
    expect(confirmar().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('El cajón está en cero'))
    expect(confirmar().disabled).toBe(false)
    fireEvent.click(confirmar())
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', {}, true))
  })

  it('con conteo > 0 no hay checkbox y cajonVacio va en false', async () => {
    await cargarCaja()
    await irAlConteo()
    cantidad(3)
    expect(screen.queryByLabelText('El cajón está en cero')).toBeNull()
    fireEvent.click(confirmar())
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 3 }, false))
  })

  it('si marcó el cero y luego cuenta billetes, no se envía cajonVacio', async () => {
    await cargarCaja()
    await irAlConteo()
    fireEvent.click(screen.getByLabelText('El cajón está en cero'))
    cantidad(1)
    fireEvent.click(confirmar())
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 1 }, false))
  })

  it('el mensaje de la base al cerrar llega tal cual a la cajera', async () => {
    cerrarTurno.mockRejectedValue(new Error('No puedes cerrar el turno: hay 2 VTD entregadas sin cobrar.'))
    await cargarCaja()
    await irAlConteo()
    cantidad(1)
    fireEvent.click(confirmar())
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No puedes cerrar el turno: hay 2 VTD entregadas sin cobrar.'))
  })

  it('paso 1: la entrega es una remesa y un reintento reutiliza la misma clave de idempotencia', async () => {
    registrarMovimiento.mockRejectedValueOnce(new Error('Respuesta perdida'))
    await cargarCaja()
    await abrirCierre()
    fireEvent.change(screen.getByLabelText('Monto entregado (Bs)'), { target: { value: '150' } })
    fireEvent.blur(screen.getByLabelText('Monto entregado (Bs)'))
    const registrar = () => screen.getByRole('button', { name: 'Registrar entrega y continuar' }) as HTMLButtonElement
    expect(registrar().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('A quién se lo entregas'), { target: { value: 'Rony' } })
    fireEvent.click(registrar())
    await screen.findByText('Respuesta perdida')
    fireEvent.click(registrar())
    await screen.findByText('Cuenta el efectivo que queda en el cajón después de la entrega.')
    expect(registrarMovimiento).toHaveBeenCalledTimes(2)
    const [primero, reintento] = registrarMovimiento.mock.calls.map((c) => c[0])
    expect(primero).toMatchObject({ sesionId: '1', subtipo: 'REMESA', montoBs: 150, motivo: 'Entrega de cierre a Rony' })
    expect(reintento.idempotencyKey).toBe(primero.idempotencyKey)
    expect(typeof primero.idempotencyKey).toBe('string')
  })

  it('si la entrega ya se registró en este turno, reabrir el cierre salta al conteo y lo avisa', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '8', tipo: 'EGRESO', subtipo: 'REMESA', metodo: 'EFECTIVO', montoBs: 50, detalle: 'Entrega de cierre a Rony' }), mov({ id: '9', tipo: 'EGRESO', subtipo: 'REMESA', montoBs: 999, detalle: 'Remesa al banco' })])
    await cargarCaja()
    fireEvent.click(screen.getByRole('button', { name: /Cerrar turno/ }))
    await screen.findByText(/Ya registraste una entrega de Bs 50,00 en este cierre\./)
    expect(screen.queryByText('¿Entregas efectivo antes de cerrar?')).toBeNull()
    expect(screen.getByText('Cuenta el efectivo que queda en el cajón después de la entrega.')).toBeTruthy()
  })

  it('conteo ciego: ningún paso del cierre muestra esperado ni diferencia', async () => {
    await cargarCaja()
    await abrirCierre()
    expect(document.body.textContent).not.toMatch(/esperad|diferenc/i)
    fireEvent.click(screen.getByRole('button', { name: 'No entrego nada' }))
    await screen.findByText(/Cuenta el efectivo que queda/)
    expect(document.body.textContent).not.toMatch(/esperad|diferenc/i)
  })
})

describe('Cobros fuera del arqueo — actividad y resumen (Brief Caja VTD obligatorio D3)', () => {
  it('gerente: marca y devuelve cobros en efectivo desde la actividad del turno', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '9' }), mov({ id: '10', fueraDeArqueo: true }), mov({ id: '11', metodo: 'QR' })])
    marcarFuera.mockResolvedValue(undefined)
    await cargarCaja(gerenteSession)
    await screen.findByText('Sacar del arqueo')
    expect(screen.getAllByText('Fuera del arqueo').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Sacar del arqueo|Volver al arqueo/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Sacar del arqueo' }))
    await waitFor(() => expect(marcarFuera).toHaveBeenCalledWith('9', true))
    fireEvent.click(screen.getByRole('button', { name: 'Volver al arqueo' }))
    await waitFor(() => expect(marcarFuera).toHaveBeenCalledWith('10', false))
  })

  it('cajero: ve la insignia pero no el botón para sacar del arqueo', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '9' }), mov({ id: '10', fueraDeArqueo: true })])
    await cargarCaja(cajeroSession)
    await screen.findAllByText('Fuera del arqueo')
    expect(screen.queryByRole('button', { name: /Sacar del arqueo|Volver al arqueo/ })).toBeNull()
  })

  it('supervisor (cash_supervise sin permiso admin): ve la actividad pero no el toggle, igual que la elección D2', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '9' })])
    const supervisor: AuthSession = { user: { id: 'u3', name: 'Sol Supervisora', role: 'supervisor', active: true }, expiresAt: '2999-01-01T00:00:00Z' }
    await cargarCaja(supervisor)
    await screen.findByText('Pago / anticipo')
    expect(screen.queryByRole('button', { name: /Sacar del arqueo|Volver al arqueo/ })).toBeNull()
  })

  it('el resumen muestra "Cobros recibidos por gerencia" solo si hay cobros fuera del arqueo', async () => {
    await cargarCaja(gerenteSession)
    expect(screen.queryByText('Cobros recibidos por gerencia')).toBeNull()
    cleanup()
    await cargarCaja(gerenteSession, { cobrosFueraArqueoBs: 120 })
    expect(screen.getByText('Cobros recibidos por gerencia')).toBeTruthy()
    expect(screen.getByText('Fuera del arqueo: no entraron a este cajón.')).toBeTruthy()
  })
})

describe('Pistas "i" en Caja (Brief Caja VTD obligatorio E)', () => {
  it('cada título tiene su "i", abre con clic sin alternar el desglose y no muestra cifras', async () => {
    await cargarCaja(cajeroSession, { vtdPorCobrar: { cantidad: 2, totalBs: 300 } })
    for (const nombre of ['Mostrador (VTA)', 'Venta directa (VTD)', 'Pagos y anticipos', 'VTD por cobrar']) {
      expect(screen.getAllByRole('button', { name: `Qué es ${nombre}` }).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByRole('button', { name: 'Qué es Gasto' }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Qué es Remesa' }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Qué es Inyección' }).length).toBe(2)
    const fila = screen.getByText('Mostrador (VTA)').closest('details') as HTMLDetailsElement
    fireEvent.click(within(fila).getByRole('button', { name: 'Qué es Mostrador (VTA)' }))
    expect(fila.open).toBe(false)
    expect(within(fila).getByRole('dialog').textContent).toBe('Mostrador (VTA)Lo que cobraste por ventas de tienda. El efectivo va a tu cajón; QR y transferencia van al banco.')
  })

  it('el modal de Remesa usa la explicación como subtítulo', async () => {
    await cargarCaja()
    fireEvent.click(screen.getByRole('button', { name: /^Remesa$/ }))
    await screen.findByText('Efectivo que entregas al gerente o al banco. No se gasta, solo cambia de lugar. Si le entregas plata al gerente, es remesa, no gasto.')
  })

  it('las filas de anulación llevan su "i"', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '5', tipo: 'ANULACION', metodo: 'EFECTIVO' })])
    await cargarCaja()
    await screen.findByRole('button', { name: 'Qué es Anulación' })
  })
})
