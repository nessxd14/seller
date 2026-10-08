import { AlertTriangle, ArrowRight, Barcode, Briefcase, Building2, Check, FileText, LoaderCircle, Minus, Package, Pencil, Plus, Save, UserRound, Warehouse, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { QuoteDraft, WorkflowLine } from '../../application/shared/models'
import type { CustomerRecord } from '../../application/shared/models'
import { customerService, productRepository, getStockByProduct, getDisponibilidadPedido, listPresentations, listLineIdentifiers, authSessionProvider } from '../../infrastructure/services'
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
import { formatQtyWithUnit, normalizeUnit } from '../../domain/sales/unitOfMeasure'
import { UnitOfMeasureField } from '../../components/UnitOfMeasureField'
import { requiereCotizacionOrigen } from '../../domain/quotations/requiereCotizacionOrigen'
import { calcularFaltantes, resumenPorComprar, type DisponibilidadMap } from '../../domain/quotations/faltantes'
import { ProductQuickAdd } from '../../components/ProductQuickAdd'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { cleanProductQuery } from '../../domain/catalog/productSearch'
import { AutoriaBadge } from '../../components/AutoriaBadge'
import { SolicitanteField } from '../../components/SolicitanteField'
import { evaluarTope } from '../../infrastructure/supabase/ContactoCliente.supabase'
import { evaluarCredito } from '../../infrastructure/hermes/client'
import { precioSugerido as fetchPrecioSugerido, type PrecioSugerido } from '../../infrastructure/supabase/PreciosRepository.supabase'
import { channelToCategoria } from '../../infrastructure/supabase/mappers'
import { PrecioSugeridoHint } from './PrecioSugeridoHint'

type EditableChannel = QuoteDraft['channel']

const channelTabs: { id: EditableChannel; label: string; icon: typeof Warehouse }[] = [
  { id: 'mayoreo', label: 'Mayoreo', icon: Warehouse },
  { id: 'institucional', label: 'Institucional', icon: Building2 },
  { id: 'corporativo', label: 'Corporativo', icon: Briefcase },
]

const priceForChannel = (product: Product, channel: EditableChannel) =>
  channel === 'mayoreo' ? product.precioMayoreo : channel === 'institucional' ? product.precioInstitucional : product.precioCorporativo

const defaultSourceForChannel = (): 'Tienda' | 'Almacén' => 'Almacén' // MAYOR/INST/CORPORATIVO all default to Almacén

const lineTotalCents = (line: WorkflowLine) => Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000)

type LinePresentation = { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }
type LineStock = { tienda: number; almacen: number }

const fmtQty = (n: number) => n.toLocaleString('es-BO')
type EditorAction = (quote: QuoteDraft) => void | false | Promise<void | false>

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
  onSave: EditorAction
  onCreateOrder?: EditorAction
  onConvert?: EditorAction
}) {
  const [value, setValue] = useState<QuoteDraft>(() => structuredClone(quote))
  const readOnly = value.status !== 'draft' && value.id !== ''
  const [customerQuery, setCustomerQuery] = useState('')
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [scanSku, setScanSku] = useState('')
  const [scanError, setScanError] = useState('')
  const [scanning, setScanning] = useState(false)
  const scanPendingRef = useRef(false)
  const [ambiguousIds, setAmbiguousIds] = useState<number[] | null>(null)
  const [productSearchError, setProductSearchError] = useState('')
  // TAREA T1 (T1): reemplaza PricePopover/MaskPopover — un solo modal completo por línea,
  // fuera del overflow:auto del .modal ancestro (esa era la causa raíz del recorte).
  const [editLineModalId, setEditLineModalId] = useState<string | null>(null)
  const [actorId, setActorId] = useState('pos')
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  const [saveError, setSaveError] = useState('')
  // Brief S-G: aviso ámbar, no bloqueo — evaluar_tope ya arma el texto (motivo_advertencia),
  // se muestra tal cual. null = dentro del tope o nada que evaluar (sin solicitante todavía).
  const [topeWarning, setTopeWarning] = useState<string | null>(null)
  const [creditoWarning, setCreditoWarning] = useState<string | null>(null)
  // Cada documento tiene su propio borrador; una copia no restaura el original.
  const draftScope = isExistingQuote ? `cotizacion:${quote.id}` : 'cotizacion:nueva'
  const { borradorPendiente, descartar: descartarBorrador, limpiar: limpiarBorrador } = useBorrador(borradorKey(draftScope, actorId), value, { activo: !readOnly })
  const canRestoreDraft = !readOnly && borradorPendiente && (!isExistingQuote || borradorPendiente.datos.id === quote.id)
  const retomarBorrador = () => {
    if (!canRestoreDraft) return
    setValue({
      ...borradorPendiente.datos,
      // Las decisiones de compra dependen del stock de este momento: no se restauran.
      lines: borradorPendiente.datos.lines.map((line) => ({ ...line, comprarFaltante: undefined, cantidadPorComprar: undefined })),
      id: quote.id, number: quote.number, status: quote.status,
      createdAt: quote.createdAt, creadoPor: quote.creadoPor,
      // Conservar la versión del borrador existente para detectar ediciones posteriores.
      version: isExistingQuote ? borradorPendiente.datos.version : undefined,
    })
    limpiarBorrador()
  }
  // Item 2/3: per-productId caches so stock + presentations are fetched once (on add), not
  // on every render or toggle interaction.
  const [stockByProduct, setStockByProduct] = useState<Record<string, LineStock>>({})
  // Brief S-PC: disponibilidad para pedido (Almacén + Tienda − reservas) por productId, en
  // unidades base. `disponibilidadKey` recuerda para qué conjunto de ids se cargó por última vez.
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadMap>({})
  const [disponibilidadKey, setDisponibilidadKey] = useState('')
  const [presentationsByProduct, setPresentationsByProduct] = useState<Record<string, LinePresentation[]>>({})
  // Base (per-base-unit) price captured at add-time, used to suggest a price when the
  // presentation changes; keyed by line id so overrides via PricePopover aren't disturbed.
  const [basePriceCentsByLine, setBasePriceCentsByLine] = useState<Record<string, number>>({})
  // Brief B (precio sugerido): último precio cobrado a este cliente + mediana de la
  // categoría, por línea. Cacheado por (productId, clienteId, categoria, presentacionId)
  // durante la vida del editor — mismo criterio que presentationsByProduct de arriba.
  const [precioSugeridoByLine, setPrecioSugeridoByLine] = useState<Record<string, PrecioSugerido | null>>({})
  const precioSugeridoCacheRef = useRef<Map<string, Promise<PrecioSugerido>>>(new Map())
  // Item 2.2: barra/fábrica/marca, batch-fetched per productId set so a multi-line
  // quote/order doesn't trigger an identifier lookup per line render.
  const [identifiersByProduct, setIdentifiersByProduct] = useState<Record<string, LineIdentifiers>>({})

  // TAREA 4 — custom/personalizado item capture modal state. `customModalForm` holds
  // the in-progress (not-yet-confirmed) form fields; cancelling only discards THIS,
  // never items already committed to value.lines via a previous "Agregar otro" round.
  const emptyCustomForm = { descripcion: '', cantidad: 1, precio: 0, nota: '', unidadMedida: 'UNIDAD' }
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
    const requestId = ++productSearchIdRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia los resultados en cuanto el término queda vacío, sin esperar al debounce de abajo
    setProductSearchError('')
    if (!productQuery.trim()) { setProductResults([]); setProductLoading(false); return }
    setProductLoading(true)
    const handle = setTimeout(() => {
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 100 } }).then((page) => {
        if (productSearchIdRef.current === requestId) { setProductResults(page.items); setProductLoading(false) }
      }).catch(() => { if (productSearchIdRef.current === requestId) { setProductResults([]); setProductLoading(false); setProductSearchError('No se pudo buscar. Intenta nuevamente.') } })
    }, 250)
    return () => { clearTimeout(handle); productSearchIdRef.current += 1 }
  }, [productQuery])

  // Brief T2 Tarea 3 (único cambio permitido acá al buscador de clientes): normalización
  // sin acentos/mayúsculas — "jose perez" tiene que encontrar "José Pérez".
  const filteredCustomers = useMemo(
    () => customers.filter((c) => coincideBusqueda(`${c.name} ${c.document} ${c.email}`, customerQuery)).slice(0, 8),
    [customers, customerQuery]
  )

  const subtotalCents = value.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)
  const totalCents = Math.max(0, subtotalCents - value.generalDiscountCents)

  // Brief S-G: se recalcula cada vez que cambia el solicitante o el total (se agregan/sacan
  // líneas, cambia el descuento) — no solo una vez al abrir el formulario. Debounce corto
  // (mismo patrón 300ms que ya usan CustomerPicker/SolicitanteField) para no disparar una
  // llamada por cada línea tocada en una edición rápida.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia el aviso al instante cuando cambia el cliente/solicitante (Ej. se deselecciona), sin esperar al debounce de abajo
    if (!featureFlags.supabase || !value.customerId || !value.solicitanteId) { setTopeWarning(null); return }
    const customerId = value.customerId
    const solicitanteId = value.solicitanteId
    let cancelled = false
    const handle = setTimeout(() => {
      void evaluarTope(customerId, solicitanteId, totalCents)
        .then((resultado) => { if (!cancelled) setTopeWarning(resultado.dentroDelTope ? null : resultado.motivoAdvertencia) })
        .catch(() => { if (!cancelled) setTopeWarning(null) })
    }, 350)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [value.customerId, value.solicitanteId, totalCents])

  // Tanda 3: mismo mecanismo que evalúaTope arriba — solo advertencia, nunca bloquea el
  // submit (evaluar_credito_pos no tiene forma de gatear crear_pedido sin cruzar la
  // frontera Cation/Hermes). Solo aplica a ventas a crédito: al contado no hay límite que
  // evaluar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia el aviso al instante al cambiar cliente/condición de pago, sin esperar al debounce de abajo
    if (!featureFlags.supabase || !value.customerId || value.conditionPago !== 'CREDITO' || totalCents <= 0) { setCreditoWarning(null); return }
    const customerId = value.customerId
    let cancelled = false
    const handle = setTimeout(() => {
      void evaluarCredito(Number(customerId), totalCents)
        .then((resultado) => { if (!cancelled) setCreditoWarning(resultado.estado === 'ok' && !resultado.permitido ? resultado.motivoAdvertencia : null) })
        .catch(() => { if (!cancelled) setCreditoWarning(null) })
    }, 350)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [value.customerId, value.conditionPago, totalCents])

  const setChannel = (channel: EditableChannel) => setValue((v) => ({ ...v, channel }))

  const pickCustomer = (customer: CustomerRecord) => {
    setValue((v) => ({
      ...v,
      customerId: customer.id,
      customerName: customer.name,
      channel: (customer.usualChannel === 'mayoreo' || customer.usualChannel === 'institucional' || customer.usualChannel === 'corporativo') ? customer.usualChannel : v.channel,
      // Brief S-C: un solicitante de la institución anterior no es válido para la nueva
      // (la base lo rechazaría igual, pero mejor no dejar que se intente).
      solicitanteId: v.customerId === customer.id ? v.solicitanteId : undefined,
      solicitanteNombre: v.customerId === customer.id ? v.solicitanteNombre : undefined,
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
    const code = cleanProductQuery(scanSku)
    if (!code || scanPendingRef.current) return
    scanPendingRef.current = true; setScanning(true); setScanError('')
    try {
      const result = await productRepository.resolveScannedCode(code)
      if (result.kind === 'found') { addCatalogProduct(result.product); setScanSku('') }
      else if (result.kind === 'ambiguous') setAmbiguousIds(result.productIds)
      else setScanError(`No encontramos el código ${code}. Revisa el SKU o código de barras.`)
    } catch { setScanError('No se pudo consultar el código. Intenta nuevamente.') }
    finally { scanPendingRef.current = false; setScanning(false) }
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
    setCustomModalForm({ descripcion: line.name, cantidad: line.quantity, precio: line.unitPriceCents / 100, nota: line.note ?? '', unidadMedida: line.unitOfMeasure ?? '' })
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
        // Fila histórica sin unidad: si el campo sigue vacío no se inventa 'UNIDAD'.
        unitOfMeasure: customModalForm.unidadMedida.trim() ? normalizeUnit(customModalForm.unidadMedida) : undefined,
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
      unitOfMeasure: normalizeUnit(customModalForm.unidadMedida),
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
    void listLineIdentifiers(missing).then((result) => setIdentifiersByProduct((prev) => ({
      ...prev, ...Object.fromEntries(missing.map((id) => [id, result[id] ?? {}])),
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogLines])

  // Brief B: se dispara cuando se agrega una línea o cambia su presentación, y el
  // borrador tiene cliente y/o categoría — debounce 250ms, cacheado por línea de arriba.
  // Nunca bloquea el guardado ni muestra toast: un error de la RPC solo se loguea.
  useEffect(() => {
    if (!featureFlags.supabase || readOnly) return
    const categoria = channelToCategoria(value.channel)
    const clienteId = value.customerId ? Number(value.customerId) : undefined
    const handle = setTimeout(() => {
      catalogLines.forEach((line) => {
        const productId = Number(line.productId)
        if (!Number.isFinite(productId)) return
        const cacheKey = `${productId}:${clienteId ?? ''}:${categoria}:${line.presentacionId ?? ''}`
        const cache = precioSugeridoCacheRef.current
        let promise = cache.get(cacheKey)
        if (!promise) {
          promise = fetchPrecioSugerido(productId, { clienteId, categoria, presentacionId: line.presentacionId })
          cache.set(cacheKey, promise)
        }
        promise
          .then((result) => setPrecioSugeridoByLine((prev) => ({ ...prev, [line.id]: result })))
          .catch((err) => { cache.delete(cacheKey); console.error('precio_sugerido falló', err) })
      })
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogLines identity changes every render; keyed manually below to avoid re-firing on unrelated line edits
  }, [catalogLines.map((l) => `${l.id}:${l.productId}:${l.presentacionId ?? ''}`).join('|'), value.customerId, value.channel, readOnly])

  const applySuggestedPrice = (lineId: string, precioBs: number) => {
    const line = value.lines.find((l) => l.id === lineId)
    const unitPriceCents = Math.round(precioBs * 100)
    updateLine(lineId, { unitPriceCents, priceOverridden: unitPriceCents !== (line?.listPriceCents ?? unitPriceCents) })
  }

  // Brief S-PC: disponibilidad (Almacén + Tienda − reservas de pedidos abiertos) de los
  // productos del documento; se vuelve a pedir cuando cambia el conjunto de productos. Las
  // cifras por sucursal (stockByProduct) se siguen mostrando aparte.
  const catalogProductIds = Array.from(new Set(catalogLines.map((line) => Number(line.productId)).filter((id) => Number.isFinite(id) && id > 0))).sort((a, b) => a - b)
  const catalogIdsKey = catalogProductIds.join(',')
  useEffect(() => {
    let cancelled = false
    void getDisponibilidadPedido(catalogProductIds)
      .then((result) => { if (!cancelled) { setDisponibilidad(result); setDisponibilidadKey(catalogIdsKey) } })
      // Sin dato no se inventa faltante; el chequeo al enviar vuelve a pedirlo y falla a la vista.
      .catch(() => { if (!cancelled) { setDisponibilidad({}); setDisponibilidadKey(catalogIdsKey) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogProductIds se deriva de catalogIdsKey
  }, [catalogIdsKey])
  const disponibilidadCargando = disponibilidadKey !== catalogIdsKey

  // Brief S-PC: faltante por línea (saldo corrido por producto, en unidades base).
  const faltantes = useMemo(() => calcularFaltantes(value.lines, disponibilidad), [value.lines, disponibilidad])
  const faltantesSinDecidir = catalogLines.filter((line) => (faltantes[line.id]?.faltante ?? 0) > 0 && !line.comprarFaltante)
  const resumen = useMemo(() => resumenPorComprar(value.lines, faltantes), [value.lines, faltantes])

  // Una línea que ya no tiene faltante (bajó la cantidad, cambió la disponibilidad) deja de
  // estar "decidida": si el faltante vuelve a aparecer hay que decidir de nuevo.
  const idsDecididasSinFaltante = value.lines.filter((line) => line.comprarFaltante && faltantes[line.id] && faltantes[line.id].faltante === 0).map((line) => line.id).join(',')
  useEffect(() => {
    if (!idsDecididasSinFaltante) return
    const ids = new Set(idsDecididasSinFaltante.split(','))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- normaliza la decisión cuando el faltante desaparece
    setValue((v) => ({ ...v, lines: v.lines.map((line) => (ids.has(line.id) ? { ...line, comprarFaltante: false } : line)) }))
  }, [idsDecididasSinFaltante])

  const comprarTodosLosFaltantes = () => {
    const ids = new Set(faltantesSinDecidir.map((line) => line.id))
    setValue((v) => ({ ...v, lines: v.lines.map((line) => (ids.has(line.id) ? { ...line, comprarFaltante: true } : line)) }))
  }

  const confirmacionCompras = (items: typeof resumen) =>
    `Se van a mandar a Compras: ${items.map((item) => item.esPersonalizado ? `${item.name} (${fmtQty(item.cantidad)}, a pedido)` : `${item.name} (${fmtQty(item.faltante)} de ${fmtQty(item.baseQty)})`).join('; ')}. ¿Continuar?`
  // TAREA 3 (Ronda 9): cliente obligatorio para guardar/convertir una cotización.
  // "Cliente de mostrador" (customerId vacío) no cuenta — es UI-only, no toca la base
  // (8 cotizaciones viejas sin cliente siguen abriéndose porque esto solo bloquea el
  // guardado, no la carga).
  const missingCustomer = !value.customerId
  // Condición de pago obligatoria: mismo criterio que cliente — bloquea guardar,
  // crear pedido y convertir, no la carga de cotizaciones viejas sin este dato.
  const missingConditionPago = !value.conditionPago

  // Brief T7 Tarea 5: la base rechaza crear un pedido directo (sin cotización de origen)
  // para clientes institucion/corporativo/mayorista — mejor prevenirlo que solo mostrar el
  // error después. "Cliente de mostrador" (customerId vacío) nunca lo requiere: el trigger
  // ya deja pasar cliente_id null.
  const selectedCustomer = customers.find((c) => c.id === value.customerId)
  const requiereCotizacion = requiereCotizacionOrigen(selectedCustomer?.type)

  // Brief S-C: el solicitante es obligatorio para pedidos de clientes institucionales o
  // corporativos (reforzado en la base, hoy temporalmente desactivado — ver brief). Este
  // mismo editor sirve tanto para guardar como cotización (nunca bloqueado por esto) como
  // para crear/convertir a pedido (sí bloqueado): missingSolicitante solo gatea esos
  // botones, nunca "Guardar como cotización".
  const requiereSolicitante = selectedCustomer?.type === 'institutional' || selectedCustomer?.type === 'corporate'
  const missingSolicitante = requiereSolicitante && !value.solicitanteId

  const runAction = async (action: EditorAction) => {
    // Candado síncrono: `disabled={saving}` recién surte efecto en el próximo repintado,
    // así que un doble clic/toque muy rápido (terminal táctil, conexión lenta) puede
    // disparar runAction dos veces antes de que el DOM se actualice. El ref corta la
    // segunda llamada en el mismo tick.
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setSaveError('')
    try {
      const result = await action(value)
      if (result !== false) limpiarBorrador()
    } catch (err) {
      // TAREA 5: el mensaje del trigger ("Los pedidos de clientes X requieren...") se
      // muestra tal cual, nunca reemplazado por uno genérico.
      setSaveError(err && typeof err === 'object' && 'message' in err ? String(err.message) : 'No se pudo completar la acción')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  // Brief S-PC: crear pedido / convertir. Antes de enviar se vuelve a leer la disponibilidad
  // (pudo cambiar mientras se armaba el pedido), se confirma lo que va a Compras y cada línea
  // lleva su cantidadPorComprar (unidades base) hacia crear_pedido / convertir_cotizacion_a_pedido.
  const runOrderAction = (action: EditorAction) => runAction(async (current) => {
    const fresh = await getDisponibilidadPedido(catalogProductIds)
    setDisponibilidad(fresh)
    setDisponibilidadKey(catalogIdsKey)
    const nuevosFaltantes = calcularFaltantes(current.lines, fresh)
    if (current.lines.some((line) => !line.isCustomItem && (nuevosFaltantes[line.id]?.faltante ?? 0) > 0 && !line.comprarFaltante)) {
      throw new Error('El stock cambió mientras armabas el pedido. Revisá las líneas marcadas.')
    }
    const items = resumenPorComprar(current.lines, nuevosFaltantes)
    if (items.length > 0 && !confirm(confirmacionCompras(items))) return false
    return action({
      ...current,
      lines: current.lines.map((line) => {
        const faltante = !line.isCustomItem && line.comprarFaltante ? (nuevosFaltantes[line.id]?.faltante ?? 0) : 0
        return { ...line, comprarFaltante: line.comprarFaltante, cantidadPorComprar: faltante }
      }),
    })
  })

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
    <Modal title={isExistingQuote ? `Cotización ${value.number || value.id}` : 'Nueva cotización / pedido'} subtitle={readOnly ? 'Consulta los datos y productos del documento.' : 'Prepara la propuesta y elige cómo continuar.'} onClose={() => { if (!submittingRef.current) onClose() }} wide escapeToClose={!saving && !customModalOpen && !editLineModalId} className="commercial-modal document-editor-modal">
      <div className="modal-body quote-editor draft-order-editor" inert={saving} aria-busy={saving}>
        {canRestoreDraft && <BorradorBanner guardadoEn={borradorPendiente.guardadoEn} onRetomar={retomarBorrador} onDescartar={descartarBorrador} />}
        {/* Brief S3 Parte B: autoría — quién creó la cotización. */}
        {value.creadoPor && <div className="autoria-row"><AutoriaBadge label="Creado por" email={value.creadoPor} /></div>}
        {/* Brief S-C: en solo-lectura el picker no se muestra (nada que editar) — el
            nombre congelado (solicitado_por) se muestra tal cual, sin volver a consultar
            cliente_contacto. */}
        {readOnly && value.solicitanteNombre && <div className="autoria-row"><span>Solicitante: {value.solicitanteNombre}</span></div>}
        <div className="document-editor-layout">
        <div className="document-editor-main">
        <section className="commercial-section customer-section">
          <div className="commercial-section-heading"><span className="section-icon"><UserRound /></span><div><h3>Cliente y canal</h3><p>Define a quién va dirigida la propuesta.</p></div><span className="section-step">01</span></div>
        <div className="channel-tabs draft-order-tabs" aria-label="Canal comercial">
          {channelTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={value.channel === id} disabled={readOnly} className={value.channel === id ? 'active' : ''} onClick={() => setChannel(id)}>
              <Icon /><span>{label}</span>
            </button>
          ))}
        </div>

        <div className="form-grid">
          <div className="full commercial-field">
            <label htmlFor="document-customer">Cliente <span className="required-mark">*</span></label>
            <div className="customer-search">
              <input
                id="document-customer"
                autoComplete="off"
                aria-expanded={showCustomerPicker && !readOnly}
                aria-controls={showCustomerPicker && !readOnly ? 'document-customer-results' : undefined}
                value={showCustomerPicker ? customerQuery : value.customerName}
                disabled={readOnly}
                placeholder="Buscar cliente por nombre, documento o correo..."
                onFocus={() => setShowCustomerPicker(true)}
                onBlur={(e) => { if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) { setShowCustomerPicker(false); setCustomerQuery('') } }}
                onKeyDown={(e) => { if (e.key === 'Escape' && showCustomerPicker) { e.preventDefault(); setShowCustomerPicker(false); setCustomerQuery('') } }}
                onChange={(e) => { setCustomerQuery(e.target.value); setShowCustomerPicker(true) }}
              />
              {showCustomerPicker && !readOnly && (
                <div className="customer-search-results" id="document-customer-results">
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
            {!readOnly && missingCustomer && <small className="field-hint">Selecciona un cliente de la lista para asociar el documento.</small>}
            {value.customerId && <SaldoBadge clienteId={value.customerId} />}
          </div>
          {/* Brief S-C: solo aparece para clientes institucionales/corporativos — para
              mayorista/retail no ocupa espacio, no queda oculto-pero-deshabilitado. */}
          {!readOnly && featureFlags.supabase && value.customerId && requiereSolicitante && (
            <SolicitanteField
              key={value.customerId}
              clienteId={value.customerId}
              value={value.solicitanteId ? { id: value.solicitanteId, nombre: value.solicitanteNombre ?? '' } : null}
              onChange={(solicitante) => setValue((v) => v.customerId === value.customerId ? { ...v, solicitanteId: solicitante?.id, solicitanteNombre: solicitante?.nombre } : v)}
              required={missingSolicitante}
              actorId={actorId}
            />
          )}
          {/* Brief S-G: aviso, no bloqueo — nunca gatea "Guardar"/"Crear pedido"/"Convertir".
              motivo_advertencia se muestra tal cual, sin reescribirlo. */}
          {topeWarning && <div className="full tope-warning-banner" role="status"><AlertTriangle size={14} /><span>{topeWarning}</span></div>}
          {creditoWarning && <div className="full tope-warning-banner" role="status"><AlertTriangle size={14} /><span>{creditoWarning}</span></div>}
        </div>
        </section>
        <section className="commercial-section document-products-section">
        <div className="commercial-section-heading"><span className="section-icon"><Package /></span><div><h3>Productos</h3><p>Busca, agrega y ajusta las cantidades.</p></div><span className="section-step">02</span></div>
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
            <label className="document-scan-field"><Barcode /><input
              aria-label="Escanear código"
              placeholder="Código + Enter"
              value={scanSku}
              readOnly={scanning}
              aria-busy={scanning}
              onChange={(e) => { setScanSku(e.target.value); setScanError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanBarcode() } }}
            /></label>
          </div>
        )}
        {scanning && <p className="scan-feedback" role="status">Buscando código…</p>}
        {(scanError || productSearchError) && <p className="scan-feedback error" role="alert">{scanError || productSearchError}</p>}
        <div className="editor-lines draft-lines">
          <header><strong>Detalle del documento</strong><span>{catalogLines.length} producto{catalogLines.length === 1 ? '' : 's'}</span></header>
          {faltantesSinDecidir.length >= 2 && (
            <div className="line-shortage-bulk"><button type="button" onClick={comprarTodosLosFaltantes}>Comprar todos los faltantes</button></div>
          )}
          {catalogLines.map((line) => {
            const stock = stockByProduct[line.productId]
            const presentations = presentationsByProduct[line.productId] ?? []
            const origin = line.sourceLocation ?? 'Almacén'
            const factor = line.factorUnidadBase ?? 1
            const faltanteInfo = faltantes[line.id]
            const faltante = faltanteInfo?.faltante ?? 0
            const decidida = faltante > 0 && line.comprarFaltante === true
            const sinDecidir = faltante > 0 && !decidida
            // "Bajar a X" solo si X es una cantidad entera de la presentación de la línea.
            const bajarQty = faltanteInfo ? faltanteInfo.disponibleParaLinea / factor : 0
            const puedeBajar = !readOnly && faltanteInfo != null && faltanteInfo.disponibleParaLinea > 0 && Number.isInteger(bajarQty) && bajarQty >= 1
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
                className={`draft-line-row presentation-line-row ${sinDecidir ? 'has-stock-error' : ''}`}
                onClick={() => !readOnly && setEditLineModalId(line.id)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && !readOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditLineModalId(line.id) } }}
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
                {!readOnly && <PrecioSugeridoHint sugerido={precioSugeridoByLine[line.id]} unitPriceCents={line.unitPriceCents} onApply={(bs) => applySuggestedPrice(line.id, bs)} />}
                {faltante > 0 && (
                  <div className={`line-shortage ${decidida ? 'decided' : ''}`} onClick={(e) => e.stopPropagation()}>
                    {decidida ? (
                      <>
                        <span className="line-shortage-text">Se compran {fmtQty(faltante)}</span>
                        <button type="button" className="line-shortage-undo" aria-label={`Deshacer compra del faltante ${line.name}`} onClick={() => updateLine(line.id, { comprarFaltante: false })}>Deshacer</button>
                      </>
                    ) : (
                      <>
                        <span className="line-shortage-text">Disponible {fmtQty(faltanteInfo.disponibleParaLinea)} · faltan {fmtQty(faltante)}</span>
                        <button type="button" className="line-shortage-buy" aria-label={`Comprar el faltante ${line.name}`} onClick={() => updateLine(line.id, { comprarFaltante: true })}>Comprar el faltante</button>
                        {puedeBajar && <button type="button" className="line-shortage-lower" aria-label={`Bajar ${line.name} a ${fmtQty(faltanteInfo.disponibleParaLinea)}`} onClick={() => updateLine(line.id, { quantity: bajarQty })}>Bajar a {fmtQty(faltanteInfo.disponibleParaLinea)}</button>}
                      </>
                    )}
                  </div>
                )}
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
                      precioSugerido={precioSugeridoByLine[line.id]}
                      onClose={() => setEditLineModalId(null)}
                      onSave={(patch) => updateLine(line.id, patch)}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {!catalogLines.length && <div className="commercial-empty"><Package /><strong>Tu documento empieza aquí</strong><span>Agrega productos desde el buscador o escanea un código.</span></div>}
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
                  <small className="dl-badge">A pedido · {line.unitOfMeasure ? formatQtyWithUnit(line.quantity, line.unitOfMeasure) : `${fmtQty(line.quantity)} uds.`}</small>
                  Bs {(line.unitPriceCents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} c/u
                  {line.note && ` · ${line.note}`}
                </span>
                <strong className="dl-total">{formatMoney(money(lineTotalCents(line)))}</strong>
                {!readOnly && <button type="button" aria-label={`Quitar ${line.name}`} onClick={() => removeLine(line.id)}><X /></button>}
              </div>
            </div>
          ))}
          {!customLines.length && <div className="custom-items-hint">Para productos personalizados o que debes conseguir por encargo.</div>}
        </div>
        </section>
        <section className="commercial-section">
          <div className="commercial-section-heading"><span className="section-icon"><FileText /></span><div><h3>Detalles del documento</h3><p>Fechas, asunto e indicaciones para el cliente.</p></div><span className="section-step">03</span></div>
          <div className="form-grid">
            <label>Fecha del documento<input type="date" disabled={readOnly} value={value.documentDate ?? ''} onChange={(e) => setValue((v) => ({ ...v, documentDate: e.target.value || undefined }))} /></label>
            <label>Válida hasta<input type="date" disabled={readOnly} value={value.validUntil} onChange={(e) => setValue((v) => ({ ...v, validUntil: e.target.value }))} /></label>
            <label className="full">Asunto <span className="optional-label">Opcional</span><input disabled={readOnly} placeholder="Ej. Material de oficina para septiembre" value={value.asunto ?? ''} onChange={(e) => setValue((v) => ({ ...v, asunto: e.target.value || undefined }))} /></label>
            <label className="full">Condiciones comerciales<input disabled={readOnly} placeholder="Entrega, plazos y condiciones acordadas" value={value.terms} onChange={(e) => setValue((v) => ({ ...v, terms: e.target.value }))} /></label>
            <label className="full">Observaciones <span className="optional-label">Opcional</span><textarea rows={3} disabled={readOnly} placeholder="Agrega indicaciones adicionales…" value={value.notes} onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))} /></label>
          </div>
        </section>
        </div>
        <aside className="document-editor-summary" aria-label="Resumen del documento">
        <div className="document-total-card">
          <span className="summary-eyebrow">RESUMEN DEL DOCUMENTO</span>
          <strong className="document-grand-total">{formatMoney(money(totalCents))}</strong>
          <span>{value.lines.length} ítem{value.lines.length === 1 ? '' : 's'} · {channelTabs.find((channel) => channel.id === value.channel)?.label}</span>
        </div>
        <section className="commercial-section summary-payment">
        <div className="form-grid">
          <label className="full">Condición de pago <span className="required-mark">*</span><select disabled={readOnly} value={value.conditionPago ?? ''} onChange={(e) => setValue((v) => ({ ...v, conditionPago: (e.target.value || undefined) as QuoteDraft['conditionPago'] }))}>
            <option value="">Seleccionar condición</option><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option>
          </select></label>
          <label className="full">Medio de pago <span className="optional-label">Opcional</span><select disabled={readOnly} value={value.medioPago ?? ''} onChange={(e) => setValue((v) => ({ ...v, medioPago: (e.target.value || undefined) as QuoteDraft['medioPago'] }))}>
            <option value="">Seleccionar medio</option><option value="EFECTIVO">Efectivo</option><option value="QR">QR</option><option value="TRANSFERENCIA">Transferencia</option><option value="SIGEP">SIGEP</option><option value="CHEQUE">Cheque</option><option value="DEPOSITO">Depósito</option>
          </select></label>
          <label className="full">Descuento general (Bs)<NumberField min={0} disabled={readOnly} value={value.generalDiscountCents / 100} onCommit={(bs) => setValue((v) => ({ ...v, generalDiscountCents: Math.round(bs * 100) }))} /></label>
        </div>
        <div className="totals-footer">
          <div><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          <div><span>Descuento general</span><strong>-{formatMoney(money(value.generalDiscountCents))}</strong></div>
          <div className="total"><span>Total</span><strong>{formatMoney(money(totalCents))}</strong></div>
        </div>
        </section>
        {!readOnly && <div className="document-checklist" aria-label="Requisitos para guardar">
          <p>Antes de guardar</p>
          <span className={!missingCustomer ? 'complete' : ''}><Check /> Cliente seleccionado</span>
          <span className={value.lines.length ? 'complete' : ''}><Check /> Al menos un producto o ítem</span>
          <span className={!missingConditionPago ? 'complete' : ''}><Check /> Condición de pago definida</span>
        </div>}
        {/* TAREA 3 (T1): una cotización es un borrador de trabajo — puede tener líneas sin
            stock (se asume que la mercadería se compra para surtirlas). El aviso ya no
            bloquea, solo informa; el bloqueo real sigue en "Convertir a pedido"/"Crear
            pedido", que sí necesitan stock real antes de reservarlo. */}
        {faltantesSinDecidir.length > 0 && <div className="stock-block-notice">{faltantesSinDecidir.length} línea{faltantesSinDecidir.length === 1 ? '' : 's'} sin stock suficiente: elegí comprar el faltante, bajar la cantidad o cambiar el producto.</div>}
        {/* TAREA 5: si el cliente elegido requiere cotización de origen, mejor prevenirlo
            que solo mostrar el error después de que la base lo rechace. */}
        {requiereCotizacion && !isExistingQuote && (
          <div className="stock-block-notice">
            {selectedCustomer?.name} requiere una cotización de origen para tener pedido — guardá esto como cotización y convertila después, no se puede crear el pedido directo.
          </div>
        )}
        {resumen.length > 0 && (
          <section className="por-comprar-summary" aria-label="Por comprar">
            <h4>Por comprar</h4>
            <ul>
              {resumen.map((item) => (
                <li key={item.lineId}>
                  {item.esPersonalizado
                    ? <><span>{item.name} · {fmtQty(item.cantidad)}</span><small className="por-comprar-tag">a pedido</small></>
                    : <span>{item.name} · {fmtQty(item.faltante)} de {fmtQty(item.baseQty)}</span>}
                </li>
              ))}
            </ul>
            <footer>{resumen.length} línea{resumen.length === 1 ? '' : 's'} van a Compras</footer>
          </section>
        )}
        {saveError && <div className="field-error" role="alert"><p>{saveError}</p></div>}
        </aside>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button document-cancel" disabled={saving} onClick={onClose}>{readOnly ? 'Cerrar' : 'Cancelar'}</button>
        {!readOnly && <button className="secondary-button" disabled={!value.lines.length || saving || missingCustomer || missingConditionPago} title={missingCustomer ? 'Elegí un cliente para guardar' : missingConditionPago ? 'Elegí una condición de pago para guardar' : undefined} onClick={() => void runAction(onSave)}>{saving ? <LoaderCircle className="spin" /> : <Save />} Guardar como cotización</button>}
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
            disabled={!value.lines.length || saving || faltantesSinDecidir.length > 0 || disponibilidadCargando || requiereCotizacion || missingCustomer || missingSolicitante || missingConditionPago}
            title={faltantesSinDecidir.length > 0 ? 'Decidí qué hacer con las líneas sin stock' : missingCustomer ? 'Elegí un cliente para crear el pedido' : requiereCotizacion ? `${selectedCustomer?.name} requiere una cotización de origen — usá "Guardar como cotización"` : missingSolicitante ? 'Elegí un solicitante para crear el pedido' : missingConditionPago ? 'Elegí una condición de pago para crear el pedido' : undefined}
            onClick={() => void runOrderAction(onCreateOrder)}
          >
            Crear pedido <ArrowRight />
          </button>
        )}
        {isExistingQuote && onConvert && (value.status === 'draft' || value.status === 'approved') && <button className="primary-button" disabled={saving || faltantesSinDecidir.length > 0 || disponibilidadCargando || missingCustomer || missingSolicitante || missingConditionPago} title={faltantesSinDecidir.length > 0 ? 'Decidí qué hacer con las líneas sin stock' : missingCustomer ? 'Elegí un cliente para convertir' : missingSolicitante ? 'Elegí un solicitante para convertir' : missingConditionPago ? 'Elegí una condición de pago para convertir' : undefined} onClick={() => void runOrderAction(onConvert)}>Convertir a pedido</button>}
      </footer>
      {ambiguousIds && <AmbiguousScanPicker productIds={ambiguousIds} onClose={() => setAmbiguousIds(null)} onPick={(product) => { addCatalogProduct(product); setAmbiguousIds(null); setScanSku('') }} />}
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
type CustomForm = { descripcion: string; cantidad: number; precio: number; nota: string; unidadMedida: string }

function CustomItemModal({ form, setForm, editing, addAnother, setAddAnother, count, descripcionRef, onClose, onConfirm }: {
  form: CustomForm
  setForm: (updater: (prev: CustomForm) => CustomForm) => void
  editing: boolean
  addAnother: boolean
  setAddAnother: (value: boolean) => void
  count: number
  descripcionRef: RefObject<HTMLInputElement | null>
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal title={editing ? 'Editar ítem a pedido' : 'Agregar ítem a pedido'} subtitle="Productos personalizados o solicitados por encargo." onClose={onClose} className="commercial-modal">
      <div className="modal-body custom-item-modal">
        <div className="form-grid">
          <label className="full">Descripción<input ref={descripcionRef} autoFocus placeholder="¿Qué necesita el cliente?" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} /></label>
          <label>Cantidad<NumberField min={1} allowDecimals={false} value={form.cantidad} onCommit={(cantidad) => setForm((f) => ({ ...f, cantidad }))} /></label>
          <label>Unidad de medida<UnitOfMeasureField value={form.unidadMedida} emptyAllowed={editing} onChange={(unidadMedida) => setForm((f) => ({ ...f, unidadMedida }))} /></label>
          <label>Precio unitario (Bs)<NumberField min={0} value={form.precio} onCommit={(precio) => setForm((f) => ({ ...f, precio }))} /></label>
          <label className="full">Nota<input placeholder="Ej. comprar a proveedor X" value={form.nota} onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))} /></label>
        </div>
        <div className="commercial-inline-total"><span>Total del ítem</span><strong>{formatMoney(money(Math.round(form.cantidad * form.precio * 100)))}</strong></div>
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

