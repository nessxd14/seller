// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CashPage } from '../CashPage'
import { CashSessionProvider } from '../../../context/CashSessionContext'
import type { AuthSession } from '../../../application/auth/AuthSessionProvider'
import type { TurnoMovimiento, TurnoResumen, TurnoSesion } from '../../../application/shared/models'
import { useEffect } from 'react'
import { ventaDirectaService } from '../../../infrastructure/services'

vi.mock('../useCashRefresh', () => ({ useCashRefresh: (refresh: () => Promise<void>) => { useEffect(() => { void refresh() }, [refresh]) } }))

// Brief Caja-1 — blind count (decisión no negociable): un cajero nunca debe ver
// "esperado"/"diferencia" en la pantalla de Caja; un gerente sí. resumen_turno ya lo
// esconde server-side (esperadoEfectivoBs: null para cajero) — este test cubre que el
// frontend efectivamente respeta ese null y no lo recalcula por su cuenta.
const { getSession, getResumenTurno, getSesionAbierta, abrirTurno, cerrarTurno, cerrarGerente,registrarMovimiento, listarMovimientos, marcarFuera, gastosPendientes, turnosEnRevision, resolverGasto, revisarTurno, conteoCierre, sesionAbierta, cajeroSession, gerenteSession, resumenBase } = vi.hoisted(() => {
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
  return { getSession: vi.fn(), getResumenTurno: vi.fn(), getSesionAbierta: vi.fn(), abrirTurno: vi.fn(), cerrarTurno: vi.fn(), cerrarGerente: vi.fn(),registrarMovimiento: vi.fn(), listarMovimientos: vi.fn(), marcarFuera: vi.fn(), gastosPendientes: vi.fn(), turnosEnRevision: vi.fn(), resolverGasto: vi.fn(), revisarTurno: vi.fn(), conteoCierre: vi.fn(), sesionAbierta, cajeroSession, gerenteSession, resumenBase }
})

vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { getSession },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 50000, status: 'open', movements: [] }) },
  turnoService: {
    getSesionAbierta: (...args: unknown[]) => getSesionAbierta(...args),
    abrir: (...args: unknown[]) => abrirTurno(...args),
    cerrar: (...args: unknown[]) => cerrarTurno(...args),
    cerrarGerente: (...args: unknown[]) => cerrarGerente(...args),
    registrarMovimiento: (...args: unknown[]) => registrarMovimiento(...args),
    marcarCobroFueraDeArqueo: (...args: unknown[]) => marcarFuera(...args),
    getUltimaSesionCerrada: vi.fn().mockResolvedValue(null),
    resumen: (...args: unknown[]) => getResumenTurno(...args),
    misTickets: vi.fn().mockResolvedValue([]),
    movimientos: (...args: unknown[]) => listarMovimientos(...args),
    gastosPendientes: (...args: unknown[]) => gastosPendientes(...args),
    turnosEnRevision: (...args: unknown[]) => turnosEnRevision(...args),
    faltantesPendientes: vi.fn().mockResolvedValue([]),
    resolverGasto: (...args: unknown[]) => resolverGasto(...args),
    revisar: (...args: unknown[]) => revisarTurno(...args),
    conteoCierre: (...args: unknown[]) => conteoCierre(...args),
    comprobanteUrl: vi.fn().mockResolvedValue(null),
    estadoBancoQr: vi.fn().mockResolvedValue({ ultimoLatido: null, minutosDesde: null, enLinea: true }),
    pagosPorVerificar: vi.fn().mockResolvedValue([]),
    movimientosBancoSinVincular: vi.fn().mockResolvedValue([]),
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
  gastosPendientes.mockResolvedValue([])
  turnosEnRevision.mockResolvedValue([])
  resolverGasto.mockResolvedValue(undefined)
  revisarTurno.mockResolvedValue(undefined)
  conteoCierre.mockResolvedValue(null)
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
const escribir = (label: string, valor: number | string) => { const input = screen.getByLabelText(label); fireEvent.focus(input); fireEvent.change(input, { target: { value: String(valor) } }); fireEvent.blur(input) }
const cantidad = (valor: number, denominacion = 100) => escribir(`Cantidad de billetes/monedas de ${denominacion}`, valor)
const entregar = (valor: number, denominacion = 100) => escribir(`Billetes/monedas de ${denominacion} que entregas`, valor)
const PASO_CONTEO = 'Cuenta todo el efectivo del cajón, billete por billete.'
const abrirCierre = async () => { fireEvent.click(screen.getByRole('button', { name: /Cerrar turno/ })); await screen.findByText(PASO_CONTEO) }
const boton = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

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

describe('Cerrar turno — contar, entregar y confirmar', () => {
  it('el botón de cierre está en la barra de acciones de arriba, no al final', async () => {
    await cargarCaja()
    const barra = screen.getByRole('toolbar', { name: 'Acciones del turno' })
    expect(within(barra).getByRole('button', { name: /Cerrar turno/ })).toBeTruthy()
    expect(within(barra).getByRole('button', { name: /Registrar gasto/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Cerrar turno/ })).toHaveLength(1)
  })

  it('paso 1 primero pide contar todo: con total 0 exige "El cajón está en cero" y cierra con cajonVacio = true', async () => {
    await cargarCaja()
    await abrirCierre()
    expect(boton('Continuar').disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('El cajón está en cero'))
    fireEvent.click(boton('Continuar'))
    // Con el cajón en cero no hay nada que entregar: salta directo a confirmar.
    await screen.findByText('Queda en el cajón')
    fireEvent.click(boton('Confirmar cierre'))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', {}, true))
    expect(registrarMovimiento).not.toHaveBeenCalled()
  })

  it('sin entrega: cierra con lo contado y cajonVacio en false', async () => {
    await cargarCaja()
    await abrirCierre()
    cantidad(3)
    expect(screen.queryByLabelText('El cajón está en cero')).toBeNull()
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'No entrego nada' }))
    await screen.findByText('Queda en el cajón')
    fireEvent.click(boton('Confirmar cierre'))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 3 }, false))
    expect(registrarMovimiento).not.toHaveBeenCalled()
  })

  it('con entrega por denominación: registra la remesa y cierra con lo que queda, calculado solo', async () => {
    await cargarCaja()
    await abrirCierre()
    cantidad(5)
    cantidad(4, 20)
    fireEvent.click(boton('Continuar'))
    await screen.findByLabelText('Billetes/monedas de 100 que entregas')
    // Solo aparecen las denominaciones que se contaron.
    expect(screen.queryByLabelText('Billetes/monedas de 50 que entregas')).toBeNull()
    entregar(3)
    expect(boton('Continuar').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('A quién se lo entregas'), { target: { value: 'Rony' } })
    fireEvent.click(boton('Continuar'))
    await screen.findByText('Queda en el cajón')
    expect(screen.getByText('Entregas a Rony')).toBeTruthy()
    expect(document.body.textContent).toMatch(/Queda en el cajónBs\s*280,00/)
    fireEvent.click(boton('Confirmar cierre'))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 2, '20': 4 }, false))
    expect(registrarMovimiento).toHaveBeenCalledTimes(1)
    expect(registrarMovimiento.mock.calls[0][0]).toMatchObject({ sesionId: '1', subtipo: 'REMESA', montoBs: 300, motivo: 'Entrega de cierre a Rony' })
    expect(registrarMovimiento.mock.invocationCallOrder[0]).toBeLessThan(cerrarTurno.mock.invocationCallOrder[0])
  })

  it('no deja entregar más billetes de los que se contaron', async () => {
    await cargarCaja()
    await abrirCierre()
    cantidad(2)
    fireEvent.click(boton('Continuar'))
    await screen.findByLabelText('Billetes/monedas de 100 que entregas')
    entregar(9)
    expect((screen.getByLabelText('Billetes/monedas de 100 que entregas') as HTMLInputElement).value).toBe('2')
  })

  it('si entrega todo, el cajón queda en cero y se envía cajonVacio = true', async () => {
    await cargarCaja()
    await abrirCierre()
    cantidad(2)
    fireEvent.click(boton('Continuar'))
    await screen.findByLabelText('Billetes/monedas de 100 que entregas')
    entregar(2)
    fireEvent.change(screen.getByLabelText('A quién se lo entregas'), { target: { value: 'Rony' } })
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', {}, true))
  })

  it('un reintento de la entrega reutiliza la misma clave de idempotencia', async () => {
    registrarMovimiento.mockRejectedValueOnce(new Error('Respuesta perdida'))
    await cargarCaja()
    await abrirCierre()
    cantidad(3)
    fireEvent.click(boton('Continuar'))
    await screen.findByLabelText('Billetes/monedas de 100 que entregas')
    entregar(1)
    fireEvent.change(screen.getByLabelText('A quién se lo entregas'), { target: { value: 'Rony' } })
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }))
    await screen.findByText('Respuesta perdida')
    expect(cerrarTurno).not.toHaveBeenCalled()
    fireEvent.click(boton('Confirmar cierre'))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 2 }, false))
    expect(registrarMovimiento).toHaveBeenCalledTimes(2)
    const [primero, reintento] = registrarMovimiento.mock.calls.map((c) => c[0])
    expect(typeof primero.idempotencyKey).toBe('string')
    expect(reintento.idempotencyKey).toBe(primero.idempotencyKey)
  })

  it('si la entrega ya se registró en este turno, no la vuelve a pedir y lo avisa', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '8', tipo: 'EGRESO', subtipo: 'REMESA', metodo: 'EFECTIVO', montoBs: 50, detalle: 'Entrega de cierre a Rony' }), mov({ id: '9', tipo: 'EGRESO', subtipo: 'REMESA', montoBs: 999, detalle: 'Remesa al banco' })])
    await cargarCaja()
    await abrirCierre()
    await screen.findByText(/Ya registraste una entrega de Bs 50,00 en este cierre\./)
    cantidad(1)
    fireEvent.click(boton('Continuar'))
    await screen.findByText('Queda en el cajón')
    expect(screen.queryByLabelText(/que entregas/)).toBeNull()
    fireEvent.click(boton('Confirmar cierre'))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 1 }, false))
    expect(registrarMovimiento).not.toHaveBeenCalled()
  })

  it('el mensaje de la base al cerrar llega tal cual a la cajera', async () => {
    cerrarTurno.mockRejectedValue(new Error('No puedes cerrar el turno: hay 2 VTD entregadas sin cobrar.'))
    await cargarCaja()
    await abrirCierre()
    cantidad(1)
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'No entrego nada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No puedes cerrar el turno: hay 2 VTD entregadas sin cobrar.'))
  })

  it('conteo ciego: ningún paso del cierre muestra esperado ni diferencia', async () => {
    await cargarCaja()
    await abrirCierre()
    expect(document.body.textContent).not.toMatch(/esperad|diferenc/i)
    cantidad(2)
    fireEvent.click(boton('Continuar'))
    await screen.findByLabelText('Billetes/monedas de 100 que entregas')
    expect(document.body.textContent).not.toMatch(/esperad|diferenc/i)
    fireEvent.click(boton('No entrego nada'))
    await screen.findByText('Queda en el cajón')
    expect(document.body.textContent).not.toMatch(/esperad|diferenc/i)
  })
})

describe('Supervisión — gastos y cierres separados', () => {
  const gasto = { id: 'g1', sesionCajaId: '1', montoBs: 80, motivo: 'Flete a Carlos por PED-024', estado: 'PENDIENTE' as const, registradoPor: 'natalia@roari.com', registradoEn: new Date().toISOString() }
  const enRevision: TurnoSesion = { ...sesionAbierta, id: '7', estado: 'EN_REVISION', abiertaPor: 'pedro@roari.com', cerradaEn: new Date().toISOString() }
  const abrirSupervision = async (antes?: () => void) => {
    await cargarCaja(gerenteSession)
    antes?.()
    fireEvent.click(screen.getByRole('button', { name: 'Supervisión' }))
    await screen.findByRole('heading', { name: 'Gastos por aprobar' })
  }

  it('cada bandeja tiene su título y contador propio', async () => {
    gastosPendientes.mockResolvedValue([gasto])
    turnosEnRevision.mockResolvedValue([enRevision])
    await abrirSupervision()
    expect(screen.getByRole('heading', { name: 'Cierres de turno por aprobar' })).toBeTruthy()
    const bandejaGastos = screen.getByRole('region', { name: 'Gastos por aprobar' })
    const bandejaCierres = screen.getByRole('region', { name: 'Cierres de turno por aprobar' })
    expect(within(bandejaGastos).getByText('Flete a Carlos por PED-024')).toBeTruthy()
    expect(within(bandejaGastos).queryByRole('button', { name: /Aprobar cierre/ })).toBeNull()
    expect(within(bandejaCierres).getByText(/Turno #7/)).toBeTruthy()
    expect(within(bandejaCierres).queryByRole('button', { name: /Aprobar gasto/ })).toBeNull()
  })

  it('rechazar un gasto pide el motivo en línea, sin prompt del navegador', async () => {
    const prompt = vi.spyOn(window, 'prompt')
    gastosPendientes.mockResolvedValue([gasto])
    await abrirSupervision()
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }))
    fireEvent.change(screen.getByLabelText('Motivo del rechazo (opcional)'), { target: { value: 'Sin factura' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }))
    await waitFor(() => expect(resolverGasto).toHaveBeenCalledWith('g1', false, 'Sin factura'))
    expect(prompt).not.toHaveBeenCalled()
  })

  it('aprobar un gasto no pide nota', async () => {
    gastosPendientes.mockResolvedValue([gasto])
    await abrirSupervision()
    fireEvent.click(screen.getByRole('button', { name: /Aprobar gasto/ }))
    await waitFor(() => expect(resolverGasto).toHaveBeenCalledWith('g1', true, undefined))
  })

  it('el cierre muestra esperado, contado y diferencia, y exige la nota para aprobarse', async () => {
    turnosEnRevision.mockResolvedValue([enRevision])
    conteoCierre.mockResolvedValue(230)
    // cargarCaja fija el resumen del turno abierto; después se distingue el del turno en revisión.
    await abrirSupervision(() => getResumenTurno.mockImplementation(async (id: string) => ({ ...resumenBase, remesasBs: 1000, esperadoEfectivoBs: id === '7' ? 250 : 700 })))
    const bandeja = screen.getByRole('region', { name: 'Cierres de turno por aprobar' })
    await waitFor(() => expect(bandeja.textContent).toMatch(/Diferencia−\s*Bs\s*20,00/))
    expect(bandeja.textContent).toMatch(/EsperadoBs\s*250,00/)
    expect(bandeja.textContent).toMatch(/ContadoBs\s*230,00/)
    const aprobar = within(bandeja).getByRole('button', { name: /Aprobar cierre/ }) as HTMLButtonElement
    expect(aprobar.disabled).toBe(true)
    fireEvent.change(within(bandeja).getByLabelText('Nota de revisión (obligatoria)'), { target: { value: 'Faltan Bs 20, se descuenta' } })
    expect(aprobar.disabled).toBe(false)
    fireEvent.click(aprobar)
    await waitFor(() => expect(revisarTurno).toHaveBeenCalledWith('7', 'Faltan Bs 20, se descuenta'))
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

describe('Cerrar turno — VTD abiertas: la base decide', () => {
  const vtd = (over: Record<string, unknown> = {}) => ({ id: 'v1', cobroExigible: true, pagoPosterior: false, totalCents: 10000, paidCents: 0, ...over })
  const listAbiertas = () => ventaDirectaService.listAbiertas as unknown as ReturnType<typeof vi.fn>
  const pulsarCerrar = () => fireEvent.click(screen.getByRole('button', { name: /Cerrar turno/ }))
  const AVISO = 'Hay 1 venta(s) directa(s) pendientes. Resuélvelas en "Operaciones en espera de Almacén" antes de cerrar.'

  it('una VTD abierta sin cobrar no bloquea en el cliente: avisa y deja llegar a cerrar_turno', async () => {
    listAbiertas().mockResolvedValue([vtd()])
    await cargarCaja()
    pulsarCerrar()
    await screen.findByText(PASO_CONTEO)
    expect(notify).toHaveBeenCalledWith(AVISO)
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('se puede cerrar'))
    cantidad(1)
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'No entrego nada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 1 }, false))
  })

  it('una VTD cobrada también da el aviso no bloqueante', async () => {
    listAbiertas().mockResolvedValue([vtd({ paidCents: 10000 })])
    await cargarCaja()
    pulsarCerrar()
    await screen.findByText(PASO_CONTEO)
    expect(notify).toHaveBeenCalledWith(AVISO)
  })

  it('si falla la consulta de VTD abiertas, el cierre se abre igual', async () => {
    listAbiertas().mockRejectedValue(new Error('red'))
    await cargarCaja()
    pulsarCerrar()
    await screen.findByText(PASO_CONTEO)
  })

  it('sin VTD abiertas abre el cierre sin aviso', async () => {
    listAbiertas().mockResolvedValue([])
    await cargarCaja()
    pulsarCerrar()
    await screen.findByText(PASO_CONTEO)
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('Cerrar turno — cierre forzado del gerente', () => {
  const BLOQUEO = 'No puedes cerrar el turno: hay 1 VTD en espera de Almacén sin cobrar.'
  const intentarCierre = async () => {
    await abrirCierre()
    cantidad(2)
    fireEvent.click(boton('Continuar'))
    fireEvent.click(await screen.findByRole('button', { name: 'No entrego nada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cierre' }))
    await waitFor(() => expect(cerrarTurno).toHaveBeenCalledWith('1', { '100': 2 }, false))
  }

  it('gerente: tras el bloqueo por VTD ofrece "Cerrar como gerente" y llama con el mismo conteo y el motivo', async () => {
    cerrarTurno.mockRejectedValue(new Error(BLOQUEO))
    cerrarGerente.mockResolvedValue({ sesionId: '1', estado: 'CERRADA', forzado: true, pendientes: [{ ventaId: '784', numero: 'VTD-2026-00784', totalBs: 240 }] })
    await cargarCaja(gerenteSession)
    await intentarCierre()
    expect(await screen.findByText(BLOQUEO)).toBeTruthy()
    const confirmar = await screen.findByRole('button', { name: 'Cerrar como gerente' }) as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo del cierre'), { target: { value: 'corto' } })
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo del cierre'), { target: { value: 'Almacén no despachó VTD-784' } })
    fireEvent.click(confirmar)
    await waitFor(() => expect(cerrarGerente).toHaveBeenCalledWith('1', { '100': 2 }, 'Almacén no despachó VTD-784', false))
    const pendientes = await screen.findByRole('list', { name: 'VTD pendientes' })
    expect(pendientes.textContent).toContain('VTD-2026-00784 · Bs 240,00')
    expect(screen.getByText(/quedan en «Operaciones en espera de Almacén»/)).toBeTruthy()
  })

  it('gerente: el error de cerrar_turno_gerente se muestra en el modal', async () => {
    cerrarTurno.mockRejectedValue(new Error(BLOQUEO))
    cerrarGerente.mockRejectedValue(new Error('El motivo debe tener al menos 10 caracteres.'))
    await cargarCaja(gerenteSession)
    await intentarCierre()
    fireEvent.change(await screen.findByLabelText('Motivo del cierre'), { target: { value: 'Motivo suficientemente largo' } })
    fireEvent.click(boton('Cerrar como gerente'))
    expect((await screen.findByText('El motivo debe tener al menos 10 caracteres.')).getAttribute('role')).toBe('alert')
    expect(screen.queryByRole('list', { name: 'VTD pendientes' })).toBeNull()
  })

  it('gerente: otro error de cierre no ofrece el cierre forzado', async () => {
    const otro = 'Conteo en cero: el sistema espera efectivo en el cajón. Si está vacío, márcalo.'
    cerrarTurno.mockRejectedValue(new Error(otro))
    await cargarCaja(gerenteSession)
    await intentarCierre()
    await waitFor(() => expect(notify).toHaveBeenCalledWith(otro))
    expect(screen.queryByRole('button', { name: 'Cerrar como gerente' })).toBeNull()
  })

  it('cajero: ve el mensaje de la base y nunca la opción de gerente', async () => {
    cerrarTurno.mockRejectedValue(new Error(BLOQUEO))
    await cargarCaja()
    await intentarCierre()
    await waitFor(() => expect(notify).toHaveBeenCalledWith(BLOQUEO))
    expect(screen.queryByRole('button', { name: 'Cerrar como gerente' })).toBeNull()
    expect(cerrarGerente).not.toHaveBeenCalled()
  })
})

describe('Actividad del turno compacta (una línea por movimiento)', () => {
  const filas = () => document.querySelectorAll('.actividad-row')

  it('la venta trae sus acciones de ticket en la misma fila y ya no existe la sección "Mis tickets"', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '1', tipo: 'VENTA', documento: 'VTA-2026-00001', ventaId: '55' })])
    await cargarCaja()
    await waitFor(() => expect(filas()).toHaveLength(1))
    const fila = filas()[0] as HTMLElement
    expect(within(fila).getByRole('button', { name: 'Ver productos' })).toBeTruthy()
    expect(within(fila).getByRole('button', { name: 'Reimprimir' })).toBeTruthy()
    expect(screen.queryByText('Mis tickets')).toBeNull()
  })

  it('los filtros muestran cuántos hay de cada tipo y filtran con un clic', async () => {
    listarMovimientos.mockResolvedValue([
      mov({ id: '1', tipo: 'VENTA', documento: 'VTA-2026-00001', ventaId: '55' }),
      mov({ id: '2', tipo: 'VENTA', documento: 'VTA-2026-00002', ventaId: '56' }),
      mov({ id: '3', tipo: 'EGRESO', subtipo: 'GASTO', detalle: 'Flete de prueba', estadoGasto: 'PENDIENTE' }),
    ])
    await cargarCaja()
    await waitFor(() => expect(filas()).toHaveLength(3))
    const grupo = screen.getByRole('group', { name: 'Filtrar movimientos' })
    expect(within(grupo).getByRole('button', { name: 'Todo 3' }).getAttribute('aria-pressed')).toBe('true')
    // Solo aparecen los tipos que existen en el turno.
    expect(within(grupo).queryByRole('button', { name: /Remesas/ })).toBeNull()
    fireEvent.click(within(grupo).getByRole('button', { name: 'Gastos 1' }))
    expect(filas()).toHaveLength(1)
    expect(screen.getByText('Flete de prueba')).toBeTruthy()
    fireEvent.click(within(grupo).getByRole('button', { name: 'Ventas 2' }))
    expect(filas()).toHaveLength(2)
  })

  it('muestra los últimos 15 y "Ver más" carga el resto', async () => {
    listarMovimientos.mockResolvedValue(Array.from({ length: 20 }, (_, i) => mov({ id: String(i + 1), tipo: 'VENTA', documento: `VTA-2026-${i + 1}`, ventaId: String(i + 1) })))
    await cargarCaja()
    await waitFor(() => expect(filas()).toHaveLength(15))
    fireEvent.click(screen.getByRole('button', { name: /Ver 5 más/ }))
    expect(filas()).toHaveLength(20)
    expect(screen.queryByRole('button', { name: /más/ })).toBeNull()
  })

  it('un clic en el detalle lo despliega completo', async () => {
    listarMovimientos.mockResolvedValue([mov({ id: '3', tipo: 'EGRESO', subtipo: 'GASTO', detalle: 'Un detalle largo del gasto' })])
    await cargarCaja()
    const texto = await screen.findByRole('button', { name: /Un detalle largo del gasto/ })
    expect(texto.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(texto)
    expect(texto.getAttribute('aria-expanded')).toBe('true')
    expect(texto.closest('.actividad-row')?.classList.contains('abierta')).toBe(true)
  })
})
