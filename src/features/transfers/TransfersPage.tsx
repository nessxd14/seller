import { ArrowRight, ChevronDown, ChevronUp, Clock, PackageCheck, Plus, Printer, RotateCcw, Truck, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TransferDispatchLine, TransferEstado, TransferMotivo, TransferRecord } from '../../application/shared/models'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import { cantidadDevolucion, diasEnTransito, estadoLineaTraslado, mensajeErrorTraslado, pendienteTraslado, puedeDespacharTraslado, puedeSolicitarTraslado, recibibleTraslado, sucursalPermiteTraslado } from '../../domain/sales/transfers'
import { transferService, productRepository, listPresentations } from '../../infrastructure/services'
import type { CartItem, Product } from '../../types'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { usePos } from '../../context/PosContext'
import { NumberField } from '../../components/NumberField'
import { TrasladoExportable } from '../../components/TrasladoExportable'
import { TrasladoQr } from '../../components/TrasladoQr'
import { matchesNumero } from '../../domain/documents/matchesNumero'

// Exportados (Brief S8): TrasladoExportable los reusa tal cual — no duplicarlos ahí.
export const motivoLabel: Record<TransferMotivo, string> = { VENTA_DIRECTA: 'Venta directa', REPOSICION: 'Reposición', DEVOLUCION: 'Devolución' }
// Brief K: mismos ids que PosContext.tsx / TrasladoTargetPicker (1 = Almacén Central, 2 = Tienda).
export const sucursalLabel: Record<number, string> = { 1: 'Almacén Central', 2: 'Tienda' }
export const fmtQty = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })
export const fechaFmt = (iso?: string) => iso ? new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
// Brief K: "reusar el helper mmss(ms) que ya existe en PedidosApp.jsx" (WMS) — mismo
// gesto, puerto TS. m:ss, sin ceros a la izquierda en los minutos.
const mmss = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface PendingTransferRequest {
  productId: string
  productName: string
  productSku: string
  quantity: number
}

export function TransfersPage({ notify, session, initialRequest = null, onInitialRequestConsumed, onRegistrarDevolucion }: {
  session?: AuthSession | null
  notify: (message: string) => void
  initialRequest?: PendingTransferRequest | null
  onInitialRequestConsumed?: () => void
  // Brief K: "Registrar devolución" abre el carrito en modo traslado — la navegación de
  // vuelta a la pestaña Venta vive en PosPage, no acá (mismo patrón que onOpenDraftOrder).
  onRegistrarDevolucion?: () => void
}) {
  const { loadTrasladoDraft } = usePos()
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TransferRecord | null>(null)
  const [creating, setCreating] = useState(false)
  const [creationRequest, setCreationRequest] = useState(initialRequest)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const [relatedId, setRelatedId] = useState<string | null>(null)
  const [cerradosAbierto, setCerradosAbierto] = useState(false)
  // Contador mm:ss en vivo. `now` (no Date.now() inline en el render — la regla de pureza
  // de hooks lo rechaza) se actualiza cada segundo mientras haya algo EN_TRANSITO con
  // reversible_hasta futuro visible en pantalla.
  const [now, setNow] = useState(() => Date.now())

  const load = () => { setStatus('loading'); return transferService.list().then((items) => { setTransfers(items); setStatus('ready') }).catch(() => setStatus('error')) }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount, not a derived-state sync
    void load()
  }, [])

  useEffect(() => {
    const hasLiveCountdown = transfers.some((t) => t.estado === 'EN_TRANSITO' && t.reversibleHasta && new Date(t.reversibleHasta).getTime() > now)
    if (!hasLiveCountdown) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` deliberately excluded: re-evaluating hasLiveCountdown every tick would tear down and rebuild the interval every second
  }, [transfers])

  // Cart -> Traslados handoff (Brief J item 1.2): opens the create form pre-filled with the
  // shortfall line, mirroring QuotationsPage's initialDraft/onInitialDraftConsumed pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs an external pending request (from CartPanel) into local UI state, then immediately notifies the parent to clear it
    if (initialRequest) { setCreationRequest(initialRequest); setCreating(true); onInitialRequestConsumed?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest])

  // Brief K: la bandeja reemplaza al armador de una línea a la vez — tres grupos, en el
  // orden en que se trabaja.
  // Brief T3 Tarea 4: mismo criterio de búsqueda por número (completo o sufijo) que
  // Cotizaciones/Pedidos, más el asunto libre como fallback de texto.
  const filteredTransfers = useMemo(
    () => transfers.filter((t) => matchesNumero(t.numero, query) || (t.referencia ?? '').toLowerCase().includes(query.trim().toLowerCase())),
    [transfers, query]
  )
  const porDespachar = useMemo(() => filteredTransfers.filter((t) => t.estado === 'SOLICITADO'), [filteredTransfers])
  const enTransito = useMemo(() => filteredTransfers.filter((t) => t.estado === 'EN_TRANSITO'), [filteredTransfers])
  const cerrados = useMemo(() => filteredTransfers.filter((t) => t.estado === 'RECIBIDO' || t.estado === 'CANCELADO' || t.estado === 'RECHAZADO'), [filteredTransfers])

  const openTransfer = async (transfer: TransferRecord) => {
    try {
      const current = await transferService.getById(transfer.id)
      if (!current) throw new Error('La solicitud de traslado ya no está disponible')
      setSelected(current)
      setError(''); setRelatedId(null)
    } catch (error) {
      notify(mensajeErrorTraslado(error, 'No se pudo cargar el traslado completo'))
    }
  }

  const runMutation = async (action: () => Promise<void>) => {
    if (mutation.current) return
    mutation.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(mensajeErrorTraslado(e, 'No se pudo completar la operación')) }
    finally { mutation.current = false; setBusy(false) }
  }
  const dispatchTransfer = async (transfer: TransferRecord, lines: TransferDispatchLine[]) => {
    const updated = await transferService.dispatch(transfer.id, lines)
    setSelected(updated)
    setRelatedId(updated.resultadoDespacho?.tanda_faltante_id != null ? String(updated.resultadoDespacho.tanda_faltante_id) : null)
    await load()
    notify(updated.estado === 'EN_TRANSITO' ? `${updated.numero}: salida registrada; revisa el resumen` : `${updated.numero}: no salió mercadería; revisa el resultado`)
  }

  const revertTransfer = async (transfer: TransferRecord) => {
    if (!confirm(`¿Revertir ${transfer.numero}? El stock vuelve a su ubicación de origen.`)) return
    const updated = await transferService.revert(transfer.id)
    setSelected(updated)
    await load()
    notify(`${updated.numero} revertido`)
  }

  // Brief K: fuera de ventana (o ya RECIBIDO) revertir_traslado rechaza — el camino es una
  // devolución nueva Tienda -> Almacén, precargada con lo que efectivamente salió/llegó.
  const registrarDevolucion = async (transfer: TransferRecord) => {
    const items = await Promise.all(transfer.lines.filter((l) => cantidadDevolucion(l) > 0).map(async (line): Promise<CartItem | null> => {
      const product = await productRepository.getById(line.productId)
      if (!product) throw new Error(`No se puede preparar la devolución: falta el producto ${line.name}`)
      const cantidadBase = cantidadDevolucion(line)
      const factor = line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1
      return {
        ...product,
        cantidad: factor !== 0 ? cantidadBase / factor : cantidadBase,
        precioAplicado: 0,
        descuento: 0,
        ubicacion: transfer.sucursalDestinoId === 1 ? 'Almacén' : 'Tienda',
        observacion: '',
        motivoPrecio: '',
        presentacionId: line.presentacionId,
        presentacionNombre: line.presentacionNombre,
        factorUnidadBase: line.presentacionId != null ? factor : undefined,
      }
    }))
    const cart = items.filter((item): item is CartItem => item !== null)
    if (!cart.length) { notify('No se pudo precargar el carrito — los productos ya no existen'); return }
    loadTrasladoDraft({ cart, trasladoMotivo: 'DEVOLUCION', trasladoOrigenId: transfer.sucursalDestinoId, trasladoDestinoId: transfer.sucursalOrigenId })
    setSelected(null)
    onRegistrarDevolucion?.()
    notify('Carrito de devolución abierto con la dirección inversa y las cantidades entregadas')
  }

  const receiveTransfer = async (transfer: TransferRecord, lines: null | Array<{ lineaId: string; cantidadBase: number }>) => {
    if (!confirm('¿Confirmas que comprobaste físicamente los productos y las cantidades recibidas?')) return
    const updated = await transferService.receive(transfer.id, lines)
    setSelected(updated)
    await load()
    notify('Recepción registrada')
  }

  const recoverTransfer = async (transfer: TransferRecord) => {
    if (!confirm('¿Crear una nueva solicitud con las líneas que nunca salieron? Esta acción no mueve stock ni confirma una recepción.')) return
    const result = await transferService.recover(transfer.id)
    const current = await transferService.getById(transfer.id)
    if (current) setSelected(current)
    setRelatedId(result.tandaFaltanteId ?? null)
    await load()
    notify(`${result.recuperadas} líneas recuperadas en una solicitud pendiente`)
  }
  const openRelated = async (id: string) => {
    const t = await transferService.getById(id)
    if (!t) throw new Error('No se encontró la tanda relacionada')
    setSelected(t); setRelatedId(null); setError('')
  }

  return <FeatureShell eyebrow="LOGÍSTICA" title="Traslados" subtitle="Solicitar, seguir la salida y confirmar la recepción física" action={<div className="traslado-toolbar"><button className="secondary-button" disabled={busy} onClick={() => { setError(''); void load() }}>Actualizar</button>{puedeSolicitarTraslado(session) && <button className="primary-button" onClick={() => setCreating(true)}><Plus /> Nueva solicitud</button>}</div>}>
    {error && !selected && <p role="alert" className="line-stock-error">{error}</p>}
    {!!transfers.length && <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por número o asunto..." />}
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando traslados" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !transfers.length ? <FeatureState type="empty" text="No hay solicitudes de traslado" /> : !filteredTransfers.length ? <FeatureState type="no-results" text="No hay traslados que coincidan con la búsqueda" /> : <div className="traslados-bandeja">
      <TrasladoGrupo titulo="Por despachar" items={porDespachar} onSelect={(t) => void openTransfer(t)} now={now} />
      <TrasladoGrupo titulo="En tránsito" items={enTransito} onSelect={(t) => void openTransfer(t)} now={now} />
      <div className="traslados-grupo">
        <button type="button" className="traslados-grupo-header traslados-grupo-toggle" onClick={() => setCerradosAbierto((v) => !v)}>
          <span>Cerrados<b>{cerrados.length}</b></span>
          {cerradosAbierto ? <ChevronUp /> : <ChevronDown />}
        </button>
        {cerradosAbierto && (cerrados.length
          ? <div className="traslados-grupo-cards">{cerrados.map((t) => <TrasladoCard key={t.id} transfer={t} onSelect={(t) => void openTransfer(t)} now={now} />)}</div>
          : <p className="traslados-grupo-empty">Sin traslados cerrados todavía.</p>)}
      </div>
    </div>}
    {selected && (
      <TransferDetailPanel
        key={`${selected.id}:${selected.estado}:${selected.lines.map((l) => l.estado).join(',')}`}
        transfer={selected}
        session={session} busy={busy} error={error} relatedId={relatedId}
        childrenTransfers={transfers.filter((t) => t.tandaDeId === selected.id)}
        onClose={() => { if (!busy) { setSelected(null); setError(''); setRelatedId(null) } }}
        onDispatch={(lines) => void runMutation(() => dispatchTransfer(selected, lines))}
        onRevert={() => void runMutation(() => revertTransfer(selected))}
        onRegistrarDevolucion={onRegistrarDevolucion ? () => void runMutation(() => registrarDevolucion(selected)) : undefined}
        onReceive={(lines) => void runMutation(() => receiveTransfer(selected, lines))}
        onRecover={() => void runMutation(() => recoverTransfer(selected))}
        onRelated={(id) => void runMutation(() => openRelated(id))}
      />
    )}
    {creating && (
      <CreateTransferModal
        initialRequest={creationRequest}
        session={session}
        onClose={() => { setCreating(false); setCreationRequest(null) }}
        onCreated={async () => { setCreating(false); setCreationRequest(null); await load(); notify('Solicitud de traslado creada') }}
      />
    )}
  </FeatureShell>
}

function EstadoBadge({ estado }: { estado: TransferEstado }) {
  // Brief K: reusa la convención de colores de PedidosApp.jsx (WMS) — mismo significado
  // semántico, trasladado a las clases de este proyecto (sin Tailwind acá).
  const cls = estado === 'SOLICITADO' ? 'solicitado' : estado === 'EN_TRANSITO' ? 'en-transito' : estado === 'RECIBIDO' ? 'recibido' : 'cerrado'
  const label = estado === 'SOLICITADO' ? 'Por despachar' : estado === 'EN_TRANSITO' ? 'En tránsito' : estado === 'RECIBIDO' ? 'Recibido' : estado === 'RECHAZADO' ? 'Rechazado' : 'Cancelado'
  return <span className={`traslado-badge traslado-badge-${cls}`}>{label}</span>
}

function TrasladoGrupo({ titulo, items, onSelect, now }: { titulo: string; items: TransferRecord[]; onSelect: (t: TransferRecord) => void; now: number }) {
  return <div className="traslados-grupo">
    <div className="traslados-grupo-header"><span>{titulo}<b>{items.length}</b></span></div>
    {items.length
      ? <div className="traslados-grupo-cards">{items.map((t) => <TrasladoCard key={t.id} transfer={t} onSelect={onSelect} now={now} />)}</div>
      : <p className="traslados-grupo-empty">Nada acá por ahora.</p>}
  </div>
}

function TrasladoCard({ transfer, onSelect, now }: { transfer: TransferRecord; onSelect: (t: TransferRecord) => void; now: number }) {
  const restanteMs = transfer.reversibleHasta ? new Date(transfer.reversibleHasta).getTime() - now : 0
  const vigente = transfer.estado === 'EN_TRANSITO' && restanteMs > 0
  return <button type="button" className="traslado-card" onClick={() => onSelect(transfer)}>
    <div className="traslado-card-top">
      <strong className="doc-number-mono">{transfer.numero}</strong>
      <EstadoBadge estado={transfer.estado} />
    </div>
    <p className="traslado-card-direccion">{sucursalLabel[transfer.sucursalOrigenId] ?? `Sucursal ${transfer.sucursalOrigenId}`} <ArrowRight size={11} /> {sucursalLabel[transfer.sucursalDestinoId] ?? `Sucursal ${transfer.sucursalDestinoId}`}</p>
    <p className="traslado-card-meta">{motivoLabel[transfer.motivo]} · {transfer.lines.length} línea{transfer.lines.length === 1 ? '' : 's'}</p>
    {transfer.referencia && <p className="traslado-card-meta">{transfer.referencia}</p>}
    {transfer.tandaDeId && <p className="traslado-card-meta">Faltante de traslado #{transfer.tandaDeId} · tanda {transfer.numeroTanda}</p>}
    {diasEnTransito(transfer, now) > 0 && <p className="traslado-card-countdown">{diasEnTransito(transfer, now)} días sin recepción registrada</p>}
    <p className="traslado-card-meta">{transfer.solicitadoPor} · {fechaFmt(transfer.solicitadoEn)}</p>
    {vigente && <p className="traslado-card-countdown"><Clock size={11} /> {mmss(restanteMs)} para revertir</p>}
  </button>
}

function TransferDetailPanel({ transfer, session, busy, error, relatedId, childrenTransfers, onClose, onDispatch, onRevert, onRegistrarDevolucion, onReceive, onRecover, onRelated }: {
  transfer: TransferRecord
  session?: AuthSession | null
  busy: boolean
  error: string
  relatedId: string | null
  childrenTransfers: TransferRecord[]
  onClose: () => void
  onDispatch: (lines: TransferDispatchLine[]) => void
  onRevert: () => void
  onRegistrarDevolucion?: () => void
  onReceive: (lines: null | Array<{ lineaId: string; cantidadBase: number }>) => void
  onRecover: () => void
  onRelated: (id: string) => void
}) {
  const [receivedByLine, setReceivedByLine] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.lines.map((line) => [line.id, line.cantidadDespachada ?? line.cantidadBase])))
  const [now, setNow] = useState(() => Date.now())
  const [printing, setPrinting] = useState(false)
  const [dispatchByLine, setDispatchByLine] = useState<Record<string, number>>(() => Object.fromEntries(transfer.lines.map((l) => [l.id, l.cantidadBase])))
  const [actions, setActions] = useState<Record<string, TransferDispatchLine['accion']>>({})
  const almacen = puedeDespacharTraslado(session) && sucursalPermiteTraslado(session, transfer.sucursalOrigenId)
  const sinSalida = transfer.lines.filter(pendienteTraslado)
  const legacy = transfer.estado !== 'SOLICITADO' && sinSalida.length > 0
  const canDispatch = transfer.estado === 'SOLICITADO' && almacen
  const canReceive = transfer.estado === 'EN_TRANSITO' && puedeSolicitarTraslado(session) && sucursalPermiteTraslado(session, transfer.sucursalDestinoId) && !legacy
  const resultado = transfer.resultadoDespacho
  const invalidDispatch = sinSalida.some((l) => (actions[l.id] ?? 'DESPACHAR') === 'DESPACHAR' && (!Number.isFinite(dispatchByLine[l.id]) || dispatchByLine[l.id] <= 0 || dispatchByLine[l.id] > l.cantidadBase))
  const restanteMs = transfer.reversibleHasta ? new Date(transfer.reversibleHasta).getTime() - now : 0
  const dentroDeVentana = transfer.estado === 'EN_TRANSITO' && restanteMs > 0
  const fueraDeVentana = transfer.estado === 'EN_TRANSITO' && !dentroDeVentana
  useEffect(() => {
    if (!dentroDeVentana) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [dentroDeVentana])
  const confirmReceive = () => {
    onReceive(transfer.lines.filter(recibibleTraslado).map((line) => ({ lineaId: line.id, cantidadBase: receivedByLine[line.id] ?? line.cantidadDespachada ?? 0 })))
  }
  return <Modal title={transfer.numero} subtitle={motivoLabel[transfer.motivo]} onClose={onClose} side wide escapeToClose={!printing && !busy}>
    <div className="modal-body transfer-detail">
      {error && <p role="alert" className="line-stock-error">{error}</p>}
      {resultado && <section className="traslado-result" role="status"><strong>{Number(resultado.cantidad_despachada) > 0 ? `Salida registrada: ${fmtQty(Number(resultado.cantidad_despachada))} unidades base` : 'No salió mercadería de este traslado'}</strong>
        {(resultado.bloqueadas_por_stock ?? []).map((l) => <p key={l.linea_id}>{transfer.lines.find((x) => x.id === String(l.linea_id))?.name ?? `Línea ${l.linea_id}`}: no salió por stock; pedido {fmtQty(l.pedido)}, disponible {fmtQty(l.disponible)}.</p>)}
        {(resultado.parciales ?? []).map((l) => <p key={l.linea_id}>{transfer.lines.find((x) => x.id === String(l.linea_id))?.name}: salieron {fmtQty(l.despachado)} de {fmtQty(l.pedido)}; saldo {fmtQty(l.saldo)} en otra tanda.</p>)}
        {!!resultado.rechazadas?.length && <p>{resultado.rechazadas.length} líneas rechazadas.</p>}
        {!!resultado.omitidas?.length && <p>{resultado.omitidas.length} líneas omitidas pasaron a faltante.</p>}
      </section>}
      {relatedId && <button className="secondary-button" disabled={busy} onClick={() => onRelated(relatedId)}>Abrir nueva tanda de faltantes</button>}
      {childrenTransfers.filter((t) => t.id !== relatedId).map((t) => <button key={t.id} className="secondary-button" disabled={busy} onClick={() => onRelated(t.id)}>Ver faltante {t.numero} · tanda {t.numeroTanda}</button>)}
      {transfer.tandaDeId && <button className="secondary-button" disabled={busy} onClick={() => onRelated(transfer.tandaDeId!)}>Ver traslado de origen · tanda {transfer.numeroTanda}</button>}
      {legacy && <section role="alert" className="traslado-result"><p>{sinSalida.length} líneas de este traslado nunca salieron. Almacén debe recuperarlas en otra solicitud antes de registrar la recepción.</p>{almacen && <button className="secondary-button" disabled={busy} onClick={onRecover}>Recuperar líneas sin salida</button>}</section>}
      <div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong><EstadoBadge estado={transfer.estado} /></strong></div></div>
      <p><b>Dirección:</b> {sucursalLabel[transfer.sucursalOrigenId] ?? `Sucursal ${transfer.sucursalOrigenId}`} <ArrowRight size={11} /> {sucursalLabel[transfer.sucursalDestinoId] ?? `Sucursal ${transfer.sucursalDestinoId}`}</p>
      {transfer.referencia && <p><b>Asunto:</b> {transfer.referencia}</p>}
      <p><b>Solicitado por:</b> {transfer.solicitadoPor} · {fechaFmt(transfer.solicitadoEn)}</p>
      {transfer.despachadoPor && <p><b>Despachado por:</b> {transfer.despachadoPor} · {fechaFmt(transfer.despachadoEn)}</p>}
      {transfer.recibidoPor && <p><b>Recibido por:</b> {transfer.recibidoPor} · {fechaFmt(transfer.recibidoEn)}</p>}
      {transfer.nota && <p><b>Nota:</b> {transfer.nota}</p>}
      <h3>Líneas</h3>
      <TrasladoQr id={transfer.id} numero={transfer.numero} />
      <div className="feature-table transfer-lines-table">
        <div className="table-head"><span>Producto</span><span>Solicitado</span><span>Despachado</span><span>{canReceive ? 'Recibido (editable)' : 'Recibido'}</span></div>
        {transfer.lines.map((line) => {
          const despachada = line.cantidadDespachada ?? line.cantidadBase
          const factor = line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1
          const receivedBase = receivedByLine[line.id] ?? despachada
          const short = canReceive && receivedBase < despachada
          const receivedInUnit = receivedBase / factor
          const despachadaInUnit = despachada / factor
          const onChangeReceived = (enteredUnit: number) => {
            const nextBase = Math.max(0, Math.min(despachada, enteredUnit * factor))
            setReceivedByLine((prev) => ({ ...prev, [line.id]: nextBase }))
          }
          return <article key={line.id}>
            <span><strong>{line.name}</strong><small>{line.sku} · {estadoLineaTraslado(line)}</small></span>
            <span><small className="traslado-mobile-label">Solicitado</small>{line.presentacionNombre ? `${line.cantidadPresentacion} ${line.presentacionNombre}` : line.cantidadBase}</span>
            <span><small className="traslado-mobile-label">Salida</small>{line.cantidadDespachada != null ? `${fmtQty(line.cantidadDespachada / factor)} ${line.presentacionNombre ?? 'base'}` : '—'}{canDispatch && pendienteTraslado(line) && <><select aria-label={`Acción ${line.name}`} disabled={busy} value={actions[line.id] ?? 'DESPACHAR'} onChange={(e) => setActions((prev) => ({ ...prev, [line.id]: e.target.value as TransferDispatchLine['accion'] }))}><option value="DESPACHAR">Despachar</option><option value="FALTANTE">Faltante</option><option value="RECHAZAR">Rechazar</option></select>{(actions[line.id] ?? 'DESPACHAR') === 'DESPACHAR' && <NumberField ariaLabel={`Despachar ${line.name}`} min={0} max={line.cantidadBase / factor} step="any" disabled={busy} value={dispatchByLine[line.id] / factor} onCommit={(q) => setDispatchByLine((prev) => ({ ...prev, [line.id]: q * factor }))} />}</>}</span>
            {canReceive && recibibleTraslado(line) ? (
              <div>
                <small className="traslado-mobile-label">Recibir</small>
                <NumberField ariaLabel={`Recibir ${line.name}`} min={0} max={despachadaInUnit} step="any" disabled={busy} value={receivedInUnit} onCommit={onChangeReceived} />
                {factor !== 1 && <small className="line-equivalence">{line.presentacionNombre} = {fmtQty(receivedBase)} u</small>}
                {short && <small className="line-stock-error">La diferencia ({fmtQty(despachada - receivedBase)}) se registrará como faltante en destino</small>}
              </div>
            ) : <span><small className="traslado-mobile-label">Recibido</small>{line.cantidadRecibida ?? '—'}</span>}
          </article>
        })}
      </div>
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={() => setPrinting(true)}><Printer /> Imprimir</button>
      {canDispatch && <button className="primary-button" disabled={busy || invalidDispatch || !sinSalida.length} onClick={() => onDispatch(sinSalida.map((l) => ({ lineaId: l.id, accion: actions[l.id] ?? 'DESPACHAR', cantidadBase: dispatchByLine[l.id] })))}><Truck /> Registrar salida</button>}
      {dentroDeVentana && almacen && <button className="danger-button" disabled={busy} onClick={onRevert}><Undo2 /> Revertir <Clock size={11} /> {mmss(restanteMs)}</button>}
      {(fueraDeVentana || transfer.estado === 'RECIBIDO') && onRegistrarDevolucion && sucursalPermiteTraslado(session, transfer.sucursalDestinoId) && <button className="danger-button" disabled={busy} onClick={onRegistrarDevolucion}><RotateCcw /> Registrar devolución</button>}
      {canReceive && <button className="primary-button" disabled={busy || !transfer.lines.some(recibibleTraslado)} onClick={confirmReceive}><PackageCheck /> {busy ? 'Registrando…' : 'Confirmar recepción física'}</button>}
    </footer>
    {printing && <TrasladoExportable transfer={transfer} onClose={() => setPrinting(false)} />}
  </Modal>
}

function CreateTransferModal({ initialRequest, session, onClose, onCreated }: {
  session?: AuthSession | null
  initialRequest?: PendingTransferRequest | null
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const [motivo, setMotivo] = useState<TransferMotivo>(initialRequest ? 'VENTA_DIRECTA' : 'REPOSICION')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [lines, setLines] = useState<Array<{ productId: string; name: string; sku: string; presentacionId?: number; presentacionNombre?: string; quantity: number; nota?: string }>>(
    initialRequest ? [{ productId: initialRequest.productId, name: initialRequest.productName, sku: initialRequest.productSku, quantity: initialRequest.quantity }] : []
  )
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [presentationsByProduct, setPresentationsByProduct] = useState<Record<string, Array<{ id: number; nombre: string; factorUnidadBase: number; esBase: boolean }>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reverse, setReverse] = useState(false)
  const origin = reverse ? 2 : 1
  const destination = reverse ? 1 : 2

  useEffect(() => {
    if (!initialRequest) return
    let alive = true
    void listPresentations(Number(initialRequest.productId)).then((list) => {
      if (!alive) return
      setPresentationsByProduct((prev) => ({ ...prev, [initialRequest.productId]: list }))
      const chosen = list.find((p) => p.esBase) ?? list[0]
      if (chosen && !chosen.esBase) setLines((prev) => prev.map((l) => l.productId === initialRequest.productId ? { ...l, presentacionId: chosen.id, presentacionNombre: chosen.nombre } : l))
    }).catch(() => { if (alive) setError('No se pudieron cargar las presentaciones. Reabre la solicitud para reintentar.') })
    return () => { alive = false }
  }, [initialRequest])

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      if (!productQuery.trim()) { setProductResults([]); return }
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 20 } }).then((page) => { if (!cancelled) setProductResults(page.items) }).catch(() => { if (!cancelled) setError('No se pudo buscar productos. Reintenta.') })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [productQuery])

  const addProduct = (product: Product) => {
    if (lines.some((line) => line.productId === String(product.id))) { setProductQuery(''); setProductResults([]); return }
    setLines((prev) => [...prev, { productId: String(product.id), name: product.nombre, sku: product.sku, quantity: 1 }])
    void listPresentations(product.id).then((list) => {
      setPresentationsByProduct((prev) => ({ ...prev, [String(product.id)]: list }))
      const chosen = list.find((p) => p.esBase) ?? list[0]
      if (chosen && !chosen.esBase) updateLine(String(product.id), { presentacionId: chosen.id, presentacionNombre: chosen.nombre })
    }).catch(() => setError('No se pudieron cargar las presentaciones. Vuelve a agregar el producto.'))
    setProductQuery('')
    setProductResults([])
  }

  const updateLine = (productId: string, patch: Partial<{ quantity: number; presentacionId?: number; presentacionNombre?: string; nota?: string }>) =>
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)))

  const removeLine = (productId: string) => setLines((prev) => prev.filter((line) => line.productId !== productId))

  const valid = puedeSolicitarTraslado(session) && lines.length > 0 && lines.every((line) => Number.isFinite(line.quantity) && line.quantity > 0)

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError('')
    try {
      await transferService.create({
        motivo,
        referencia: referencia || undefined,
        nota: nota || undefined,
        sucursalOrigenId: origin,
        sucursalDestinoId: destination,
        lines: lines.map((line) => ({
          productId: line.productId,
          nota: line.nota,
          ...(line.presentacionId != null ? { presentacionId: line.presentacionId, cantidadPresentacion: line.quantity } : { cantidadBase: line.quantity }),
        })),
      })
      await onCreated()
    } catch (e) {
      setError(mensajeErrorTraslado(e, 'No se pudo crear la solicitud'))
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Nueva solicitud de traslado" subtitle={`${sucursalLabel[origin]} → ${sucursalLabel[destination]}`} onClose={() => { if (!saving) onClose() }} wide>
    <div className="modal-body form-grid">
      {error && <p role="alert" className="line-stock-error full">{error}</p>}
      <label>Dirección<select aria-label="Dirección del traslado" disabled={saving} value={reverse ? 'reverse' : 'forward'} onChange={(e) => setReverse(e.target.value === 'reverse')}><option value="forward">Almacén → Tienda</option><option value="reverse">Tienda → Almacén</option></select></label>
      <label>Motivo<select value={motivo} disabled={saving} onChange={(e) => { setMotivo(e.target.value as TransferMotivo); if (e.target.value === 'DEVOLUCION') setReverse(true) }}><option value="VENTA_DIRECTA">Venta directa</option><option value="REPOSICION">Reposición</option><option value="DEVOLUCION">Devolución</option></select></label>
      <label>Referencia (opcional)<input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. TR-0005" /></label>
      <label className="full">Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo del traslado, notas para almacén..." /></label>
      <div className="full line-add-controls">
        <input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Buscar producto por nombre, código o SKU..." />
        {productResults.length > 0 && (
          <div className="product-search-results">
            {productResults.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><strong>{product.nombre}</strong><small>{product.sku}</small></button>)}
          </div>
        )}
      </div>
      <div className="full editor-lines draft-lines">
        <header><strong>Productos a solicitar</strong></header>
        {lines.map((line) => {
          const presentations = presentationsByProduct[line.productId] ?? []
          return <div key={line.productId} className="draft-line-row presentation-line-row">
            <div className="draft-line-top">
              <span><strong>{line.name}</strong><small>{line.sku}</small></span>
              <NumberField ariaLabel={`Cantidad ${line.name}`} min={0.000001} step="any" disabled={saving} value={line.quantity} onCommit={(quantity) => updateLine(line.productId, { quantity })} />
              {presentations.length > 0 && (
                <select
                  aria-label={`Presentación ${line.name}`}
                  value={line.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id}
                  onChange={(e) => {
                    const chosen = presentations.find((p) => p.id === Number(e.target.value))
                    if (chosen) updateLine(line.productId, { presentacionId: chosen.esBase ? undefined : chosen.id, presentacionNombre: chosen.esBase ? undefined : chosen.nombre })
                  }}
                >
                  {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              )}
              <button type="button" onClick={() => removeLine(line.productId)}><X /></button>
            </div>
          </div>
        })}
        {!lines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Busca y agrega productos a la solicitud.</div>}
      </div>
    </div>
    <footer className="modal-actions">
      <button className="secondary-button" onClick={onClose}>Cancelar</button>
      <button className="primary-button" disabled={!valid || saving} onClick={() => void submit()}>Crear solicitud</button>
    </footer>
  </Modal>
}
