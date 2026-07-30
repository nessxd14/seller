import { ArrowRight, ChevronDown, ChevronUp, Clock, PackageCheck, Plus, RotateCcw, Truck, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TransferEstado, TransferMotivo, TransferRecord } from '../../application/shared/models'
import { transferService, productRepository, listPresentations } from '../../infrastructure/services'
import type { CartItem, Product } from '../../types'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { Modal } from '../../components/Modal'
import { usePos } from '../../context/PosContext'

const motivoLabel: Record<TransferMotivo, string> = { VENTA_DIRECTA: 'Venta directa', REPOSICION: 'Reposición', DEVOLUCION: 'Devolución' }
// Brief K: mismos ids que PosContext.tsx / TrasladoTargetPicker (1 = Almacén Central, 2 = Tienda).
const sucursalLabel: Record<number, string> = { 1: 'Almacén Central', 2: 'Tienda' }
const fmtQty = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })
const fechaFmt = (iso?: string) => iso ? new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
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

export function TransfersPage({ notify, initialRequest = null, onInitialRequestConsumed, onRegistrarDevolucion }: {
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
  const [selected, setSelected] = useState<TransferRecord | null>(null)
  const [creating, setCreating] = useState(false)
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
    if (initialRequest) { setCreating(true); onInitialRequestConsumed?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRequest])

  // Brief K: la bandeja reemplaza al armador de una línea a la vez — tres grupos, en el
  // orden en que se trabaja.
  const porDespachar = useMemo(() => transfers.filter((t) => t.estado === 'SOLICITADO'), [transfers])
  const enTransito = useMemo(() => transfers.filter((t) => t.estado === 'EN_TRANSITO'), [transfers])
  const cerrados = useMemo(() => transfers.filter((t) => t.estado === 'RECIBIDO' || t.estado === 'CANCELADO' || t.estado === 'RECHAZADO'), [transfers])

  const dispatchTransfer = async (transfer: TransferRecord) => {
    try {
      const updated = await transferService.dispatch(transfer.id)
      setSelected(updated)
      await load()
      notify(`Traslado #${updated.id} despachado`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo despachar el traslado')
    }
  }

  const revertTransfer = async (transfer: TransferRecord) => {
    if (!confirm(`¿Revertir el traslado #${transfer.id}? El stock vuelve a su ubicación de origen.`)) return
    try {
      const updated = await transferService.revert(transfer.id)
      setSelected(updated)
      await load()
      notify(`Traslado #${updated.id} revertido`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo revertir el traslado')
    }
  }

  // Brief K: fuera de ventana (o ya RECIBIDO) revertir_traslado rechaza — el camino es una
  // devolución nueva Tienda -> Almacén, precargada con lo que efectivamente salió/llegó.
  const registrarDevolucion = async (transfer: TransferRecord) => {
    const items = await Promise.all(transfer.lines.map(async (line): Promise<CartItem | null> => {
      const product = await productRepository.getById(line.productId)
      if (!product) return null
      const cantidadBase = line.cantidadRecibida ?? line.cantidadDespachada ?? line.cantidadBase
      const factor = line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1
      return {
        ...product,
        cantidad: factor !== 0 ? cantidadBase / factor : cantidadBase,
        precioAplicado: 0,
        descuento: 0,
        ubicacion: 'Tienda',
        observacion: '',
        motivoPrecio: '',
        presentacionId: line.presentacionId,
        presentacionNombre: line.presentacionNombre,
        factorUnidadBase: line.presentacionId != null ? factor : undefined,
      }
    }))
    const cart = items.filter((item): item is CartItem => item !== null)
    if (!cart.length) { notify('No se pudo precargar el carrito — los productos ya no existen'); return }
    loadTrasladoDraft({ cart, trasladoMotivo: 'DEVOLUCION', trasladoOrigenId: 2, trasladoDestinoId: 1 })
    setSelected(null)
    onRegistrarDevolucion?.()
    notify('Carrito abierto en modo traslado — Devolución, Tienda → Almacén')
  }

  const receiveTransfer = async (transfer: TransferRecord, lines: null | Array<{ lineaId: string; cantidadBase: number }>) => {
    const updated = await transferService.receive(transfer.id, lines)
    setSelected(updated)
    await load()
    notify('Recepción registrada')
  }

  return <FeatureShell eyebrow="LOGÍSTICA" title="Traslados" subtitle="Bandeja: despachar, recibir y revertir traslados Almacén ↔ Tienda" action={<button className="primary-button" onClick={() => setCreating(true)}><Plus /> Nueva solicitud</button>}>
    {status === 'loading' ? <FeatureState type="skeleton" text="Cargando traslados" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar" /> : !transfers.length ? <FeatureState type="empty" text="No hay solicitudes de traslado" /> : <div className="traslados-bandeja">
      <TrasladoGrupo titulo="Por despachar" items={porDespachar} onSelect={setSelected} now={now} />
      <TrasladoGrupo titulo="En tránsito" items={enTransito} onSelect={setSelected} now={now} />
      <div className="traslados-grupo">
        <button type="button" className="traslados-grupo-header traslados-grupo-toggle" onClick={() => setCerradosAbierto((v) => !v)}>
          <span>Cerrados<b>{cerrados.length}</b></span>
          {cerradosAbierto ? <ChevronUp /> : <ChevronDown />}
        </button>
        {cerradosAbierto && (cerrados.length
          ? <div className="traslados-grupo-cards">{cerrados.map((t) => <TrasladoCard key={t.id} transfer={t} onSelect={setSelected} now={now} />)}</div>
          : <p className="traslados-grupo-empty">Sin traslados cerrados todavía.</p>)}
      </div>
    </div>}
    {selected && (
      <TransferDetailPanel
        transfer={selected}
        onClose={() => setSelected(null)}
        onDispatch={() => void dispatchTransfer(selected)}
        onRevert={() => void revertTransfer(selected)}
        onRegistrarDevolucion={() => void registrarDevolucion(selected)}
        onReceive={(lines) => void receiveTransfer(selected, lines)}
      />
    )}
    {creating && (
      <CreateTransferModal
        initialRequest={initialRequest}
        onClose={() => setCreating(false)}
        onCreated={async () => { setCreating(false); await load(); notify('Solicitud de traslado creada') }}
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
      <strong>{transfer.referencia || `Traslado #${transfer.id}`}</strong>
      <EstadoBadge estado={transfer.estado} />
    </div>
    <p className="traslado-card-direccion">{sucursalLabel[transfer.sucursalOrigenId] ?? `Sucursal ${transfer.sucursalOrigenId}`} <ArrowRight size={11} /> {sucursalLabel[transfer.sucursalDestinoId] ?? `Sucursal ${transfer.sucursalDestinoId}`}</p>
    <p className="traslado-card-meta">{motivoLabel[transfer.motivo]} · {transfer.lines.length} línea{transfer.lines.length === 1 ? '' : 's'}</p>
    <p className="traslado-card-meta">{transfer.solicitadoPor} · {fechaFmt(transfer.solicitadoEn)}</p>
    {vigente && <p className="traslado-card-countdown"><Clock size={11} /> {mmss(restanteMs)} para revertir</p>}
  </button>
}

function TransferDetailPanel({ transfer, onClose, onDispatch, onRevert, onRegistrarDevolucion, onReceive }: {
  transfer: TransferRecord
  onClose: () => void
  onDispatch: () => void
  onRevert: () => void
  onRegistrarDevolucion: () => void
  onReceive: (lines: null | Array<{ lineaId: string; cantidadBase: number }>) => void
}) {
  const [receivedByLine, setReceivedByLine] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.lines.map((line) => [line.id, line.cantidadDespachada ?? line.cantidadBase])))
  const [now, setNow] = useState(() => Date.now())
  const canDispatch = transfer.estado === 'SOLICITADO'
  const canReceive = transfer.estado === 'EN_TRANSITO'
  const restanteMs = transfer.reversibleHasta ? new Date(transfer.reversibleHasta).getTime() - now : 0
  const dentroDeVentana = transfer.estado === 'EN_TRANSITO' && restanteMs > 0
  const fueraDeVentana = transfer.estado === 'EN_TRANSITO' && !dentroDeVentana
  useEffect(() => {
    if (!dentroDeVentana) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [dentroDeVentana])
  const confirmReceive = () => {
    const changed = transfer.lines.filter((line) => (receivedByLine[line.id] ?? 0) !== (line.cantidadDespachada ?? line.cantidadBase))
    onReceive(changed.length ? changed.map((line) => ({ lineaId: line.id, cantidadBase: receivedByLine[line.id] })) : null)
  }
  return <Modal title={transfer.referencia || `Traslado #${transfer.id}`} subtitle={motivoLabel[transfer.motivo]} onClose={onClose} side wide>
    <div className="modal-body transfer-detail">
      <div className="order-status-line"><PackageCheck /><div><span>Estado actual</span><strong><EstadoBadge estado={transfer.estado} /></strong></div></div>
      <p><b>Dirección:</b> {sucursalLabel[transfer.sucursalOrigenId] ?? `Sucursal ${transfer.sucursalOrigenId}`} <ArrowRight size={11} /> {sucursalLabel[transfer.sucursalDestinoId] ?? `Sucursal ${transfer.sucursalDestinoId}`}</p>
      <p><b>Solicitado por:</b> {transfer.solicitadoPor} · {fechaFmt(transfer.solicitadoEn)}</p>
      {transfer.despachadoPor && <p><b>Despachado por:</b> {transfer.despachadoPor} · {fechaFmt(transfer.despachadoEn)}</p>}
      {transfer.recibidoPor && <p><b>Recibido por:</b> {transfer.recibidoPor} · {fechaFmt(transfer.recibidoEn)}</p>}
      {transfer.nota && <p><b>Nota:</b> {transfer.nota}</p>}
      <h3>Líneas</h3>
      <div className="feature-table transfer-lines-table">
        <div className="table-head"><span>Producto</span><span>Solicitado</span><span>Despachado</span><span>{canReceive ? 'Recibido (editable)' : 'Recibido'}</span></div>
        {transfer.lines.map((line) => {
          const despachada = line.cantidadDespachada ?? line.cantidadBase
          const factor = line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1
          const receivedBase = receivedByLine[line.id] ?? despachada
          const short = canReceive && receivedBase < despachada
          const receivedInUnit = receivedBase / factor
          const despachadaInUnit = despachada / factor
          const onChangeReceived = (raw: string) => {
            const entered = Number(raw)
            const nextBase = Number.isFinite(entered) ? Math.max(0, Math.min(despachada, entered * factor)) : 0
            setReceivedByLine((prev) => ({ ...prev, [line.id]: nextBase }))
          }
          return <article key={line.id}>
            <span><strong>{line.name}</strong><small>{line.sku}</small></span>
            <span>{line.presentacionNombre ? `${line.cantidadPresentacion} ${line.presentacionNombre}` : line.cantidadBase}</span>
            <span>{line.cantidadDespachada ?? '—'}</span>
            {canReceive ? (
              <div>
                <input type="number" min="0" max={despachadaInUnit} step="any" value={receivedInUnit} onChange={(e) => onChangeReceived(e.target.value)} />
                {factor !== 1 && <small className="line-equivalence">{line.presentacionNombre} = {fmtQty(receivedBase)} u</small>}
                {short && <small className="line-stock-error">La diferencia ({fmtQty(despachada - receivedBase)}) se registrará como faltante en Tienda</small>}
              </div>
            ) : <span>{line.cantidadRecibida ?? '—'}</span>}
          </article>
        })}
      </div>
    </div>
    <footer className="modal-actions">
      {canDispatch && <button className="primary-button" onClick={onDispatch}><Truck /> Despachar</button>}
      {dentroDeVentana && <button className="danger-button" onClick={onRevert}><Undo2 /> Revertir <Clock size={11} /> {mmss(restanteMs)}</button>}
      {fueraDeVentana && <button className="danger-button" onClick={onRegistrarDevolucion}><RotateCcw /> Registrar devolución</button>}
      {transfer.estado === 'RECIBIDO' && <button className="danger-button" onClick={onRegistrarDevolucion}><RotateCcw /> Registrar devolución</button>}
      {canReceive && <button className="primary-button" onClick={confirmReceive}><PackageCheck /> Confirmar recepción</button>}
    </footer>
  </Modal>
}

function CreateTransferModal({ initialRequest, onClose, onCreated }: {
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

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      if (!productQuery.trim()) { setProductResults([]); return }
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 20 } }).then((page) => { if (!cancelled) setProductResults(page.items) })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [productQuery])

  const addProduct = (product: Product) => {
    if (lines.some((line) => line.productId === String(product.id))) { setProductQuery(''); setProductResults([]); return }
    setLines((prev) => [...prev, { productId: String(product.id), name: product.nombre, sku: product.sku, quantity: 1 }])
    void listPresentations(product.id).then((list) => setPresentationsByProduct((prev) => ({ ...prev, [String(product.id)]: list })))
    setProductQuery('')
    setProductResults([])
  }

  const updateLine = (productId: string, patch: Partial<{ quantity: number; presentacionId?: number; presentacionNombre?: string; nota?: string }>) =>
    setLines((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)))

  const removeLine = (productId: string) => setLines((prev) => prev.filter((line) => line.productId !== productId))

  const valid = lines.length > 0 && lines.every((line) => line.quantity > 0)

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    try {
      await transferService.create({
        motivo,
        referencia: referencia || undefined,
        nota: nota || undefined,
        sucursalOrigenId: 1,
        sucursalDestinoId: 2,
        lines: lines.map((line) => ({
          productId: line.productId,
          nota: line.nota,
          ...(line.presentacionId != null ? { presentacionId: line.presentacionId, cantidadPresentacion: line.quantity } : { cantidadBase: line.quantity }),
        })),
      })
      await onCreated()
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Nueva solicitud de traslado" subtitle="Almacén → Tienda" onClose={onClose} wide>
    <div className="modal-body form-grid">
      <label>Motivo<select value={motivo} onChange={(e) => setMotivo(e.target.value as TransferMotivo)}><option value="VENTA_DIRECTA">Venta directa</option><option value="REPOSICION">Reposición</option><option value="DEVOLUCION">Devolución</option></select></label>
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
              <input aria-label={`Cantidad ${line.name}`} type="number" min="1" value={line.quantity} onChange={(e) => updateLine(line.productId, { quantity: Math.max(1, Number(e.target.value)) })} />
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
