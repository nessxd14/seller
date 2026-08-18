import { Building2, Landmark, Minus, Pencil, Plus, Warehouse, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { QuoteDraft, WorkflowLine } from '../../application/shared/models'
import type { CustomerRecord } from '../../application/shared/models'
import { customerService, productRepository, getStockByProduct, listPresentations, listLineIdentifiers, authSessionProvider } from '../../infrastructure/services'
import { featureFlags } from '../../config/featureFlags'
import { aggregateStockBySucursal } from '../inventory/stockAggregation'
import { formatMoney, money } from '../../domain/common/money'
import { Modal } from '../../components/Modal'
import { SaldoBadge } from '../../components/SaldoBadge'
import { NumberField } from '../../components/NumberField'
import type { LineIdentifiers } from '../../components/LineIdentifiersRow'
import { buildOriginOptions } from '../../components/OriginPin'
import { cantidadBaseFor } from '../../domain/sales/stockCheck'
import type { Product } from '../../types'
import { useBorrador, borradorKey } from '../../hooks/useBorrador'
import { BorradorBanner } from '../../components/BorradorBanner'
import { EditQuoteLineModal } from './EditQuoteLineModal'
import { coincideBusqueda } from '../../domain/customers/textSearch'
import { requiereCotizacionOrigen } from '../../domain/quotations/requiereCotizacionOrigen'
import { ProductQuickAdd } from '../../components/ProductQuickAdd'

type EditableChannel = QuoteDraft['channel']

const channelTabs: { id: EditableChannel; label: string; icon: typeof Warehouse }[] = [
  { id: 'mayoreo', label: 'Mayoreo', icon: Warehouse },
  { id: 'institucional', label: 'Institucional', icon: Building2 },
  { id: 'municipal', label: 'Municipal', icon: Landmark },
]

const priceForChannel = (product: Product, channel: EditableChannel) =>
  channel === 'mayoreo' ? product.precioMayoreo : channel === 'institucional' ? product.precioInstitucional : product.precioMunicipal

const defaultSourceForChannel = (): 'Tienda' | 'Almacén' => 'Almacén' // MAYOR/INST/MUNICIPAL all default to Almacén

const lineTotalCents = (line: WorkflowLine) => Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000)

type LinePresentation = { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }
type LineStock = { tienda: number; almacen: number }

const fmtQty = (n: number) => n.toLocaleString('es-BO')

export function DraftOrderEditor({ quote, isExistingQuote = false, onClose, onSave, onCreateOrder, onConvert }: {
  quote: QuoteDraft
  // Ronda 5 — TAREA 1: whether `quote` was loaded from an existing row in the
  // Cotizaciones table (as opposed to a brand-new draft just created, or one
  // handed off from the cart's "Crear pedido"/"Cotización" shortcuts). This is
  // NOT the same as `quote.id` being non-empty: in mock mode a fresh draft is
  // minted with a real crypto.randomUUID() id immediately (no server round trip
  // to leave it empty), so `quote.id` alone can't distinguish "existing" from
  // "brand new" the way it can in Supabase mode. The caller (QuotationsPage)
  // tracks this explicitly at each of its three entry points instead.
  isExistingQuote?: boolean
  onClose: () => void
  onSave: (quote: QuoteDraft) => void | Promise<void>
  onCreateOrder?: (quote: QuoteDraft) => void | Promise<void>
  onConvert?: (quote: QuoteDraft) => void | Promise<void>
}) {
  const [value, setValue] = useState<QuoteDraft>(() => structuredClone(quote))
  const readOnly = value.status !== 'draft' && value.id !== ''
  const [customerQuery, setCustomerQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [scanSku, setScanSku] = useState('')
  // TAREA T1 (T1): reemplaza PricePopover/MaskPopover — un solo modal completo por línea,
  // fuera del overflow:auto del .modal ancestro (esa era la causa raíz del recorte).
  const [editLineModalId, setEditLineModalId] = useState<string | null>(null)
  const [actorId, setActorId] = useState('pos')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Brief H — useBorrador: autosave de la cotización. Desactivado en solo-lectura (nada
  // que autoguardar ahí); si queda un borrador viejo de otra cotización nueva sin
  // terminar, igual se ofrece — el banner es por tipo de formulario, no por registro.
  const { borradorPendiente, descartar: descartarBorrador, limpiar: limpiarBorrador } = useBorrador(borradorKey('cotizacion', actorId), value, { activo: !readOnly })
  const retomarBorrador = () => { if (borradorPendiente) { setValue(borradorPendiente.datos); limpiarBorrador() } }
  // Item 2/3: per-productId caches so stock + presentations are fetched once (on add), not
  // on every render or toggle interaction.
  const [stockByProduct, setStockByProduct] = useState<Record<string, LineStock>>({})
  const [presentationsByProduct, setPresentationsByProduct] = useState<Record<string, LinePresentation[]>>({})
  // Base (per-base-unit) price captured at add-time, used to suggest a price when the
  // presentation changes; keyed by line id so overrides via PricePopover aren't disturbed.
  const [basePriceCentsByLine, setBasePriceCentsByLine] = useState<Record<string, number>>({})
  // Item 2.2: barra/fábrica/marca, batch-fetched per productId set so a multi-line
  // quote/order doesn't trigger an identifier lookup per line render.
  const [identifiersByProduct, setIdentifiersByProduct] = useState<Record<string, LineIdentifiers>>({})

  // TAREA 4 — custom/personalizado item capture modal state. `customModalForm` holds
  // the in-progress (not-yet-confirmed) form fields; cancelling only discards THIS,
  // never items already committed to value.lines via a previous "Agregar otro" round.
  const emptyCustomForm = { descripcion: '', cantidad: 1, precio: 0, nota: '' }
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customModalForm, setCustomModalForm] = useState(emptyCustomForm)
  const [customModalEditingId, setCustomModalEditingId] = useState<string | null>(null)
  const [customModalAddAnother, setCustomModalAddAnother] = useState(false)
  const [customModalCount, setCustomModalCount] = useState(0)
  const customModalDescripcionRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void authSessionProvider.getSession().then((session) => session && setActorId(session.user.email ?? session.user.id)) }, [])
  useEffect(() => { void customerService.list().then(setCustomers) }, [])

  // Brief S2: guardia por id de pedido (no solo un booleano `cancelled`) — con dos
  // peticiones en vuelo, la más vieja puede resolver DESPUÉS que la más nueva si la red
  // las reordena; comparar contra el último id emitido descarta la respuesta stale
  // aunque ambas terminen "sin cancelar" en el sentido del cleanup de abajo.
  const [productLoading, setProductLoading] = useState(false)
  const productSearchIdRef = useRef(0)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia los resultados en cuanto el término queda vacío, sin esperar al debounce de abajo
    if (!productQuery.trim()) { setProductResults([]); setProductLoading(false); return }
    const requestId = ++productSearchIdRef.current
    setProductLoading(true)
    const handle = setTimeout(() => {
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 20 } }).then((page) => {
        if (productSearchIdRef.current === requestId) { setProductResults(page.items); setProductLoading(false) }
      })
    }, 250)
    return () => clearTimeout(handle)
  }, [productQuery])

  // Brief T2 Tarea 3 (único cambio permitido acá al buscador de clientes): normalización
  // sin acentos/mayúsculas — "jose perez" tiene que encontrar "José Pérez".
  const filteredCustomers = useMemo(
    () => customers.filter((c) => coincideBusqueda(`${c.name} ${c.document} ${c.email}`, customerQuery)).slice(0, 8),
    [customers, customerQuery]
  )

  const subtotalCents = value.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)
  const totalCents = Math.max(0, subtotalCents - value.generalDiscountCents)

  const setChannel = (channel: EditableChannel) => setValue((v) => ({ ...v, channel }))

  const pickCustomer = (customer: CustomerRecord) => {
    setValue((v) => ({
      ...v,
      customerId: customer.id,
      customerName: customer.name,
      channel: (customer.usualChannel === 'mayoreo' || customer.usualChannel === 'institucional' || customer.usualChannel === 'municipal') ? customer.usualChannel : v.channel,
    }))
    setShowCustomerPicker(false)
    setCustomerQuery('')
  }

  // Fetches stock + presentations for a product once, caching by productId. Mock mode reads
  // stock straight off the Product object (stockTienda/stockAlmacen) per the brief — no fetch.
  const ensureProductData = (product: Product) => {
    const key = String(product.id)
    if (!(key in stockByProduct)) {
      if (featureFlags.supabase) {
        void getStockByProduct(product.id).then((result) => {
          const agg = aggregateStockBySucursal(result.onHand)
          setStockByProduct((prev) => ({ ...prev, [key]: { tienda: agg.tienda, almacen: agg.almacen } }))
        })
      } else {
        setStockByProduct((prev) => ({ ...prev, [key]: { tienda: product.stockTienda, almacen: product.stockAlmacen } }))
      }
    }
    if (!(key in presentationsByProduct)) {
      void listPresentations(product.id).then((list) => setPresentationsByProduct((prev) => ({ ...prev, [key]: list })))
    }
  }

  // Pre-existing lines (editing a saved draft) need their stock/presentations fetched too —
  // addCatalogProduct only covers lines added interactively in this session.
  useEffect(() => {
    const ids = Array.from(new Set(quote.lines.filter((l) => !l.isCustomItem && l.productId).map((l) => l.productId)))
    ids.forEach((id) => { void productRepository.getById(id).then((product) => { if (product) ensureProductData(product) }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Brief S2: "volver a agregar el mismo producto suma cantidad, no duplica línea" — antes
  // esto no hacía NADA si la línea ya existía (ni sumaba ni duplicaba, un no-op silencioso
  // que el cajero interpretaba como que el click no había funcionado). Tampoco se limpia
  // productQuery/productResults acá: es justo el reinicio que el brief pide sacar — el
  // buscador se limpia únicamente con Escape (ver ProductQuickAdd).
  const addCatalogProduct = (product: Product) => {
    const existing = value.lines.find((line) => line.productId === String(product.id) && !line.isCustomItem)
    if (existing) {
      updateLine(existing.id, { quantity: existing.quantity + 1 })
      return
    }
    const unitPriceCents = Math.round(priceForChannel(product, value.channel) * 100)
    const lineId = crypto.randomUUID()
    const newLine: WorkflowLine = {
      id: lineId,
      productId: String(product.id),
      name: product.nombre,
      sku: product.sku,
      quantity: 1,
      unitPriceCents,
      discountBasisPoints: 0,
      listPriceCents: unitPriceCents,
      sourceLocation: defaultSourceForChannel(),
    }
    setValue((v) => ({ ...v, lines: [...v.lines, newLine] }))
    setBasePriceCentsByLine((prev) => ({ ...prev, [lineId]: unitPriceCents }))
    ensureProductData(product)
  }

  const scanBarcode = async () => {
    const sku = scanSku.trim()
    if (!sku) return
    const found = productResults.find((p) => p.sku === sku) ?? (await productRepository.getById(sku).catch(() => null))
    const product = found ?? productResults.find((p) => p.sku.toLowerCase() === sku.toLowerCase())
    if (product) addCatalogProduct(product)
    setScanSku('')
  }

  const updateLine = (id: string, patch: Partial<WorkflowLine>) =>
    setValue((v) => ({ ...v, lines: v.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) }))

  const removeLine = (id: string) => setValue((v) => ({ ...v, lines: v.lines.filter((line) => line.id !== id) }))

  // TAREA 4 — modal-driven capture flow. "No cambies cómo se guardan las líneas
  // personalizadas. Es UI de captura": the resulting WorkflowLine shape and the
  // updateLine/removeLine mechanism are exactly what addCustomLine used before —
  // only how the fields get typed in changes.
  const openNewCustomModal = () => {
    setCustomModalForm(emptyCustomForm)
    setCustomModalEditingId(null)
    setCustomModalAddAnother(false)
    setCustomModalCount(0)
    setCustomModalOpen(true)
  }

  const openEditCustomModal = (line: WorkflowLine) => {
    setCustomModalForm({ descripcion: line.name, cantidad: line.quantity, precio: line.unitPriceCents / 100, nota: line.note ?? '' })
    setCustomModalEditingId(line.id)
    setCustomModalAddAnother(false)
    setCustomModalCount(0)
    setCustomModalOpen(true)
  }

  const closeCustomModal = () => setCustomModalOpen(false)

  const confirmCustomModal = () => {
    if (!customModalForm.descripcion.trim()) return
    if (customModalEditingId) {
      updateLine(customModalEditingId, {
        name: customModalForm.descripcion.trim(),
        quantity: Math.max(1, customModalForm.cantidad),
        unitPriceCents: Math.max(0, Math.round(customModalForm.precio * 100)),
        note: customModalForm.nota,
      })
      setCustomModalOpen(false)
      return
    }
    const newLine: WorkflowLine = {
      id: crypto.randomUUID(),
      productId: '',
      name: customModalForm.descripcion.trim(),
      sku: '',
      quantity: Math.max(1, customModalForm.cantidad),
      unitPriceCents: Math.max(0, Math.round(customModalForm.precio * 100)),
      discountBasisPoints: 0,
      isCustomItem: true,
      note: customModalForm.nota,
    }
    setValue((v) => ({ ...v, lines: [...v.lines, newLine] }))
    setCustomModalCount((n) => n + 1)
    if (customModalAddAnother) {
      setCustomModalForm(emptyCustomForm)
      requestAnimationFrame(() => customModalDescripcionRef.current?.focus())
    } else {
      setCustomModalOpen(false)
    }
  }

  const catalogLines = value.lines.filter((line) => !line.isCustomItem)
  const customLines = value.lines.filter((line) => line.isCustomItem)

  useEffect(() => {
    const missing = Array.from(new Set(catalogLines.map((line) => line.productId).filter((id) => id && !(id in identifiersByProduct))))
    if (!missing.length) return
    void listLineIdentifiers(missing).then((result) => setIdentifiersByProduct((prev) => ({ ...prev, ...result })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLines])

  // Item 2: stock validation against the currently selected origin only. Base-unit quantity
  // = quantity * factorUnidadBase (item 3's presentation math folded in here).
  const lineErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    for (const line of catalogLines) {
      const stock = stockByProduct[line.productId]
      if (!stock) continue
      const factor = line.factorUnidadBase ?? 1
      const baseQty = line.quantity * factor
      const origin = line.sourceLocation ?? 'Almacén'
      const available = origin === 'Tienda' ? stock.tienda : stock.almacen
      if (baseQty > available) {
        errors[line.id] = `${origin} tiene ${fmtQty(available)}, necesitás ${fmtQty(baseQty)}`
      }
    }
    return errors
  }, [catalogLines, stockByProduct])

  const hasStockErrors = Object.keys(lineErrors).length > 0
  // TAREA 3 (Ronda 9): cliente obligatorio para guardar/convertir una cotización.
  // "Cliente de mostrador" (customerId vacío) no cuenta — es UI-only, no toca la base
  // (8 cotizaciones viejas sin cliente siguen abriéndose porque esto solo bloquea el
  // guardado, no la carga).
  const missingCustomer = !value.customerId

  // Brief T7 Tarea 5: la base rechaza crear un pedido directo (sin cotización de origen)
  // para clientes institucion/corporativo/mayorista — mejor prevenirlo que solo mostrar el
  // error después. "Cliente de mostrador" (customerId vacío) nunca lo requiere: el trigger
  // ya deja pasar cliente_id null.
  const selectedCustomer = customers.find((c) => c.id === value.customerId)
  const requiereCotizacion = requiereCotizacionOrigen(selectedCustomer?.type)

  const runAction = async (action: (q: QuoteDraft) => void | Promise<void>) => {
    setSaving(true)
    setSaveError('')
    try {
      await action(value)
      limpiarBorrador()
    } catch (err) {
      // TAREA 5: el mensaje del trigger ("Los pedidos de clientes X requieren...") se
      // muestra tal cual, nunca reemplazado por uno genérico.
      setSaveError(err instanceof Error ? err.message : 'No se pudo completar la acción')
    } finally {
      setSaving(false)
    }
  }

  const onPresentationChange = (line: WorkflowLine, presentation: LinePresentation) => {
    const basePriceCents = basePriceCentsByLine[line.id] ?? line.unitPriceCents
    const isBase = presentation.esBase || presentation.factorUnidadBase === 1
    const suggestedPriceCents = Math.round(basePriceCents * presentation.factorUnidadBase)
    updateLine(line.id, {
      presentacionId: isBase ? undefined : presentation.id,
      presentacionNombre: isBase ? undefined : presentation.nombre,
      factorUnidadBase: isBase ? undefined : presentation.factorUnidadBase,
      unitPriceCents: suggestedPriceCents,
    })
  }

  return (
    <Modal title={value.id ? `Cotización ${value.number || value.id}` : 'Nueva cotización'} subtitle={readOnly ? 'Solo lectura — esta cotización ya no está en borrador' : 'Editor tipo borrador de pedido'} onClose={onClose} wide escapeToClose={!customModalOpen}>
      <div className="modal-body quote-editor draft-order-editor">
        {borradorPendiente && <BorradorBanner guardadoEn={borradorPendiente.guardadoEn} onRetomar={retomarBorrador} onDescartar={descartarBorrador} />}
        <div className="channel-tabs draft-order-tabs">
          {channelTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" disabled={readOnly} className={value.channel === id ? 'active' : ''} onClick={() => setChannel(id)}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label className="full">
            Cliente
            <div className="customer-search">
              <input
                value={showCustomerPicker ? customerQuery : value.customerName}
                disabled={readOnly}
                placeholder="Buscar cliente por nombre, documento o correo..."
                onFocus={() => setShowCustomerPicker(true)}
                onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerPicker(true) }}
              />
              {showCustomerPicker && !readOnly && (
                <div className="customer-search-results">
                  {filteredCustomers.map((c) => (
                    <button type="button" key={c.id} onClick={() => pickCustomer(c)}>
                      <strong>{c.name}</strong><small>{c.document} · {c.usualChannel}</small>
                    </button>
                  ))}
                  {!filteredCustomers.length && <span className="empty-hint">Sin resultados. Crea el cliente desde la sección Clientes.</span>}
                  <button type="button" className="close-picker" onClick={() => setShowCustomerPicker(false)}>Cerrar</button>
                </div>
              )}
            </div>
            {!readOnly && missingCustomer && <small className="line-stock-error">Elegí un cliente en el buscador de arriba — una cotización sin cliente no se puede guardar. "Cliente de mostrador" no cuenta.</small>}
            {value.customerId && <SaldoBadge clienteId={value.customerId} />}
          </label>
          <label>Vigencia<input type="date" disabled={readOnly} value={value.validUntil} onChange={(e) => setValue((v) => ({ ...v, validUntil: e.target.value }))} /></label>
          <label>Fecha<input type="date" disabled={readOnly} value={value.documentDate ?? ''} onChange={(e) => setValue((v) => ({ ...v, documentDate: e.target.value || undefined }))} /></label>
          <label>Descuento general (Bs)<NumberField min={0} disabled={readOnly} value={value.generalDiscountCents / 100} onCommit={(bs) => setValue((v) => ({ ...v, generalDiscountCents: Math.round(bs * 100) }))} /></label>
          <label>Condición de pago<select disabled={readOnly} value={value.conditionPago ?? ''} onChange={(e) => setValue((v) => ({ ...v, conditionPago: (e.target.value || undefined) as QuoteDraft['conditionPago'] }))}>
            <option value="">Sin especificar</option>
            <option value="CONTADO">Contado</option>
            <option value="PAGO_PARCIAL">Pago parcial</option>
            <option value="SIGEP">SIGEP</option>
            <option value="TRANSFERENCIA_BANCARIA">Transferencia bancaria</option>
            <option value="QR">QR</option>
          </select></label>
          <label className="full">Asunto<input disabled={readOnly} value={value.asunto ?? ''} onChange={(e) => setValue((v) => ({ ...v, asunto: e.target.value || undefined }))} /></label>
          <label className="full">Condiciones comerciales<input disabled={readOnly} value={value.terms} onChange={(e) => setValue((v) => ({ ...v, terms: e.target.value }))} /></label>
          <label className="full">Observaciones<textarea rows={2} disabled={readOnly} value={value.notes} onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))} /></label>
        </div>

        {!readOnly && (
          <div className="line-add-controls">
            <ProductQuickAdd
              value={productQuery}
              onValueChange={setProductQuery}
              results={productResults}
              loading={productLoading}
              chips={value.lines.filter((l) => !l.isCustomItem && l.productId).map((l) => ({ productId: Number(l.productId), nombre: l.name, cantidad: l.quantity }))}
              priceFor={(p) => formatMoney(money(Math.round(priceForChannel(p, value.channel) * 100)))}
              onAdd={addCatalogProduct}
              onRemoveChip={(productId) => { const line = value.lines.find((l) => l.productId === String(productId) && !l.isCustomItem); if (line) removeLine(line.id) }}
            />
            <input
              placeholder="Escanear código (Enter)"
              value={scanSku}
              onChange={(e) => setScanSku(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanBarcode() } }}
            />
          </div>
        )}

        <div className="editor-lines draft-lines">
          <header><strong>Productos</strong></header>
          {catalogLines.map((line) => {
            const stock = stockByProduct[line.productId]
            const presentations = presentationsByProduct[line.productId] ?? []
            const origin = line.sourceLocation ?? 'Almacén'
            const stockError = lineErrors[line.id]
            const factor = line.factorUnidadBase ?? 1
            const showEquivalence = factor !== 1
            const identifiers = identifiersByProduct[line.productId]
            // TAREA 5 — Almacén-default-with-conditional-Tienda-unlock: Tienda is only
            // selectable here when Almacén's stock does NOT cover this line's requested
            // quantity in base units (a strict "<" comparison, not "=== 0" — see brief).
            // Undetermined stock (not yet loaded) never disables anything, mirroring the
            // existing lineErrors guard above.
            const almacenCovers = stock ? stock.almacen >= cantidadBaseFor({ cantidad: line.quantity, ubicacion: origin, factorUnidadBase: line.factorUnidadBase }) : false
            const originOptions = buildOriginOptions(stock, almacenCovers ? { Tienda: 'Almacén cubre esta línea' } : undefined)
            return (
              <div
                key={line.id}
                className={`draft-line-row presentation-line-row ${stockError ? 'has-stock-error' : ''}`}
                onClick={() => !readOnly && setEditLineModalId(line.id)}
                onKeyDown={(e) => { if (!readOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditLineModalId(line.id) } }}
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? undefined : 0}
              >
                <div className="draft-line-top">
                  <div className="dl-r1">
                    <span className="dl-nombre" title={line.name}>{line.name}</span>
                    <div className="qty-control" onClick={(e) => e.stopPropagation()}>
                      <button type="button" aria-label={`Restar cantidad ${line.name}`} disabled={readOnly || line.quantity <= 1} onClick={() => updateLine(line.id, { quantity: Math.max(1, line.quantity - 1) })}><Minus /></button>
                      <NumberField
                        className="qty-field"
                        ariaLabel={`Cantidad ${line.name}`}
                        value={line.quantity}
                        min={1}
                        allowDecimals={false}
                        disabled={readOnly}
                        selectOnFocus
                        onCommit={(quantity) => updateLine(line.id, { quantity })}
                      />
                      <button type="button" aria-label={`Sumar cantidad ${line.name}`} disabled={readOnly} onClick={() => updateLine(line.id, { quantity: line.quantity + 1 })}><Plus /></button>
                    </div>
                    {presentations.length > 0 && (
                      <select
                        className="select-skin"
                        aria-label={`Presentación ${line.name}`}
                        disabled={readOnly}
                        onClick={(e) => e.stopPropagation()}
                        value={line.presentacionId ?? presentations.find((p) => p.esBase)?.id ?? presentations[0]?.id}
                        onChange={(e) => {
                          const chosen = presentations.find((p) => p.id === Number(e.target.value))
                          if (chosen) onPresentationChange(line, chosen)
                        }}
                      >
                        {presentations.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="dl-r2">
                    <span className="dl-meta">
                      {line.maskName && <span className="dl-mask-note">Imprime: {line.maskName} · </span>}
                      {[line.sku, identifiers?.barra].filter(Boolean).join(' · ')}
                      {' · '}
                      <span className="price-cell">
                        Bs {(line.unitPriceCents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} c/u{line.discountBasisPoints > 0 && ` −${(line.discountBasisPoints / 100).toFixed(1)}%`}{line.priceOverridden && <small className="overridden-badge">editado</small>}
                      </span>
                      {showEquivalence && <> · <span className="dl-equiv">{fmtQty(line.quantity * factor)} u</span></>}
                      {' · '}<span className="dl-origen-label">{origin}</span>
                    </span>
                    <strong className="dl-total">{formatMoney(money(lineTotalCents(line)))}</strong>
                    {!readOnly && (
                      <button type="button" className="edit-line-trigger" aria-label={`Editar ${line.name}`} onClick={(e) => { e.stopPropagation(); setEditLineModalId(line.id) }}><Pencil /></button>
                    )}
                    {!readOnly && <button type="button" aria-label={`Quitar ${line.name}`} onClick={(e) => { e.stopPropagation(); removeLine(line.id) }}><X /></button>}
                  </div>
                </div>
                {stockError && <small className="line-stock-error">{stockError}</small>}
                {editLineModalId === line.id && (
                  // Modal se porta con createPortal fuera del DOM de esta fila, pero React
                  // sigue burbujeando el evento por el árbol de React (no el del DOM) — sin
                  // este stopPropagation, cualquier clic adentro (incluido "Cancelar") vuelve
                  // a disparar el onClick de la fila y reabre el modal en el mismo tick.
                  <div onClick={(e) => e.stopPropagation()}>
                    <EditQuoteLineModal
                      line={line}
                      presentations={presentations}
                      stock={stock}
                      identifiers={identifiers}
                      basePriceCents={basePriceCentsByLine[line.id] ?? line.unitPriceCents}
                      originOptions={originOptions}
                      actorId={actorId}
                      onClose={() => setEditLineModalId(null)}
                      onSave={(patch) => updateLine(line.id, patch)}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {!catalogLines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Sin productos de catálogo.</div>}
        </div>

        <div className="editor-lines draft-lines custom-lines">
          <header><strong>Ítems especiales / a pedido</strong>{!readOnly && <button type="button" onClick={openNewCustomModal}><Plus /> Agregar ítem a pedido</button>}</header>
          {customLines.map((line) => (
            <div key={line.id} className="draft-line-row custom-line-row">
              <div className="dl-r1">
                <span className="dl-nombre" title={line.name}>{line.name}</span>
                {!readOnly && <button type="button" className="edit-link" onClick={() => openEditCustomModal(line)}><Pencil /> Editar</button>}
              </div>
              <div className="dl-r2">
                <span className="dl-meta">
                  <small className="dl-badge">A pedido</small>
                  Bs {(line.unitPriceCents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} c/u
                  {line.note && ` · ${line.note}`}
                </span>
                <strong className="dl-total">{formatMoney(money(lineTotalCents(line)))}</strong>
                {!readOnly && <button type="button" aria-label={`Quitar ${line.name}`} onClick={() => removeLine(line.id)}><X /></button>}
              </div>
            </div>
          ))}
          {!customLines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Sin ítems especiales.</div>}
        </div>

        <div className="totals-footer">
          <div><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          <div><span>Descuento general</span><strong>-{formatMoney(money(value.generalDiscountCents))}</strong></div>
          <div className="total"><span>Total</span><strong>{formatMoney(money(totalCents))}</strong></div>
        </div>
        {/* TAREA 3 (T1): una cotización es un borrador de trabajo — puede tener líneas sin
            stock (se asume que la mercadería se compra para surtirlas). El aviso ya no
            bloquea, solo informa; el bloqueo real sigue en "Convertir a pedido"/"Crear
            pedido", que sí necesitan stock real antes de reservarlo. */}
        {hasStockErrors && <div className="stock-block-notice">{Object.keys(lineErrors).length} línea{Object.keys(lineErrors).length === 1 ? '' : 's'} sin stock suficiente. Se pueden cotizar; para convertir a pedido hay que resolverlas.</div>}
        {/* TAREA 5: si el cliente elegido requiere cotización de origen, mejor prevenirlo
            que solo mostrar el error después de que la base lo rechace. */}
        {requiereCotizacion && !isExistingQuote && (
          <div className="stock-block-notice">
            {selectedCustomer?.name} requiere una cotización de origen para tener pedido — guardá esto como cotización y convertila después, no se puede crear el pedido directo.
          </div>
        )}
        {saveError && <div className="field-error"><p>{saveError}</p></div>}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        {!readOnly && <button className="secondary-button" disabled={!value.lines.length || saving || missingCustomer} title={missingCustomer ? 'Elegí un cliente para guardar' : undefined} onClick={() => void runAction(onSave)}>Guardar como cotización</button>}
        {/* Ronda 5 — TAREA 1: which conversion action shows depends on WHERE this editor
            was opened from, not on the form's current state. Editing an existing
            cotización (isExistingQuote) → only "Convertir a pedido" is offered, since
            that cotización already exists and creating a separate, unlinked pedido
            alongside it would leave the cotización a "zombie" nobody knows is still
            live. Starting fresh (a brand-new draft or a cart handoff, no cotización of
            origin) → only "Crear pedido" is offered, since there is nothing to convert.
            "Convertir a pedido" additionally still requires draft/approved status —
            CONVERTIDA/VENCIDA/ANULADA correctly show neither (this guard already
            existed and was verified to already block reconversion of a CONVERTIDA
            quote, not a new restriction added here). */}
        {!readOnly && !isExistingQuote && onCreateOrder && (
          <button
            className="primary-button"
            disabled={!value.lines.length || saving || hasStockErrors || requiereCotizacion}
            title={requiereCotizacion ? `${selectedCustomer?.name} requiere una cotización de origen — usá "Guardar como cotización"` : undefined}
            onClick={() => void runAction(onCreateOrder)}
          >
            Crear pedido
          </button>
        )}
        {isExistingQuote && onConvert && (value.status === 'draft' || value.status === 'approved') && <button className="primary-button" disabled={saving || hasStockErrors || missingCustomer} title={missingCustomer ? 'Elegí un cliente para convertir' : undefined} onClick={() => void runAction(onConvert)}>Convertir a pedido</button>}
      </footer>
      {customModalOpen && (
        <CustomItemModal
          form={customModalForm}
          setForm={setCustomModalForm}
          editing={Boolean(customModalEditingId)}
          addAnother={customModalAddAnother}
          setAddAnother={setCustomModalAddAnother}
          count={customModalCount}
          descripcionRef={customModalDescripcionRef}
          onClose={closeCustomModal}
          onConfirm={confirmCustomModal}
        />
      )}
    </Modal>
  )
}

// TAREA 4 — plain centered modal (reuses the shared Modal component) with real,
// spaced-out fields, replacing the old cramped four-input inline row. "Agregar
// otro ítem" keeps the modal open, resets the form, refocuses descripción, and
// bumps the running "N ítems agregados" counter — all scoped to this one
// continuous open-modal session (reset whenever the modal is freshly opened).
function CustomItemModal({ form, setForm, editing, addAnother, setAddAnother, count, descripcionRef, onClose, onConfirm }: {
  form: { descripcion: string; cantidad: number; precio: number; nota: string }
  setForm: (updater: (prev: { descripcion: string; cantidad: number; precio: number; nota: string }) => { descripcion: string; cantidad: number; precio: number; nota: string }) => void
  editing: boolean
  addAnother: boolean
  setAddAnother: (value: boolean) => void
  count: number
  descripcionRef: RefObject<HTMLInputElement | null>
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title={editing ? 'Editar ítem a pedido' : 'Agregar ítem a pedido'} onClose={onClose}>
      <div className="modal-body custom-item-modal">
        <div className="form-grid">
          <label className="full">Descripción<input ref={descripcionRef} autoFocus value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} /></label>
          <label>Cantidad<NumberField min={1} allowDecimals={false} value={form.cantidad} onCommit={(cantidad) => setForm((f) => ({ ...f, cantidad }))} /></label>
          <label>Precio unitario (Bs)<NumberField min={0} value={form.precio} onCommit={(precio) => setForm((f) => ({ ...f, precio }))} /></label>
          <label className="full">Nota<input placeholder="Ej. comprar a proveedor X" value={form.nota} onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))} /></label>
        </div>
        {!editing && count > 0 && <p className="custom-modal-counter">{count} ítem{count > 1 ? 's' : ''} agregado{count > 1 ? 's' : ''}</p>}
      </div>
      <footer className="modal-actions">
        {!editing && (
          <label className="custom-modal-add-another">
            <input type="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} /> Agregar otro ítem
          </label>
        )}
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={!form.descripcion.trim()} onClick={onConfirm}>{editing ? 'Guardar cambios' : 'Agregar'}</button>
      </footer>
    </Modal>
  )
}

