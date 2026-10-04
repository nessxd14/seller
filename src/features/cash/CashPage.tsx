import { ArrowDownLeft, ArrowUpRight, Calculator, ChevronDown, LockKeyhole, Printer, WalletCards, RefreshCw, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import { hasPermission } from '../../application/auth/AuthSessionProvider'
import type { CajaFaltanteRecord, CajaGastoRecord, CashSessionRecord, Denominaciones, EstadoBancoQr, MovimientoBancoQr, PagoPorVerificar, TurnoResumen, TurnoSesion, TurnoTicket, TurnoMovimiento } from '../../application/shared/models'
import { sugerirPagosQr, type SugerenciaQr } from '../../domain/cash/qrSuggestions'
import { authSessionProvider, cashService, sensitiveOperations, turnoService, ventaDirectaService } from '../../infrastructure/services'
import { formatMoney, money } from '../../domain/common/money'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { NumberField } from '../../components/NumberField'
import { DenominationCount, denominacionesTotal } from '../../components/DenominationCount'
import { VentaTicket } from '../../components/VentaTicket'
import { InfoHint } from '../../components/InfoHint'
import { useEsEncargado } from '../../components/useCobroDestino'
import { featureFlags } from '../../config/featureFlags'
import { useCashSession } from '../../context/CashSessionContext'
import { useCashRefresh } from './useCashRefresh'
import { createUuid } from '../../application/shared/createUuid'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ENTREGA_CIERRE_PREFIJO = 'Entrega de cierre a '

// Textos de ayuda "i" (Brief Caja). Ninguno muestra una cifra: solo explican el concepto.
const HINTS = {
  vta: { title: 'Mostrador (VTA)', text: 'Lo que cobraste por ventas de tienda. El efectivo va a tu cajón; QR y transferencia van al banco.' },
  vtd: { title: 'Venta directa (VTD)', text: 'Cobro de una venta que se entrega desde almacén. Cuenta en tu turno cuando la cobras, no cuando se crea.' },
  anticipos: { title: 'Pagos y anticipos', text: 'Plata que un cliente deja a cuenta de un pedido o de su saldo. No es una venta nueva.' },
  gasto: { title: 'Gasto', text: 'Efectivo que sale del cajón para pagar algo (taxi, flete, almuerzo). Baja el cajón al instante. El gerente lo aprueba después y, si lo rechaza, queda como faltante del turno.' },
  remesa: { title: 'Remesa', text: 'Efectivo que entregas al gerente o al banco. No se gasta, solo cambia de lugar. Si le entregas plata al gerente, es remesa, no gasto.' },
  inyeccion: { title: 'Inyección', text: 'Efectivo que entra al cajón sin ser venta, por ejemplo sencillo para dar cambio. No sirve para corregir la apertura: el fondo inicial se cuenta al abrir el turno.' },
  vtdPorCobrar: { title: 'VTD por cobrar', text: 'Ventas directas que todavía no se cobraron. No se entregan hasta cobrarlas, salvo las marcadas como pago posterior.' },
  fueraArqueo: { title: 'Fuera del arqueo', text: 'Cobros en efectivo que recibió gerencia directamente. No entraron a este cajón, así que no cuentan en tu cierre.' },
  anulacion: { title: 'Anulación', text: 'Devolución de una venta ya cobrada. Sale del cajón si fue en efectivo.' },
} as const
const hintCajaFor = (tipo: 'GASTO' | 'REMESA' | 'INYECCION') => (tipo === 'GASTO' ? HINTS.gasto : tipo === 'REMESA' ? HINTS.remesa : HINTS.inyeccion).text

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

  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try { setSesion(await turnoService.getSesionAbierta()); setLoadError('') }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudo consultar el turno') }
  }, [])
  useEffect(() => { void authSessionProvider.getSession().then(setSession) }, [])
  useCashRefresh(load, 'seller-turno')

  const onOpened = async () => { await load(); await refreshCashSession(); notify('Turno abierto') }
  const onClosed = async () => { await load(); await refreshCashSession() }

  return <FeatureShell
    eyebrow="CONTROL DE CAJA"
    title="Caja"
    className="cash-workspace"
    subtitle="Apertura, movimientos y cierre de turno — Caja Tienda"
    action={puedeSupervisar ? <div className="turno-tabs" role="group" aria-label="Vistas de caja"><button aria-pressed={tab === 'mi-turno'} className={tab === 'mi-turno' ? 'active' : ''} onClick={() => setTab('mi-turno')}>Mi turno</button><button aria-pressed={tab === 'supervision'} className={tab === 'supervision' ? 'active' : ''} onClick={() => setTab('supervision')}>Supervisión</button></div> : undefined}
  >
    {loadError && <p role="alert" className="cash-error">{loadError} <button onClick={() => void load()}>Reintentar</button></p>}
    {tab === 'supervision' && puedeSupervisar
      ? <SupervisionPanel notify={notify} />
      : sesion === 'loading'
        ? <FeatureState type="loading" text="Cargando turno" />
        : sesion
          ? sesion.cajeroId && sesion.cajeroId !== session?.user.id && !puedeSupervisar
            ? <FeatureState type="error" text="Esta caja tiene el turno de otro cajero. Espera el relevo para abrir tu turno." />
            : <MiTurnoPanel sesion={sesion} isManager={puedeSupervisar} notify={notify} onClosed={onClosed} />
          : <AbrirTurnoView notify={notify} onOpened={onOpened} />}
  </FeatureShell>
}

function AbrirTurnoView({ notify, onOpened }: { notify: (message: string) => void; onOpened: () => void }) {
  const [handover, setHandover] = useState<string | null>(null)
  const [denominaciones, setDenominaciones] = useState<Denominaciones>({})
  const [cajonEnCero, setCajonEnCero] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const totalContado = denominacionesTotal(denominaciones)
  useEffect(() => { void turnoService.getUltimaSesionCerrada().then((h) => setHandover(h?.entregadoPor ?? null)) }, [])
  const abrir = async () => {
    if (submitting || (totalContado === 0 && !cajonEnCero)) return
    setSubmitting(true)
    try {
      await turnoService.abrir(denominaciones)
      await onOpened()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo abrir el turno')
    } finally {
      setSubmitting(false)
    }
  }
  return <div className="cash-opening">
    <section className="cash-opening-intro">
      <WalletCards aria-hidden="true" />
      <h2>Abrir turno</h2>
      <p>Cuenta el dinero que recibes para registrar tu fondo de apertura.</p>
      {handover && <p className="cash-handover">Recibes la caja de <strong>{handover}</strong>.</p>}
      <dl><div><dt>Caja</dt><dd>Caja Tienda</dd></div><div><dt>Registro</dt><dd>Por cajero y turno</dd></div></dl>
      <p className="cash-opening-note">Las ventas, pagos y anticipos que cobres quedarán en este turno. Declara cada gasto con su detalle.</p>
    </section>
    <section className="cash-opening-count">
      <header><h3>Cuenta el efectivo recibido</h3><p>Ingresa la cantidad de cada denominación.</p></header>
      <DenominationCount value={denominaciones} onChange={setDenominaciones} disabled={submitting} />
      {totalContado === 0 && <CajonEnCeroCheck checked={cajonEnCero} onChange={setCajonEnCero} disabled={submitting} />}
      <footer><div aria-live="polite"><span>Fondo de apertura</span><strong>Bs {bs(totalContado)}</strong></div><button className="primary-button" disabled={submitting || (totalContado === 0 && !cajonEnCero)} onClick={() => void abrir()}>{submitting ? 'Abriendo…' : 'Abrir mi turno'}</button></footer>
    </section>
  </div>
}

function TurnoHeaderChip({ sesion }: { sesion: TurnoSesion }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(id) }, [])
  const openedAt = new Date(sesion.abiertaEn).getTime()
  const endAt = sesion.cerradaEn ? new Date(sesion.cerradaEn).getTime() : now
  const minutes = Math.max(0, Math.round((endAt - openedAt) / 60000))
  const horas = Math.floor(minutes / 60)
  const mins = minutes % 60
  return <div>
    <div className="cash-turno-meta"><span>Turno #{sesion.id}</span><strong className={`cash-status ${sesion.estado.toLowerCase()}`}>{sesion.estado === 'ABIERTA' ? 'Abierto' : sesion.estado === 'EN_REVISION' ? 'En revisión' : 'Cerrado'}</strong></div>
    <h2>{sesion.cajaNombre}</h2>
    <p className="cash-turno-owner">{sesion.abiertaPor ?? 'Cajero'}</p>
    <p>Desde {new Date(sesion.abiertaEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })} · {horas > 0 ? `${horas} h ` : ''}{mins} min</p>
    {sesion.cerradaEn && <p>Cerrado {new Date(sesion.cerradaEn).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</p>}
  </div>
}

export function MiTurnoPanel({ sesion, isManager, notify, onClosed, readOnly = false }: { sesion: TurnoSesion; isManager: boolean; notify: (message: string) => void; onClosed: () => void; readOnly?: boolean }) {
  // Mismo permiso ('admin') que la elección de destino del efectivo (D2): la RPC solo acepta gerente/admin.
  const esEncargado = useEsEncargado()
  const [resumen, setResumen] = useState<TurnoResumen | null>(null)
  const [tickets, setTickets] = useState<TurnoTicket[]>([])
  const [movimientoOpen, setMovimientoOpen] = useState<'GASTO' | 'REMESA' | 'INYECCION' | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeResult, setCloseResult] = useState<{ estado: string } | null>(null)
  const [reprintId, setReprintId] = useState<string | null>(null)
  const [movimientos, setMovimientos] = useState<TurnoMovimiento[]>([])
  const [loadError, setLoadError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [filter, setFilter] = useState('TODOS')
  const filteredMovements = movimientos.filter((m) => filter === 'TODOS' || (filter === 'ACREEDOR' && m.clienteAcreedor) || (filter === 'SALDO_FAVOR' && ['SALDO_FAVOR','SALDO_REVERTIDO'].includes(m.tipo)) || m.tipo === filter || m.subtipo === filter)

  const load = useCallback(async () => {
    try {
      const [r, t, m] = await Promise.all([turnoService.resumen(sesion.id), turnoService.misTickets(sesion.id), turnoService.movimientos(sesion.id)])
      setResumen(r); setTickets(t); setMovimientos(m); setUpdatedAt(new Date()); setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudo actualizar el turno') }
  }, [sesion.id])
  useCashRefresh(load, sesion.id)

  const registrarMovimiento = async (subtipo: 'GASTO' | 'REMESA' | 'INYECCION', montoBs: number, motivo: string, comprobantePath?: string, idempotencyKey?: string) => {
    try {
      await turnoService.registrarMovimiento({ sesionId: sesion.id, subtipo, montoBs, motivo, comprobantePath, idempotencyKey })
      setMovimientoOpen(null)
      notify(subtipo === 'GASTO' ? 'Gasto registrado' : subtipo === 'REMESA' ? 'Remesa registrada' : 'Inyección registrada')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo registrar el movimiento')
      throw error
    }
  }

  // Brief VTD 2.4, ahora para turno: mismo chequeo proactivo que la caja legacy.
  const abrirCierre = async () => {
    const abiertas = await ventaDirectaService.listAbiertas(sesion.id)
    if (abiertas.length) { notify(`No se puede cerrar el turno: hay ${abiertas.length} venta${abiertas.length > 1 ? 's' : ''} directa${abiertas.length > 1 ? 's' : ''} de almacén abierta${abiertas.length > 1 ? 's' : ''}. Resolvelas en Venta Directa antes de cerrar.`); return }
    setClosing(true)
  }
  // Entrega de efectivo (remesa) antes del conteo de cierre. La clave de idempotencia la genera
  // el modal una sola vez por instancia: un reintento no crea una segunda remesa.
  const registrarEntregaCierre = async (montoBs: number, motivo: string, idempotencyKey: string) => {
    await turnoService.registrarMovimiento({ sesionId: sesion.id, subtipo: 'REMESA', montoBs, motivo, idempotencyKey })
    notify('Entrega registrada')
    await load()
  }
  const alternarFueraDeArqueo = async (m: TurnoMovimiento) => {
    try {
      await turnoService.marcarCobroFueraDeArqueo(m.id, !m.fueraDeArqueo)
      notify(m.fueraDeArqueo ? 'El cobro vuelve al arqueo' : 'El cobro salió del arqueo')
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cambiar el cobro')
    }
  }
  const confirmarCierre = async (denominaciones: Denominaciones, cajonVacio: boolean) => {
    try {
      const result = await turnoService.cerrar(sesion.id, denominaciones, cajonVacio)
      setClosing(false)
      setCloseResult({ estado: result.estado })
      notify(result.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión del gerente')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo cerrar el turno')
    }
  }

  return <div className="cash-layout turno-layout">
    <div className="cash-refresh"><span>{updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString('es-BO')} · cada 15 s` : 'Actualizando turno…'}</span><button onClick={() => void load()}><RefreshCw /> Actualizar</button></div>
    {loadError && <p role="alert" className="cash-error">{loadError}. Los datos visibles pueden estar desactualizados.</p>}
    <section className="cash-hero"><TurnoHeaderChip sesion={sesion} /><WalletCards />
      {/* B3: esperado/diferencia NUNCA para un cajero — esta tarjeta solo aparece si
          isManager, y aun así el dato viene de resumen_turno (ya redactado server-side
          para cajero), nunca recalculado acá. */}
      {isManager && <footer><span>Efectivo esperado</span><strong>{resumen?.esperadoEfectivoBs != null ? formatMoney(money(Math.round(resumen.esperadoEfectivoBs * 100))) : '—'}</strong>{resumen?.diferenciaRelevoBs ? <small>Relevo: {resumen.diferenciaRelevoBs >= 0 ? '+' : ''}{bs(resumen.diferenciaRelevoBs)}</small> : null}</footer>}
    </section>
    {resumen && <section className="cash-breakdown" aria-label="Desglose del turno">
      <header><h3>Desglose del turno</h3><span>Ver métodos</span></header>
      <CashSummaryRow title="Mostrador (VTA)" methods={resumen.ventasRetailPorMetodo} note={resumen.ventasTotalBs != null ? `Total vendido: Bs ${bs(resumen.ventasTotalBs)}. Dinero nuevo por método.` : undefined} info={HINTS.vta} />
      {(resumen.saldoFavorAplicadoBs ?? 0) > 0 && <div className="credit-turno-summary"><div><strong>Saldo de clientes utilizado</strong><small>Dinero recibido anteriormente; fuera del arqueo de este turno.</small></div><b>Bs {bs(resumen.saldoFavorAplicadoBs!)}</b></div>}
      <CashSummaryRow title="Ventas directas (VTD)" methods={resumen.ventasVtdPorMetodo} note={`${resumen.cantidadVtdCobradas} VTD cobradas`} info={HINTS.vtd} />
      <CashSummaryRow title="Pagos y anticipos de clientes" methods={resumen.anticiposPorMetodo} note="Incluidos en los ingresos de este turno; separados de las ventas." info={HINTS.anticipos} />
      {resumen.cobrosFueraArqueoBs > 0 && <CashSummaryRow title="Cobros recibidos por gerencia" methods={{ EFECTIVO: resumen.cobrosFueraArqueoBs }} note="Fuera del arqueo: no entraron a este cajón." info={HINTS.fueraArqueo} />}
      <details className="cash-summary-row cash-summary-expenses">
        <summary><h3>Gastos<InfoHint title={HINTS.gasto.title} text={HINTS.gasto.text} /></h3><strong>Bs {bs((resumen.gastosPorEstado.aprobado ?? 0) + (resumen.gastosPorEstado.pendiente ?? 0))}</strong><ChevronDown aria-hidden="true" /></summary>
        <div className="cash-summary-detail"><div><span>Aprobados</span><strong>Bs {bs(resumen.gastosPorEstado.aprobado ?? 0)}</strong></div><div><span>Pendientes de revisión</span><strong>Bs {bs(resumen.gastosPorEstado.pendiente ?? 0)}</strong></div><small>El detalle de cada gasto aparece en la actividad del turno.</small></div>
      </details>
      <div className="cash-summary-transfers"><div><span>Remesas<InfoHint title={HINTS.remesa.title} text={HINTS.remesa.text} /></span><strong>Bs {bs(resumen.remesasBs)}</strong></div><div><span>Inyecciones<InfoHint title={HINTS.inyeccion.title} text={HINTS.inyeccion.text} /></span><strong>Bs {bs(resumen.inyeccionesBs)}</strong></div></div>
    </section>}
    {resumen && resumen.vtdPorCobrar.cantidad > 0 && <section className="cash-methods vtd-por-cobrar-card">
      <h3>VTD por cobrar<InfoHint title={HINTS.vtdPorCobrar.title} text={HINTS.vtdPorCobrar.text} /></h3>
      <p className="vtd-por-cobrar-info">{resumen.vtdPorCobrar.cantidad} venta{resumen.vtdPorCobrar.cantidad > 1 ? 's' : ''} · Bs {bs(resumen.vtdPorCobrar.totalBs)}</p>
      <small>Informativo — fuera del arqueo</small>
    </section>}
    {!readOnly && <section className="cash-movements cash-operation-actions"><header><h3>Movimientos de caja</h3><div>
      <span className="cash-action-with-hint"><button onClick={() => setMovimientoOpen('GASTO')}><ArrowUpRight /> Registrar gasto</button><InfoHint title={HINTS.gasto.title} text={HINTS.gasto.text} /></span>
      <span className="cash-action-with-hint"><button onClick={() => setMovimientoOpen('REMESA')}><ArrowUpRight /> Remesa</button><InfoHint title={HINTS.remesa.title} text={HINTS.remesa.text} /></span>
      <span className="cash-action-with-hint"><button onClick={() => setMovimientoOpen('INYECCION')}><ArrowDownLeft /> Inyección</button><InfoHint title={HINTS.inyeccion.title} text={HINTS.inyeccion.text} /></span>
    </div></header></section>}
    <section className="cash-ledger">
      <header><div><h3>Actividad del turno</h3><p>Ventas, pagos, anticipos y gastos del cajero que cobró.</p></div><select aria-label="Filtrar movimientos" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="TODOS">Todos los movimientos</option><option value="VENTA">Ventas</option><option value="ACREEDOR">Clientes con saldo a favor</option><option value="SALDO_FAVOR">Aplicaciones de saldo</option><option value="ANTICIPO">Pagos y anticipos</option><option value="GASTO">Gastos</option><option value="REMESA">Remesas</option><option value="INYECCION">Inyecciones</option><option value="ANULACION">Anulaciones</option></select>{filter === 'ANULACION' && <InfoHint title={HINTS.anulacion.title} text={HINTS.anulacion.text} />}</header>
      <div className="cash-ledger-head"><span>Movimiento / detalle</span><span>Método</span><span>Importe</span></div>
      {filteredMovements.map((m) => <article className={`cash-ledger-row ${m.clienteAcreedor ? 'cash-acreedor-row' : ''}`} key={m.id}>
        <div><strong>{m.documento ?? (m.tipo === 'ANTICIPO' ? 'Pago / anticipo' : m.subtipo ?? m.tipo)}</strong><span>{m.clienteNombre}</span>{m.clienteAcreedor && <small className="credit-client-tag">Cliente con saldo a favor</small>}<p>{m.detalle || 'Sin detalle registrado'}</p><small>{new Date(m.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}{m.estadoGasto ? ` · ${m.estadoGasto.toLowerCase()}` : ''}</small>{m.tipo === 'ANULACION' && <InfoHint title={HINTS.anulacion.title} text={HINTS.anulacion.text} />}{m.fueraDeArqueo && <span className="fuera-arqueo-badge">Fuera del arqueo<InfoHint title={HINTS.fueraArqueo.title} text={HINTS.fueraArqueo.text} /></span>}{esEncargado && sesion.estado === 'ABIERTA' && m.tipo === 'ANTICIPO' && m.metodo === 'EFECTIVO' && <button type="button" className="fuera-arqueo-toggle" onClick={() => void alternarFueraDeArqueo(m)}>{m.fueraDeArqueo ? 'Volver al arqueo' : 'Sacar del arqueo'}</button>}{m.comprobantePath && <button onClick={() => { void turnoService.comprobanteUrl(m.comprobantePath!).then((url) => { if (url) window.open(url, '_blank', 'noopener,noreferrer'); else notify('No se pudo abrir el comprobante') }) }}><ReceiptText /> Ver comprobante</button>}</div>
        <span>{m.metodo === 'SALDO_FAVOR' ? 'Saldo a favor' : metodoLabel[m.metodo] ?? m.metodo}</span><b>{['EGRESO', 'ANULACION'].includes(m.tipo) ? '− ' : ''}Bs {bs(m.montoBs)}</b>
      </article>)}
      {!movimientos.length && <p className="cash-muted">Los movimientos aparecerán aquí cuando se registren.</p>}
      {!!movimientos.length && !filteredMovements.length && <div className="cash-filter-empty" role="status"><p>No hay movimientos de este tipo en el turno.</p><button type="button" onClick={() => setFilter('TODOS')}>Ver todos los movimientos</button></div>}
      {movimientos.length >= 500 && <p className="cash-muted">Se muestran los últimos 500 movimientos. El resumen incluye el turno completo.</p>}
    </section>
    <section className="cash-movements cash-tickets"><h3>Mis tickets</h3>
      {tickets.length ? tickets.map((t) => <div key={t.ventaId} className={`turno-ticket-row ${t.clienteAcreedor ? 'cash-acreedor-row' : ''}`}>
        <span>{t.numero ?? `#${t.ventaId}`}{t.clienteAcreedor && <small className="credit-client-tag">Cliente con saldo a favor</small>}<small>{new Date(t.creadoEn).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</small></span>
        <span>{t.metodos.map((m) => (m.metodo === 'SALDO_FAVOR' ? 'Saldo a favor' : metodoLabel[m.metodo] ?? m.metodo)).join(' + ') || '—'}</span>
        {t.metodos.some((m) => m.estadoVerificacion === 'PENDIENTE') && <span className="qr-pendiente-chip">QR pendiente</span>}
        <b>Bs {bs(t.totalBs)}</b>
        <button type="button" onClick={() => setReprintId(t.ventaId)}><Printer /> Reimprimir</button>
      </div>) : <FeatureState type="empty" text="Sin ventas todavía en este turno" />}
    </section>
    {!readOnly && <button className="close-cash-button" onClick={() => void abrirCierre()}><LockKeyhole /> Cerrar turno</button>}
    {movimientoOpen && <MovimientoTurnoModal tipo={movimientoOpen} sesionId={sesion.id} onClose={() => setMovimientoOpen(null)} onConfirm={registrarMovimiento} />}
    {closing && <CerrarTurnoModal onClose={() => setClosing(false)} onConfirm={confirmarCierre} entrega={{ sesionId: sesion.id, registrar: registrarEntregaCierre }} />}
    {closeResult && <Modal className="cash-dialog" title={closeResult.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión'} onClose={() => { setCloseResult(null); onClosed() }}>
      <div className="success-state"><span>✓</span><h3>{closeResult.estado === 'CERRADA' ? 'Turno cerrado' : 'Turno enviado a revisión del gerente'}</h3></div>
      <footer className="modal-actions"><button className="primary-button full-button" onClick={() => { setCloseResult(null); onClosed() }}>Aceptar</button></footer>
    </Modal>}
    {reprintId && <VentaTicket id={reprintId} onClose={() => setReprintId(null)} />}
  </div>
}

function CashSummaryRow({ title, methods, note, info }: { title: string; methods: Record<string, number>; note?: string; info?: { title: string; text: string } }) {
  const total = Object.values(methods).reduce((sum, amount) => sum + amount, 0)
  return <details className="cash-summary-row">
    <summary><h3>{title}{info && <InfoHint title={info.title} text={info.text} />}</h3><strong>Bs {bs(total)}</strong><ChevronDown aria-hidden="true" /></summary>
    <div className="cash-summary-detail">
      {Object.entries(methods).length ? Object.entries(methods).map(([method, amount]) => <div key={method}><span>{metodoLabel[method] ?? method}</span><strong>Bs {bs(amount)}</strong></div>) : <p>Sin cobros registrados.</p>}
      {note && <small>{note}</small>}
    </div>
  </details>
}

function MovimientoTurnoModal({ tipo, sesionId, onClose, onConfirm }: { tipo: 'GASTO' | 'REMESA' | 'INYECCION'; sesionId: string; onClose: () => void; onConfirm: (tipo: 'GASTO' | 'REMESA' | 'INYECCION', montoBs: number, motivo: string, comprobantePath?: string, idempotencyKey?: string) => Promise<void> }) {
  const [monto, setMonto] = useState(0)
  const [motivo, setMotivo] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef({ key: createUuid(), content: '' })
  const uploadedPath = useRef<string | undefined>(undefined)
  const valid = Number.isFinite(monto) && monto > 0 && motivo.trim().length >= 5
  const titulo = tipo === 'GASTO' ? 'Registrar gasto' : tipo === 'REMESA' ? 'Registrar remesa' : 'Registrar inyección'
  const submit = async () => {
    if (!valid || submitting) return
    setSubmitting(true)
    setError('')
    try {
      if (file && !uploadedPath.current) uploadedPath.current = await turnoService.subirComprobante(sesionId, file)
      const content = JSON.stringify([sesionId, tipo, monto, motivo.trim(), uploadedPath.current])
      if (operation.current.content && operation.current.content !== content) operation.current.key = createUuid()
      operation.current.content = content
      await onConfirm(tipo, monto, motivo.trim(), uploadedPath.current, operation.current.key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento. Reintenta.')
    } finally {
      setSubmitting(false)
    }
  }
  return <Modal className="cash-dialog" title={titulo} subtitle={hintCajaFor(tipo)} onClose={() => { if (!submitting) onClose() }} escapeToClose={!submitting}><div className="modal-body form-grid">
    <label className="full">Monto (Bs)<NumberField autoFocus disabled={submitting} min={0} step={0.01} value={monto} onCommit={setMonto} /></label>
    <label className="full">{tipo === 'GASTO' ? 'Detalle del gasto' : 'Motivo'}<textarea rows={3} maxLength={1000} value={motivo} disabled={submitting} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === 'GASTO' ? 'Qué se pagó, a quién y para qué. Ej.: flete a Carlos por entrega PED-024.' : 'Describe el movimiento (mínimo 5 caracteres)'} /></label>
    {tipo === 'GASTO' && <label className="full">Comprobante (foto, opcional)<input type="file" accept="image/*" disabled={submitting} onChange={(e) => { setFile(e.target.files?.[0] ?? null); uploadedPath.current = undefined }} /></label>}
    {error && <p role="alert" className="full cash-error">{error}</p>}
  </div><footer className="modal-actions"><button className="secondary-button" disabled={submitting} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? 'Guardando…' : 'Confirmar'}</button></footer></Modal>
}

function CajonEnCeroCheck({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="cash-cero-check"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> El cajón está en cero</label>
}

/**
 * Cierre en dos pasos cuando recibe `entrega` (cierre del cajero): 1) entrega de efectivo
 * (remesa) y 2) conteo de lo que queda. Sin `entrega` (Arqueo sorpresa del gerente) es solo el
 * conteo. Nunca muestra el esperado ni sugiere cuánto "debería" entregarse (conteo ciego).
 */
function CerrarTurnoModal({ onClose, onConfirm, entrega }: {
  onClose: () => void
  onConfirm: (denominaciones: Denominaciones, cajonVacio: boolean) => Promise<void>
  entrega?: { sesionId: string; registrar: (montoBs: number, motivo: string, idempotencyKey: string) => Promise<void> }
}) {
  const [paso, setPaso] = useState<'cargando' | 'entrega' | 'conteo'>(entrega ? 'cargando' : 'conteo')
  const [entregadoBs, setEntregadoBs] = useState(0)
  const [monto, setMonto] = useState(0)
  const [receptor, setReceptor] = useState('')
  const [entregaError, setEntregaError] = useState('')
  const [denominaciones, setDenominaciones] = useState<Denominaciones>({})
  const [cajonEnCero, setCajonEnCero] = useState(false)
  const [busy, setBusy] = useState(false)
  // Una clave por instancia del modal (se renueva solo si cambia lo que se entrega).
  const operacion = useRef({ key: createUuid(), content: '' })
  const sesionId = entrega?.sesionId

  // Si ya hubo una entrega de cierre en este turno (el cajero cerró el paso 2 y volvió), sale
  // de los movimientos del turno — no de estado local — y se salta directo al conteo.
  useEffect(() => {
    if (!sesionId) return
    let cancelled = false
    turnoService.movimientos(sesionId).then((movimientos) => {
      if (cancelled) return
      const previo = movimientos.filter((m) => m.subtipo === 'REMESA' && m.detalle.startsWith(ENTREGA_CIERRE_PREFIJO)).reduce((sum, m) => sum + m.montoBs, 0)
      setEntregadoBs(previo)
      setPaso(previo > 0 ? 'conteo' : 'entrega')
    }).catch(() => { if (!cancelled) setPaso('entrega') })
    return () => { cancelled = true }
  }, [sesionId])

  const total = denominacionesTotal(denominaciones)
  const conteoBloqueado = total === 0 && !cajonEnCero
  const entregaValida = Number.isFinite(monto) && monto > 0 && receptor.trim().length >= 2

  const registrarEntrega = async () => {
    if (!entrega || !entregaValida || busy) return
    setBusy(true)
    setEntregaError('')
    const motivo = `${ENTREGA_CIERRE_PREFIJO}${receptor.trim()}`
    const content = JSON.stringify([monto, motivo])
    if (operacion.current.content && operacion.current.content !== content) operacion.current.key = createUuid()
    operacion.current.content = content
    try {
      await entrega.registrar(monto, motivo, operacion.current.key)
      setEntregadoBs(monto)
      setPaso('conteo')
    } catch (err) {
      setEntregaError(err instanceof Error ? err.message : 'No se pudo registrar la entrega. Reintenta.')
    } finally {
      setBusy(false)
    }
  }
  const confirmar = async () => {
    if (busy || conteoBloqueado) return
    setBusy(true)
    try { await onConfirm(denominaciones, total === 0 && cajonEnCero) } finally { setBusy(false) }
  }

  if (paso !== 'conteo') {
    return <Modal className="cash-dialog" title="Cerrar turno" subtitle="Primero registra el efectivo que entregas, si corresponde." onClose={() => { if (!busy) onClose() }} escapeToClose={!busy}>
      {paso === 'cargando'
        ? <div className="modal-body"><p role="status">Revisando el turno…</p></div>
        : <>
          <div className="modal-body cash-entrega-step">
            <h3>¿Entregas efectivo antes de cerrar?</h3>
            <label className="full">Monto entregado (Bs)<NumberField autoFocus disabled={busy} min={0} step={0.01} value={monto} onCommit={setMonto} /></label>
            <label className="full">A quién se lo entregas<input type="text" maxLength={80} value={receptor} disabled={busy} onChange={(e) => setReceptor(e.target.value)} placeholder="Nombre de quien recibe" /></label>
            {entregaError && <p role="alert" className="cash-error">{entregaError}</p>}
          </div>
          <footer className="modal-actions">
            <button className="secondary-button" disabled={busy} onClick={onClose}>Cancelar</button>
            <button className="secondary-button" disabled={busy} onClick={() => setPaso('conteo')}>No entrego nada</button>
            <button className="primary-button" disabled={!entregaValida || busy} onClick={() => void registrarEntrega()}>{busy ? 'Registrando…' : 'Registrar entrega y continuar'}</button>
          </footer>
        </>}
    </Modal>
  }

  return <Modal className="cash-dialog" title="Cerrar turno" subtitle={entrega ? 'Cuenta el efectivo que queda en el cajón después de la entrega.' : 'Cuenta el efectivo del cajón para registrar tu cierre.'} onClose={() => { if (!busy) onClose() }} escapeToClose={!busy} wide>
    <div className="modal-body">
      {entrega && entregadoBs > 0 && <p className="cash-entrega-previa" role="status">Ya registraste una entrega de Bs {bs(entregadoBs)} en este cierre.</p>}
      <DenominationCount value={denominaciones} onChange={setDenominaciones} disabled={busy} />
      {total === 0 && <CajonEnCeroCheck checked={cajonEnCero} onChange={setCajonEnCero} disabled={busy} />}
    </div>
    <footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy || conteoBloqueado} onClick={() => void confirmar()}>{busy ? 'Guardando conteo…' : 'Confirmar conteo'}</button></footer>
  </Modal>
}

// ============================================================================
// Supervisión (gerente/admin) — Turno en vivo, Arqueo sorpresa, Gastos pendientes,
// Turnos en revisión, Faltantes.
// ============================================================================

export function SupervisionPanel({ notify }: { notify: (message: string) => void }) {
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

  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try {
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
    setLoadError('')
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'No se pudo actualizar la supervisión') }
  }, [])
  useCashRefresh(load, 'supervision')

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
    {loadError && <p role="alert" className="cash-error">{loadError}. No se pudo actualizar la supervisión.</p>}
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

    {arqueoOpen && <CerrarTurnoModal onClose={() => setArqueoOpen(false)} onConfirm={(denominaciones) => confirmarArqueo(denominaciones)} />}
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
