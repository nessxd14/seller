import { ArrowDownLeft, ArrowUpRight, Calculator, LockKeyhole, Printer, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import { hasPermission } from '../../application/auth/AuthSessionProvider'
import type { CajaFaltanteRecord, CajaGastoRecord, CashSessionRecord, Denominaciones, EstadoBancoQr, MovimientoBancoQr, PagoPorVerificar, TurnoResumen, TurnoSesion, TurnoTicket } from '../../application/shared/models'
import { sugerirPagosQr, type SugerenciaQr } from '../../domain/cash/qrSuggestions'
import { authSessionProvider, cashService, sensitiveOperations, turnoService, ventaDirectaService } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { DenominationCount } from '../../components/DenominationCount'
import { VentaTicket } from '../../components/VentaTicket'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const metodoLabel: Record<string, string> = { EFECTIVO: 'Efectivo', QR: 'QR', TRANSFERENCIA: 'Transferencia', SIGEP: 'SIGEP', CHEQUE: 'Cheque', DEPOSITO: 'Depósito' }

/**
 * Brief Caja-1 B2 — reconstruido sobre las RPCs de turno (abrir_turno/cerrar_turno/
 * resumen_turno/…). El modo mock NO tiene esas RPCs (son Supabase-only, ver
 * TurnoRepository.supabase.ts) así que conserva el flujo simple de abrir/cerrar caja de
 * siempre — MockCashPage de más abajo es exactamente el CashPage.tsx anterior a este
 * brief, sin tocar una línea.
 */
export function CashPage({ notify, canCloseCash = true }: { notify: (message: string) => void; canCloseCash?: boolean }) {
  if (!featureFlags.supabase) return <MockCashPage notify={notify} canCloseCash={canCloseCash} />
  return <TurnoCashPage notify={notify} />
}

function TurnoCashPage({ notify }: { notify: (message: string) => void }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [sesion, setSesion] = useState<TurnoSesion | null | 'loading'>('loading')
  const [tab, setTab] = useState<'mi-turno' | 'supervision'>('mi-turno')
  const { refresh: refreshCashSession } = useCashSession()
  const puedeSupervisar = hasPermission(session, 'cash_supervise')

  const load = async () => setSesion(await turnoService.getSesionAbierta())
  useEffect(() => { void authSessionProvider.getSession().then(setSession) }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del turno abierto, una sola vez al montar
  useEffect(() => { void load() }, [])

  const onOpened = async () => { await load(); await refreshCashSession(); notify('Turno abierto') }
  const onClosed = async () => { await load(); await refreshCashSession() }

  return <FeatureShell
    eyebrow="CONTROL DE CAJA"
    title="Caja"
    subtitle="Apertura, movimientos y cierre de turno — Caja Tienda"
    action={puedeSupervisar ? <div className="turno-tabs" role="tablist"><button role="tab" className={tab === 'mi-turno' ? 'active' : ''} onClick={() => setTab('mi-turno')}>Mi turno</button><button role="tab" className={tab === 'supervision' ? 'active' : ''} onClick={() => setTab('supervision')}>Supervisión</button></div> : undefined}
  >
    {tab === 'supervision' && puedeSupervisar
      ? <SupervisionPanel notify={notify} />
      : sesion === 'loading'
        ? <FeatureState type="loading" text="Cargando turno" />
        : sesion
          ? <MiTurnoPanel sesion={sesion} isManager={puedeSupervisar} notify={notify} onClosed={onClosed} />
          : <AbrirTurnoView notify={notify} onOpened={onOpened} />}
  </FeatureShell>
}

function AbrirTurnoView({ notify, onOpened }: { notify: (message: string) => void; onOpened: () => void }) {
  const [handover, setHandover] = useState<string | null>(null)
  const [denominaciones, setDenominaciones] = useState<Denominaciones>({})
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { void turnoService.getUltimaSesionCerrada().then((h) => setHandover(h?.entregadoPor ?? null)) }, [])
  const abrir = async () => {
    setSubmitting(true)
    try {
      await turnoService.abrir(denominaciones)
      onOpened()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo abrir el turno')
    } finally {
      setSubmitting(false)
    }
  }
  return <div className="cash-empty turno-abrir">
    <div><WalletCards /></div>
    <h2>No hay un turno abierto</h2>
    {/* Blind count (B2): nunca el monto anterior — solo el nombre de quien entrega. */}
    {handover && <p>Recibís la caja de <strong>{handover}</strong>. Contá el efectivo.</p>}
    <DenominationCount value={denominaciones} onChange={setDenominaciones} />
    <button className="primary-button" disabled={submitting} onClick={() => void abrir()}>{submitting ? 'Abriendo…' : 'Abrir turno'}</button>
  </div>
}

function TurnoHeaderChip({ sesion }: { sesion: TurnoSesion }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id) }, [])
  const openedAt = new Date(sesion.abiertaEn).getTime()
  const minutes = Math.max(0, Math.round((now - openedAt) / 60000))
  const horas = Math.floor(minutes / 60)
  const mins = minutes % 60
  return <div>
    <span>TURNO ABIERTO</span>
    <h2>{sesion.cajaNombre}</h2>
    <p>{sesion.abiertaPor ?? 'Cajero'} · desde {new Date(sesion.abiertaEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })} · {horas > 0 ? `${horas} h ` : ''}{mins} min</p>
  </div>
}

function MiTurnoPanel({ sesion, isManager, notify, onClosed }: { sesion: TurnoSesion; isManager: boolean; notify: (message: string) => void; onClosed: () => void }) {
  const [resumen, setResumen] = useState<TurnoResumen | null>(null)
  const [tickets, setTickets] = useState<TurnoTicket[]>([])
  const [movimientoOpen, setMovimientoOpen] = useState<'GASTO' | 'REMESA' | 'INYECCION' | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeResult, setCloseResult] = useState<{ estado: string } | null>(null)
  const [reprintId, setReprintId] = useState<string | null>(null)

  const load = async () => {
    const [r, t] = await Promise.all([turnoService.resumen(sesion.id), turnoService.misTickets(sesion.id)])
    setResumen(r); setTickets(t)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect -- recarga el resumen/tickets cuando cambia de sesión (apertura/cierre de turno)
  useEffect(() => { void load() }, [sesion.id])

  const registrarMovimiento = async (subtipo: 'GASTO' | 'REMESA' | 'INYECCION', montoBs: number, motivo: string, comprobantePath?: string) => {
    try {
      await turnoService.registrarMovimiento({ sesionId: sesion.id, subtipo, montoBs, motivo, comprobantePath })
      setMovimientoOpen(null)
      notify(subtipo === 'GASTO' ? 'Gasto registrado' : subtipo === 'REMESA' ? 'Remesa registrada' : 'Inyección registrada')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo registrar el movimiento')
    }
  }

  // Brief VTD 2.4, ahora para turno: mismo chequeo proactivo que la caja legacy.
  const abrirCierre = async () => {
    const abiertas = await ventaDirectaService.listAbiertas(sesion.id)
    if (abiertas.length) { notify(`No se puede cerrar el turno: hay ${abiertas.length} venta${abiertas.length > 1 ? 's' : ''} directa${abiertas.length > 1 ? 's' : ''} de almacén abierta${abiertas.length > 1 ? 's' : ''}. Resolvelas en Venta Directa antes de cerrar.`); return }
    setClosing(true)
  }
  const confirmarCierre = async (denominaciones: Denominaciones) => {
    try {
      const result = await turnoService.cerrar(sesion.id, denominaciones)
      setClosing(false)
      setCloseResult({ estado: result.estado })
      notify(result.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión del gerente')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cerrar el turno')
    }
  }

  return <div className="cash-layout turno-layout">
    <section className="cash-hero"><TurnoHeaderChip sesion={sesion} /><WalletCards />
      {/* B3: esperado/diferencia NUNCA para un cajero — esta tarjeta solo aparece si
          isManager, y aun así el dato viene de resumen_turno (ya redactado server-side
          para cajero), nunca recalculado acá. */}
      {isManager && <footer><span>Efectivo esperado</span><strong>{resumen?.esperadoEfectivoBs != null ? formatMoney(money(Math.round(resumen.esperadoEfectivoBs * 100))) : '—'}</strong>{resumen?.diferenciaRelevoBs ? <small>Relevo: {resumen.diferenciaRelevoBs >= 0 ? '+' : ''}{bs(resumen.diferenciaRelevoBs)}</small> : null}</footer>}
    </section>
    {resumen && <section className="cash-methods"><h3>Ventas por método</h3>
      {Object.keys(resumen.ventasPorMetodo).length
        ? Object.entries(resumen.ventasPorMetodo).map(([m, v]) => <div key={m}><span>{metodoLabel[m] ?? m}</span><strong>Bs {bs(v)}</strong></div>)
        : <FeatureState type="empty" text="Sin ventas todavía en este turno" />}
    </section>}
    {resumen && <section className="cash-methods"><h3>Gastos, remesas e inyecciones</h3>
      <div><span>Gastos aprobados</span><strong>Bs {bs(resumen.gastosPorEstado.aprobado ?? 0)}</strong></div>
      <div><span>Gastos pendientes</span><strong>Bs {bs(resumen.gastosPorEstado.pendiente ?? 0)}</strong></div>
      <div><span>Remesas</span><strong>Bs {bs(resumen.remesasBs)}</strong></div>
      <div><span>Inyecciones</span><strong>Bs {bs(resumen.inyeccionesBs)}</strong></div>
    </section>}
    <section className="cash-movements"><header><h3>Acciones</h3><div>
      <button onClick={() => setMovimientoOpen('GASTO')}><ArrowUpRight /> Registrar gasto</button>
      <button onClick={() => setMovimientoOpen('REMESA')}><ArrowUpRight /> Remesa</button>
      <button onClick={() => setMovimientoOpen('INYECCION')}><ArrowDownLeft /> Inyección</button>
    </div></header></section>
    <section className="cash-movements"><h3>Mis tickets</h3>
      {tickets.length ? tickets.map((t) => <div key={t.ventaId} className="turno-ticket-row">
        <span>{t.numero ?? `#${t.ventaId}`}<small>{new Date(t.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</small></span>
        <span>{t.metodos.map((m) => metodoLabel[m.metodo] ?? m.metodo).join(' + ') || '—'}</span>
        {t.metodos.some((m) => m.estadoVerificacion === 'PENDIENTE') && <span className="qr-pendiente-chip">QR pendiente</span>}
        <b>Bs {bs(t.totalBs)}</b>
        <button type="button" onClick={() => setReprintId(t.ventaId)}><Printer /> Reimprimir</button>
      </div>) : <FeatureState type="empty" text="Sin ventas todavía en este turno" />}
    </section>
    <button className="close-cash-button" onClick={() => void abrirCierre()}><LockKeyhole /> Cerrar turno</button>
    {movimientoOpen && <MovimientoTurnoModal tipo={movimientoOpen} sesionId={sesion.id} onClose={() => setMovimientoOpen(null)} onConfirm={registrarMovimiento} />}
    {closing && <CerrarTurnoModal onClose={() => setClosing(false)} onConfirm={confirmarCierre} />}
    {closeResult && <Modal title={closeResult.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión'} onClose={() => { setCloseResult(null); onClosed() }}>
      <div className="success-state"><span>✓</span><h3>{closeResult.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión del gerente'}</h3></div>
      <footer className="modal-actions"><button className="primary-button full-button" onClick={() => { setCloseResult(null); onClosed() }}>Aceptar</button></footer>
    </Modal>}
    {reprintId && <VentaTicket id={reprintId} onClose={() => setReprintId(null)} />}
  </div>
}

function MovimientoTurnoModal({ tipo, sesionId, onClose, onConfirm }: { tipo: 'GASTO' | 'REMESA' | 'INYECCION'; sesionId: string; onClose: () => void; onConfirm: (tipo: 'GASTO' | 'REMESA' | 'INYECCION', montoBs: number, motivo: string, comprobantePath?: string) => void }) {
  const [monto, setMonto] = useState(0)
  const [motivo, setMotivo] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const valid = monto > 0 && motivo.trim().length > 0
  const titulo = tipo === 'GASTO' ? 'Registrar gasto' : tipo === 'REMESA' ? 'Registrar remesa' : 'Registrar inyección'
  const submit = async () => {
    setSubmitting(true)
    try {
      const comprobantePath = file ? await turnoService.subirComprobante(sesionId, file) : undefined
      onConfirm(tipo, monto, motivo.trim(), comprobantePath)
    } finally {
      setSubmitting(false)
    }
  }
  return <Modal title={titulo} onClose={onClose}><div className="modal-body form-grid">
    <label className="full">Monto (Bs)<NumberField autoFocus min={0} step={0.01} value={monto} onCommit={setMonto} /></label>
    <label className="full">Motivo<input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio" /></label>
    {tipo === 'GASTO' && <label className="full">Comprobante (foto, opcional)<input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Guardando…' : 'Confirmar'}</button></footer></Modal>
}

function CerrarTurnoModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (denominaciones: Denominaciones) => void }) {
  const [denominaciones, setDenominaciones] = useState<Denominaciones>({})
  return <Modal title="Cerrar turno" subtitle="Contá el efectivo del cajón — el resultado no se muestra acá" onClose={onClose} wide>
    <div className="modal-body">
      <DenominationCount value={denominaciones} onChange={setDenominaciones} />
    </div>
    <footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={() => confirm('¿Confirmar cierre de turno?') && onConfirm(denominaciones)}>Confirmar cierre</button></footer>
  </Modal>
}

// ============================================================================
// Supervisión (gerente/admin) — Turno en vivo, Arqueo sorpresa, Gastos pendientes,
// Turnos en revisión, Faltantes.
// ============================================================================

function SupervisionPanel({ notify }: { notify: (message: string) => void }) {
  const [sesion, setSesion] = useState<TurnoSesion | null>(null)
  const [resumen, setResumen] = useState<TurnoResumen | null>(null)
  const [gastos, setGastos] = useState<CajaGastoRecord[]>([])
  const [enRevision, setEnRevision] = useState<TurnoSesion[]>([])
  const [faltantes, setFaltantes] = useState<CajaFaltanteRecord[]>([])
  const [arqueoOpen, setArqueoOpen] = useState(false)
  // Brief Caja-2 B2 — "Pagos por verificar".
  const [estadoBanco, setEstadoBanco] = useState<EstadoBancoQr | null>(null)
  const [pagosPorVerificar, setPagosPorVerificar] = useState<PagoPorVerificar[]>([])
  const [movimientosSinVincular, setMovimientosSinVincular] = useState<MovimientoBancoQr[]>([])

  const load = async () => {
    const abierta = await turnoService.getSesionAbierta()
    setSesion(abierta)
    const [r, g, rev, f, banco, pagos, movimientos] = await Promise.all([
      abierta ? turnoService.resumen(abierta.id) : Promise.resolve(null),
      turnoService.gastosPendientes(),
      turnoService.turnosEnRevision(),
      turnoService.faltantesPendientes(),
      turnoService.estadoBancoQr(),
      turnoService.pagosPorVerificar(),
      turnoService.movimientosBancoSinVincular(),
    ])
    setResumen(r); setGastos(g); setEnRevision(rev); setFaltantes(f)
    setEstadoBanco(banco); setPagosPorVerificar(pagos); setMovimientosSinVincular(movimientos)
  }
  // Brief: "auto-refrescando cada 15 s"
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial + refresco periódico de Supervisión
    void load()
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const resolverGasto = async (id: string, aprobar: boolean) => {
    const nota = aprobar ? undefined : (window.prompt('Motivo del rechazo (opcional):') ?? undefined)
    try {
      await turnoService.resolverGasto(id, aprobar, nota)
      notify(aprobar ? 'Gasto aprobado' : 'Gasto rechazado — se generó un faltante para el cajero')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo resolver el gasto')
    }
  }
  const aprobarCierre = async (sesionId: string) => {
    const nota = window.prompt('Nota de revisión (obligatoria):')
    if (!nota || !nota.trim()) { notify('La nota de revisión es obligatoria'); return }
    try {
      await turnoService.revisar(sesionId, nota.trim())
      notify('Turno aprobado')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo aprobar el cierre')
    }
  }
  const resolverFaltante = async (id: string, estado: 'REPUESTO' | 'CONDONADO') => {
    const nota = window.prompt(`Nota (${estado === 'REPUESTO' ? 'repuesto' : 'condonado'}):`) ?? ''
    try {
      await turnoService.faltantesResolver(id, estado, nota)
      notify('Faltante resuelto')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo resolver el faltante')
    }
  }
  const confirmarArqueo = async (denominaciones: Denominaciones) => {
    if (!sesion) return
    try {
      const result = await turnoService.arqueoSorpresa(sesion.id, denominaciones)
      setArqueoOpen(false)
      notify(`Arqueo sorpresa: esperado Bs ${bs(result.esperadoBs)}, contado Bs ${bs(result.contadoBs)}, diferencia Bs ${bs(result.diferenciaBs)}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo registrar el arqueo')
    }
  }

  // Brief Caja-2 B2 — sugerencias con la regla tolerante de Caja ROARI (±2%, mín. Bs 1,
  // ≤10 min); un clic sobre una sugerencia fuerte o débil hace vincular_pago_qr.
  const sugerencias: SugerenciaQr[] = sugerirPagosQr(
    pagosPorVerificar.filter((p) => p.metodo === 'QR').map((p) => ({ ventaPagoId: p.ventaPagoId, montoBs: p.montoBs, creadoEn: p.creadoEn })),
    movimientosSinVincular.map((m) => ({ id: m.id, importeBs: m.importeBs, fechaTransaccion: m.fechaTransaccion })),
  )
  const sugerenciaPara = (ventaPagoId: string) => sugerencias.find((s) => s.pago.ventaPagoId === ventaPagoId)

  const vincular = async (ventaPagoId: string, bancoMovId: string) => {
    try {
      await turnoService.vincularPagoQr(ventaPagoId, bancoMovId)
      notify('Pago vinculado y verificado')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo vincular el pago')
    }
  }
  const verificarManual = async (ventaPagoId: string, aprobar: boolean) => {
    const referencia = aprobar ? (window.prompt('Referencia del pago:') ?? '') : null
    if (aprobar && !referencia?.trim()) { notify('La referencia es obligatoria para verificar manualmente'); return }
    try {
      await turnoService.verificarPagoManual(ventaPagoId, referencia, aprobar)
      notify(aprobar ? 'Pago verificado' : 'Pago rechazado')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo resolver el pago')
    }
  }

  return <div className="cash-layout turno-layout supervision-panel">
    <section className="cash-hero">
      <div><span>TURNO EN VIVO</span><h2>{sesion ? sesion.cajaNombre : 'Caja Tienda'}</h2><p>{sesion ? `${sesion.abiertaPor ?? 'Cajero'} · desde ${new Date(sesion.abiertaEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}` : 'Sin turno abierto'}</p></div>
      <WalletCards />
      {sesion && <footer><span>Efectivo esperado</span><strong>{resumen?.esperadoEfectivoBs != null ? formatMoney(money(Math.round(resumen.esperadoEfectivoBs * 100))) : '—'}</strong>{resumen?.diferenciaRelevoBs ? <small>Relevo: {resumen.diferenciaRelevoBs >= 0 ? '+' : ''}{bs(resumen.diferenciaRelevoBs)}</small> : null}</footer>}
    </section>
    {resumen && <section className="cash-methods"><h3>Ventas por método</h3>{Object.keys(resumen.ventasPorMetodo).length ? Object.entries(resumen.ventasPorMetodo).map(([m, v]) => <div key={m}><span>{metodoLabel[m] ?? m}</span><strong>Bs {bs(v)}</strong></div>) : <FeatureState type="empty" text="Sin ventas todavía" />}</section>}
    {sesion && <button className="secondary-button" onClick={() => setArqueoOpen(true)}><Calculator /> Arqueo sorpresa</button>}

    <section className="cash-movements"><h3>Gastos pendientes</h3>
      {gastos.length ? gastos.map((g) => <div key={g.id} className="turno-gasto-row">
        <span>{g.motivo}<small>{g.registradoPor} · {new Date(g.registradoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
        <b>Bs {bs(g.montoBs)}</b>
        <div><button type="button" onClick={() => void resolverGasto(g.id, true)}>Aprobar</button><button type="button" onClick={() => void resolverGasto(g.id, false)}>Rechazar</button></div>
      </div>) : <FeatureState type="empty" text="Sin gastos pendientes" />}
    </section>

    <section className="cash-movements"><h3>Turnos en revisión</h3>
      {enRevision.length ? enRevision.map((s) => <div key={s.id} className="turno-revision-row">
        <span>{s.cajaNombre}<small>{s.abiertaPor} · cerrado {s.cerradaEn ? new Date(s.cerradaEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : ''}</small></span>
        <button type="button" onClick={() => void aprobarCierre(s.id)}>Aprobar cierre</button>
      </div>) : <FeatureState type="empty" text="Sin turnos en revisión" />}
    </section>

    <section className="cash-movements"><h3>Faltantes</h3>
      {faltantes.length ? faltantes.map((f) => <div key={f.id} className="turno-faltante-row">
        <span>{f.origen === 'ARQUEO' ? 'Faltante de arqueo' : 'Gasto rechazado'}<small>{f.cajeroId ?? 'sin cajero'} · {new Date(f.creadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
        <b>Bs {bs(f.montoBs)}</b>
        <div><button type="button" onClick={() => void resolverFaltante(f.id, 'REPUESTO')}>Repuesto</button><button type="button" onClick={() => void resolverFaltante(f.id, 'CONDONADO')}>Condonado</button></div>
      </div>) : <FeatureState type="empty" text="Sin faltantes pendientes" />}
    </section>
    <section className="cash-movements pagos-verificar">
      <header>
        <h3>Pagos por verificar</h3>
        {estadoBanco && (estadoBanco.enLinea
          ? <span className="banco-estado banco-estado-online">Banco: en línea{estadoBanco.minutosDesde != null ? ` (hace ${Math.round(estadoBanco.minutosDesde * 60)} s)` : ''}</span>
          : <span className="banco-estado banco-estado-offline">Banco: sin datos{estadoBanco.minutosDesde != null ? ` hace ${Math.round(estadoBanco.minutosDesde)} min` : ''}</span>)}
      </header>
      <div className="pagos-verificar-grid">
        <div className="pagos-verificar-col">
          <h4>Pagos pendientes</h4>
          {pagosPorVerificar.length ? pagosPorVerificar.map((p) => {
            const sugerencia = p.metodo === 'QR' ? sugerenciaPara(p.ventaPagoId) : undefined
            return <div key={p.ventaPagoId} className="pago-verificar-row">
              <span>{p.numero ?? `#${p.ventaId}`}<small>{metodoLabel[p.metodo] ?? p.metodo} · {new Date(p.creadoEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
              <b>Bs {bs(p.montoBs)}</b>
              {sugerencia && sugerencia.candidatos.length > 0 && <div className="pago-sugerencia">
                <span className={sugerencia.fuerza === 'fuerte' ? 'sugerencia-fuerte' : 'sugerencia-debil'}>{sugerencia.fuerza === 'fuerte' ? 'Coincidencia fuerte' : 'Coincidencia débil'}</span>
                {sugerencia.candidatos.map((c) => <button key={c.movimiento.id} type="button" onClick={() => void vincular(p.ventaPagoId, c.movimiento.id)}>Vincular Bs {bs(c.movimiento.importeBs)} · {new Date(c.movimiento.fechaTransaccion).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</button>)}
              </div>}
              <div className="pago-verificar-acciones">
                <button type="button" onClick={() => void verificarManual(p.ventaPagoId, true)}>Verificar manual</button>
                <button type="button" onClick={() => void verificarManual(p.ventaPagoId, false)}>Rechazar</button>
              </div>
            </div>
          }) : <FeatureState type="empty" text="Sin pagos pendientes de verificar" />}
        </div>
        <div className="pagos-verificar-col">
          <h4>Movimientos bancarios sin vincular (48h)</h4>
          {movimientosSinVincular.length ? movimientosSinVincular.map((m) => <div key={m.id} className="movimiento-banco-row">
            <span>{m.bancoId}<small>{new Date(m.fechaTransaccion).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
            <b>Bs {bs(m.importeBs)}</b>
          </div>) : <FeatureState type="empty" text="Sin movimientos sueltos" />}
        </div>
      </div>
    </section>

    {arqueoOpen && <CerrarTurnoModal onClose={() => setArqueoOpen(false)} onConfirm={confirmarArqueo} />}
  </div>
}

// ============================================================================
// Modo mock — flujo simple de siempre (sin turno de cajero). Sin cambios respecto
// del CashPage.tsx anterior a este brief.
// ============================================================================

function MockCashPage({ notify, canCloseCash = true }: { notify: (message: string) => void; canCloseCash?: boolean }) {
  const [sessions, setSessions] = useState<CashSessionRecord[]>([])
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState<CashSessionRecord | null>(null)
  const [movementOpen, setMovementOpen] = useState<'income' | 'expense' | null>(null)
  const { refresh: refreshCashSession } = useCashSession()
  const load = () => cashService.list().then(setSessions)
  useEffect(() => { void load() }, [])
  const active = sessions.find((session) => session.status === 'open')
  const expected = active ? cashService.expected(active) : 0
  const byMethod = active?.movements.reduce((result, movement) => ({ ...result, [movement.method]: (result[movement.method] || 0) + (movement.type === 'income' ? movement.amountCents : -movement.amountCents) }), {} as Record<string,number>) ?? {}
  const open = async (amount: number) => {
    await sensitiveOperations.execute('open_cash','Caja Tienda',()=>cashService.open(amount))
    setOpening(false)
    await load()
    await refreshCashSession()
    notify('Sesión de caja abierta en modo mock')
  }
  const close = async (counted: number) => {
    if (!closing) return
    try {
      await sensitiveOperations.execute('close_cash',closing.id,()=>cashService.close(closing.id, counted))
      setClosing(null)
      await load()
      await refreshCashSession()
      notify('Cierre guardado en historial local')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cerrar la caja')
    }
  }
  const movement = async (type: 'income' | 'expense', amountCents: number, method: 'cash' | 'qr' | 'transfer', note: string) => {
    if (!active) return
    await cashService.addMovement(active.id, type, method, amountCents, note)
    setMovementOpen(null)
    await load()
    notify(`${type==='income'?'Ingreso':'Egreso'} registrado`)
  }
  return <FeatureShell eyebrow="CONTROL DE CAJA" title="Caja" subtitle="Apertura, movimientos y cierre exclusivamente simulados">{active ? <div className="cash-layout"><section className="cash-hero"><div><span>SESIÓN ACTIVA</span><h2>{active.register}</h2><p>Abierta {new Date(active.openedAt).toLocaleString('es-BO')}</p></div><WalletCards /><footer><span>Efectivo esperado</span><strong>{formatMoney(money(expected))}</strong></footer></section><section className="cash-methods"><h3>Resumen por método</h3>{[['cash','Efectivo'],['qr','QR'],['transfer','Transferencia']].map(([key,label])=><div key={key}><span>{label}</span><strong>{formatMoney(money(byMethod[key] || 0))}</strong></div>)}</section><section className="cash-movements"><header><h3>Movimientos</h3><div><button onClick={()=>setMovementOpen('income')}><ArrowDownLeft /> Ingreso</button><button onClick={()=>setMovementOpen('expense')}><ArrowUpRight /> Egreso</button></div></header>{active.movements.length ? active.movements.map((movement)=><div key={movement.id}><span>{movement.note}</span><b>{movement.type==='expense'?'− ':''}{formatMoney(money(movement.amountCents))}</b></div>) : <FeatureState type="empty" text="Sin movimientos en esta sesión" />}</section><button className="close-cash-button" disabled={!canCloseCash} title={canCloseCash?undefined:'Solo un administrador puede cerrar caja'} onClick={()=>setClosing(active)}><LockKeyhole /> Cerrar caja</button></div> : <div className="cash-empty"><div><WalletCards /></div><h2>No hay una sesión activa</h2><p>Selecciona una caja e ingresa el fondo inicial para comenzar.</p><button className="primary-button" onClick={()=>setOpening(true)}>Abrir Caja Tienda</button></div>}{opening && <OpenCashModal onClose={()=>setOpening(false)} onOpen={open}/>} {closing && <CloseCashModal session={closing} expected={cashService.expected(closing)} byMethod={byMethod} onClose={()=>setClosing(null)} onConfirm={close}/>}{movementOpen && <MovementModal type={movementOpen} onClose={()=>setMovementOpen(null)} onConfirm={(amount,method,note)=>movement(movementOpen,amount,method,note)}/>}<section className="cash-history"><h3>Historial</h3>{sessions.filter((s)=>s.status==='closed').map((session)=><div key={session.id}><span>{session.register}<small>{new Date(session.closedAt!).toLocaleString('es-BO')}</small></span><b>{formatMoney(money(session.countedCents || 0))}</b></div>)}</section></FeatureShell>
}

function OpenCashModal({onClose,onOpen}:{onClose:()=>void;onOpen:(amount:number)=>void}) { const [amount,setAmount]=useState(50000); return <Modal title="Abrir caja" subtitle="No se registrará dinero real" onClose={onClose}><div className="modal-body form-grid"><label className="full">Caja<select><option>Caja 01 · Sucursal Central</option></select></label><label className="full">Monto inicial (Bs)<NumberField autoFocus min={0} value={amount/100} onCommit={(bs)=>setAmount(Math.round(bs*100))}/></label></div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>onOpen(amount)}>Confirmar apertura</button></footer></Modal> }

function CloseCashModal({session,expected,byMethod,onClose,onConfirm}:{session:CashSessionRecord;expected:number;byMethod:Record<string,number>;onClose:()=>void;onConfirm:(amount:number)=>void}) {
  const [counted,setCounted]=useState(0)
  const [touched,setTouched]=useState(false)
  const difference=counted-expected
  return <Modal title="Cerrar caja" subtitle={session.register} onClose={onClose}><div className="modal-body close-summary">
    <div><span>Efectivo esperado</span><strong>{formatMoney(money(expected))}</strong><small>QR {formatMoney(money(byMethod.qr||0))} · Transferencia {formatMoney(money(byMethod.transfer||0))} — no se cuentan en el cajón</small></div>
    <label>Efectivo contado (Bs)<NumberField autoFocus min={0} value={counted/100} onCommit={(bs)=>{setCounted(Math.round(bs*100));setTouched(true)}}/></label>
    {touched && <div className={difference===0?'balanced':difference>0?'surplus':'shortage'}><Calculator/><span>{difference===0?'Caja cuadrada':difference>0?'Sobrante':'Faltante'}</span><strong>{formatMoney(money(Math.abs(difference)))}</strong></div>}
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" onClick={()=>confirm('¿Confirmar cierre de caja mock?')&&onConfirm(counted)}>Confirmar cierre</button></footer></Modal>
}

function MovementModal({type,onClose,onConfirm}:{type:'income'|'expense';onClose:()=>void;onConfirm:(amountCents:number,method:'cash'|'qr'|'transfer',note:string)=>void}) {
  const [amount,setAmount]=useState(0)
  const [method,setMethod]=useState<'cash'|'qr'|'transfer'>('cash')
  const [note,setNote]=useState('')
  const valid = amount > 0
  return <Modal title={type==='income'?'Registrar ingreso':'Registrar egreso'} onClose={onClose}><div className="modal-body form-grid">
    <label className="full">Monto (Bs)<NumberField autoFocus min={0} step={0.01} value={amount/100} onCommit={(bs)=>setAmount(Math.round(bs*100))}/></label>
    <label className="full">Método<select value={method} onChange={(e)=>setMethod(e.target.value as 'cash'|'qr'|'transfer')}><option value="cash">Efectivo</option><option value="qr">QR</option><option value="transfer">Transferencia</option></select></label>
    <label className="full">Motivo<input type="text" value={note} onChange={(e)=>setNote(e.target.value)} placeholder={type==='income'?'Motivo del ingreso':'Motivo del egreso'}/></label>
  </div><footer className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid} onClick={()=>onConfirm(amount,method,note)}>Confirmar</button></footer></Modal>
}
