import { ChevronDown, FileText, HandCoins, Pause, ReceiptText, RotateCcw, ShoppingCart, Sparkles, Truck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePos, type CartCustomer } from '../context/PosContext'
import type { CartItem as CartItemType, SalesChannel } from '../types'
import { useBorrador, borradorKey } from '../hooks/useBorrador'
import { BorradorBanner } from './BorradorBanner'
import { authSessionProvider, transferService } from '../infrastructure/services'
import { CartItem } from './CartItem'
import { EditCartItemModal } from './EditCartItemModal'
import { PaymentModal } from './PaymentModal'
import { TicketPreviewModal } from './TicketPreviewModal'
import { CustomerPicker } from './CustomerPicker'
import { SaldoBadge } from './SaldoBadge'
import { TrasladoTargetPicker } from './TrasladoTargetPicker'
import { CartReview } from './CartReview'
import type { QuoteDraft, TransferMotivo, WorkflowLine } from '../application/shared/models'
import type { PendingTransferRequest } from '../features/transfers/TransfersPage'
import { featureFlags } from '../config/featureFlags'
import { useCashSession } from '../context/CashSessionContext'
import { getStockByProduct } from '../infrastructure/services'
import { aggregateStockBySucursal } from '../features/inventory/stockAggregation'
import { isLineUnpriced } from '../domain/sales/priceCheck'
import { AnticipoModal } from './AnticipoModal'
import { addSuspendedSale, readSuspendedSales, removeSuspendedSale } from '../infrastructure/local/suspendedSales'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const channelNames = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', municipal: 'Municipal' }
const fmtQty = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })

// TAREA 12 (Tanda 3): ver el comentario en el useBorrador de más abajo.
const stripStockFields = (key: string, value: unknown): unknown => (key === 'stockTienda' || key === 'stockAlmacen' ? undefined : value)

// Brief J — modo traslado: mismo carrito, cambia el destino. Estado persistido por
// useBorrador difiere según el modo (ver justo abajo), así que es una unión, no un
// tipo único — cada draft sabe a qué modo pertenece.
type CartBorradorEstado =
  | { mode: 'venta'; channel: SalesChannel; cart: CartItemType[]; discount: number; customer: CartCustomer | null }
  | { mode: 'traslado'; cart: CartItemType[]; trasladoMotivo: TransferMotivo; trasladoOrigenId: number; trasladoDestinoId: number }

export function CartPanel({ notify, onOpenDraftOrder, onGoToCash, sellerName, onRequestTransfer }: { notify: (message: string) => void; onOpenDraftOrder: (draft: QuoteDraft) => void; onGoToCash: () => void; sellerName?: string; onRequestTransfer?: (request: PendingTransferRequest) => void }) {
  const { channel, cart, subtotal, total, discount, setDiscount, operationNumber, clearCart, loadSuspendedSale, updateItem, customer, mode, setMode, trasladoMotivo, trasladoOrigenId, trasladoDestinoId, setTrasladoDireccion, loadTrasladoDraft } = usePos()
  const { sessionId } = useCashSession()
  const cashClosed = channel === 'retail' && featureFlags.supabase && !sessionId
  const [editing, setEditing] = useState<CartItemType | null>(null)
  // TAREA 3: collapse state for the breakdown (subtotal/discount) rows — the total
  // itself never hides. sessionStorage (not localStorage): "persiste entre ventas en
  // la sesión" — survives navigating between sales within the same tab/session, but
  // a fresh browser session (new tab/reload of the whole app after closing it) is
  // fine to reset, unlike this codebase's roari-* localStorage keys which are truly
  // persistent across reloads.
  const [summaryCollapsed, setSummaryCollapsed] = useState(() => sessionStorage.getItem('roari-cart-summary-collapsed') === '1')
  useEffect(() => { sessionStorage.setItem('roari-cart-summary-collapsed', summaryCollapsed ? '1' : '0') }, [summaryCollapsed])

  // Brief H — useBorrador: autosave del carrito. `usuarioId` por sesión (evita que en
  // un mostrador compartido a alguien le aparezca el borrador de otro); 'anon' solo
  // hasta que resuelva la sesión (mismo patrón que actorId en DraftOrderEditor).
  const [usuarioId, setUsuarioId] = useState('anon')
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => { void authSessionProvider.getSession().then((session) => { if (session) { setUsuarioId(session.user.id); setIsAdmin(session.user.role === 'admin') } }) }, [])
  // Brief J: el borrador de venta y el de traslado viven bajo claves distintas
  // (…:carrito vs …:traslado) — son formularios distintos, restaurar uno con la
  // forma del otro no tiene sentido (venta necesita cliente, traslado necesita
  // motivo/dirección). useBorrador ya relee localStorage cuando `clave` cambia, así
  // que cambiar de modo automáticamente ofrece (o no) el borrador correcto.
  const borradorEstado: CartBorradorEstado = mode === 'traslado'
    ? { mode, cart, trasladoMotivo, trasladoOrigenId, trasladoDestinoId }
    : { mode, channel, cart, discount, customer }
  const { borradorPendiente, descartar: descartarBorrador, limpiar: limpiarBorrador } = useBorrador(
    borradorKey(mode === 'traslado' ? 'traslado' : 'carrito', usuarioId),
    borradorEstado,
    // TAREA 12 (Tanda 3): en modo Supabase, stockTienda/stockAlmacen del carrito quedan
    // siempre en 0 (rowToProduct nunca los llena ahí — el stock real vive en un batch
    // aparte, ver Tanda 1) — persistirlos en el borrador guardaría un dato falso.
    { replacer: featureFlags.supabase ? stripStockFields : undefined },
  )
  // operationNumber solo avanza en newOperation() (checkout exitoso finalizado) — no en
  // suspender ni restaurar. Es la señal de "se envió con éxito, ya no ofrezcas este borrador".
  const prevOperationNumberRef = useRef(operationNumber)
  useEffect(() => {
    if (prevOperationNumberRef.current !== operationNumber) {
      prevOperationNumberRef.current = operationNumber
      limpiarBorrador()
    }
  }, [operationNumber, limpiarBorrador])
  const retomarBorrador = () => {
    if (!borradorPendiente) return
    const datos = borradorPendiente.datos
    if (datos.mode === 'traslado') loadTrasladoDraft(datos)
    else loadSuspendedSale(datos)
    limpiarBorrador()
  }
  // Origin-toggle stock cache (item 5): per-productId, fetched/read once and kept for the
  // cart panel's lifetime so switching items or re-rendering doesn't refetch repeatedly.
  // Brief J: también alimenta el aviso de disponible en modo traslado, así que se
  // fetchea cuando cualquiera de los dos lo necesita, no solo channel==='retail'.
  const [originStock, setOriginStock] = useState<Record<number, { tienda: number; almacen: number }>>({})
  useEffect(() => {
    if (channel !== 'retail' && mode !== 'traslado') return
    const missing = cart.filter((item) => !(item.id in originStock))
    if (!missing.length) return
    if (!featureFlags.supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mock mode reads stock straight off the already-loaded Product fields, no async fetch to defer to a callback
      setOriginStock((prev) => { const next = { ...prev }; missing.forEach((item) => { next[item.id] = { tienda: item.stockTienda, almacen: item.stockAlmacen } }); return next })
      return
    }
    void Promise.all(missing.map((item) => getStockByProduct(item.id).then((result) => {
      const agg = aggregateStockBySucursal(result.onHand)
      return [item.id, { tienda: agg.tienda, almacen: agg.almacen }] as const
    }))).then((entries) => setOriginStock((prev) => ({ ...prev, ...Object.fromEntries(entries) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, channel, mode])
  // TAREA 4 (Tanda 3): el caché de arriba se llenaba una vez y no se invalidaba nunca —
  // vendías 5 de 5 unidades, volvías a agregar el producto y seguía diciendo que había 5
  // (insufficientOrigin dejaba pasar una venta que la RPC iba a rechazar). Sin argumento
  // limpia todo, que es lo correcto tras un checkout multi-línea; con productId limpia
  // solo esa entrada.
  const invalidateOriginStock = (productId?: number) => {
    setOriginStock((prev) => {
      if (productId == null) return {}
      const next = { ...prev }
      delete next[productId]
      return next
    })
  }
  const insufficientOrigin = mode === 'venta' && channel === 'retail' && cart.some((item) => {
    const stock = originStock[item.id]
    if (!stock) return false
    return (item.ubicacion === 'Tienda' ? stock.tienda : stock.almacen) < item.cantidad
  })
  // Brief J: disponible en la sucursal ORIGEN del traslado (no el split Tienda/Almacén de
  // venta) — es aviso, nunca bloqueo, el faltante se resuelve en el AJUSTE de recepción.
  const SUCURSAL_ALMACEN_ID = 1
  const trasladoDisponibleFor = (productId: number) => {
    const stock = originStock[productId]
    if (!stock) return 0
    return trasladoOrigenId === SUCURSAL_ALMACEN_ID ? stock.almacen : stock.tienda
  }
  // TAREA A: no line can be checked out at Bs 0 — adding an unpriced product to the cart is
  // fine, this only blocks at checkout time, mirroring insufficientOrigin's exact shape.
  const unpricedItems = cart.filter((item) => isLineUnpriced(item))
  const unpricedLine = unpricedItems.length > 0
  // Names the first offender specifically (brief's exact copy pattern) rather than a generic
  // "hay líneas con problema" — a trailing note covers the (rare) multi-line case without
  // stacking a full banner per unpriced line.
  const unpricedBannerText = unpricedItems.length
    ? `${unpricedItems[0].nombre} no tiene precio. Escribilo en la línea para poder cobrar.${unpricedItems.length > 1 ? ` (y ${unpricedItems.length - 1} línea${unpricedItems.length > 2 ? 's' : ''} más sin precio)` : ''}`
    : ''
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [anticipoOpen, setAnticipoOpen] = useState(false)
  const customerLabel = customer ? customer.name : 'Cliente de mostrador'
  // TAREA 6 (Tanda 3): único mecanismo de venta suspendida (ver infrastructure/local/
  // suspendedSales.ts) — el legado `roari-suspended-sale` de una sola ranura se borró.
  const [hasSuspended, setHasSuspended] = useState(() => readSuspendedSales().length > 0)
  const suspend = () => {
    if (!cart.length) return
    // TAREA 4/12: persist the selected customer alongside the rest of the suspended sale
    // so restoring it later doesn't silently drop back to "Cliente de mostrador"; strip
    // stockTienda/stockAlmacen in Supabase mode (ver stripStockFields arriba).
    addSuspendedSale({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      seller: sellerName || 'Usuario POS',
      channel,
      customer: customerLabel,
      cart,
      discount,
      total,
      customerId: customer?.id,
      customerName: customer?.name,
      customerDocument: customer?.documento,
    }, featureFlags.supabase ? stripStockFields : undefined)
    setHasSuspended(true)
    clearCart()
    notify('Venta suspendida y guardada localmente')
  }
  // Restaura la más reciente (la lista está ordenada por unshift, la primera es la
  // última suspendida) — SuspendedSalesPage sigue siendo el lugar para elegir una
  // específica; este botón es el atajo rápido "seguir con lo último".
  const restore = () => {
    const [latest] = readSuspendedSales()
    if (!latest) { notify('No se pudo restaurar la venta'); return }
    loadSuspendedSale({
      channel: latest.channel as SalesChannel,
      cart: latest.cart,
      discount: latest.discount,
      customer: latest.customerId || latest.customerName ? { id: latest.customerId, name: latest.customerName ?? 'Cliente de mostrador', documento: latest.customerDocument } : null,
    })
    removeSuspendedSale(latest.id)
    setHasSuspended(readSuspendedSales().length > 0)
    notify('Venta suspendida restaurada')
  }
  const openDraft = () => {
    if (!cart.length) return
    const lines: WorkflowLine[] = cart.map((item) => ({
      id: crypto.randomUUID(),
      productId: String(item.id),
      name: item.nombre,
      sku: item.sku,
      quantity: item.cantidad,
      unitPriceCents: Math.round(item.precioAplicado * 100),
      discountBasisPoints: Math.round(item.descuento * 100),
      // TAREA 3 (Tanda 3): antes hardcodeado a 'Almacén', ignorando item.ubicacion —
      // se perdía el origen por línea, justo lo que el esquema soporta. Ídem
      // presentacionId/factorUnidadBase: sin propagarlos, "3 × Caja(24)" pasaba al
      // borrador como 3 unidades sueltas (el mismo bug que ya costó el descuadre de
      // registrar_venta facturando 72×50 en vez de 3×50).
      sourceLocation: item.ubicacion,
      presentacionId: item.presentacionId,
      factorUnidadBase: item.factorUnidadBase,
    }))
    onOpenDraftOrder({
      id: featureFlags.supabase ? '' : crypto.randomUUID(),
      number: '',
      customerId: '',
      customerName: '',
      channel: channel as QuoteDraft['channel'],
      status: 'draft',
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      terms: 'Contado',
      notes: '',
      generalDiscountCents: Math.round(discount * 100),
      createdAt: new Date().toISOString(),
      lines,
    })
  }
  // Brief J: cantidad viaja en unidad de PRESENTACIÓN, nunca en base — mandar base
  // cuando se eligió una caja de 24 multiplica el traslado por 24 (el mismo bug que
  // ya tuvimos en registrar_venta). Sin presentación activa, item.cantidad ya está
  // en unidad base, así que cantidadBase es lo correcto en ese caso.
  const [solicitando, setSolicitando] = useState(false)
  const solicitarTraslado = async () => {
    if (!cart.length || solicitando) return
    setSolicitando(true)
    try {
      await transferService.create({
        motivo: trasladoMotivo,
        sucursalOrigenId: trasladoOrigenId,
        sucursalDestinoId: trasladoDestinoId,
        lines: cart.map((item) => ({
          productId: String(item.id),
          ...(item.presentacionId != null ? { presentacionId: item.presentacionId, cantidadPresentacion: item.cantidad } : { cantidadBase: item.cantidad }),
        })),
      })
      clearCart()
      limpiarBorrador()
      notify('Solicitud de traslado creada')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo crear la solicitud de traslado')
    } finally {
      setSolicitando(false)
    }
  }
  const toggleMode = () => setMode(mode === 'venta' ? 'traslado' : 'venta')
  return <aside className="cart-panel">{borradorPendiente && <BorradorBanner guardadoEn={borradorPendiente.guardadoEn} onRetomar={retomarBorrador} onDescartar={descartarBorrador} />}<div className="cart-header"><div><span>OPERACIÓN ACTUAL</span><h2>{mode === 'traslado' ? 'Traslado' : 'Venta'} <b>#{operationNumber}</b></h2></div><button type="button" className="modo-toggle" role="switch" aria-checked={mode === 'traslado'} onClick={toggleMode} title={mode === 'traslado' ? 'Volver a modo venta' : 'Cambiar a modo traslado'}>{mode === 'traslado' ? <Truck /> : <ShoppingCart />}<span>{mode === 'traslado' ? 'Traslado' : 'Venta'}</span></button>{mode === 'venta' && <span className="channel-badge">{channelNames[channel]}</span>}</div><div className="operation-meta"><span>{new Date().toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}</span><i /> <span>{new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span></div>
    {mode === 'traslado'
      ? <TrasladoTargetPicker origenId={trasladoOrigenId} destinoId={trasladoDestinoId} isAdmin={isAdmin} onInvertir={() => setTrasladoDireccion(trasladoDestinoId, trasladoOrigenId)} />
      : <>{<CustomerPicker channel={channel} notify={notify} />}{customer && <SaldoBadge clienteId={customer.id} />}</>}
    <div className="cart-list-heading"><span>{mode === 'traslado' ? 'Detalle del traslado' : 'Detalle de venta'}</span><b>{cart.reduce((sum, item) => sum + item.cantidad, 0)} artículos</b></div><div className="cart-list">{cart.length ? cart.map((item) => <CartItem item={item} key={item.id} onEdit={() => setEditing(item)} originStock={mode === 'venta' && channel === 'retail' ? originStock[item.id] : undefined} onSetOrigin={mode === 'venta' && channel === 'retail' ? (loc) => updateItem(item.id, { ubicacion: loc }) : undefined} onRequestTransfer={mode === 'venta' && channel === 'retail' && onRequestTransfer ? (shortfall) => onRequestTransfer({ productId: String(item.id), productName: item.nombre, productSku: item.sku, quantity: shortfall }) : undefined} trasladoDisponible={mode === 'traslado' ? trasladoDisponibleFor(item.id) : undefined} />) : <div className="empty-cart"><div><ShoppingCart /></div><h3>Tu carrito está vacío</h3><p>Agrega productos del catálogo para comenzar {mode === 'traslado' ? 'un traslado' : 'una venta'}.</p></div>}</div>
    {mode === 'traslado' ? (
      <div className="cart-summary cart-summary-traslado">
        <div><span>Líneas</span><strong>{cart.length}</strong></div>
        <div><span>Unidades base</span><strong>{fmtQty(cart.reduce((sum, item) => sum + item.cantidad * (item.factorUnidadBase ?? 1), 0))}</strong></div>
      </div>
    ) : (
      <div className="cart-summary">
        <div className={`cart-summary-breakdown ${summaryCollapsed ? 'collapsed' : ''}`}>
          <div className="cart-summary-breakdown-inner">
            <div><span>Subtotal</span><strong>Bs {money(subtotal)}</strong></div>
            <div className="discount-line"><label>Descuento</label><span>Bs <input aria-label="Descuento general" type="number" min="0" max={subtotal} value={discount || ''} placeholder="0.00" onChange={(e) => setDiscount(Math.min(subtotal, Math.max(0, Number(e.target.value))))} /></span></div>
          </div>
        </div>
        <div className="grand-total">
          <span>Total</span>
          <strong>Bs {money(total)}</strong>
          <button
            type="button"
            className="summary-collapse-toggle"
            aria-label={summaryCollapsed ? 'Desplegar resumen' : 'Plegar resumen'}
            aria-expanded={!summaryCollapsed}
            onClick={() => setSummaryCollapsed((v) => !v)}
          >
            <ChevronDown className={summaryCollapsed ? '' : 'chevron-open'} />
          </button>
        </div>
        <small>Precios con impuestos incluidos según configuración</small>
      </div>
    )}
    <div className="cart-actions">{mode === 'venta' && !cart.length && hasSuspended && <button className="restore-button" onClick={restore}><RotateCcw /> Restaurar venta suspendida</button>}{mode === 'traslado' ? (
      <button data-pos-action="solicitar-traslado" className="pay-button" disabled={!cart.length || solicitando} onClick={() => void solicitarTraslado()}><Truck /> {solicitando ? 'Solicitando…' : 'Solicitar traslado'}</button>
    ) : channel === 'retail' ? <><div className="secondary-actions secondary-actions-3"><button data-pos-action="suspend" onClick={suspend} disabled={!cart.length}><Pause /> Suspender</button><button onClick={() => setTicketOpen(true)} disabled={!cart.length}><ReceiptText /> Ticket</button><button onClick={() => setReviewOpen(true)} disabled={!cart.length}><Sparkles /> Revisar</button></div>{cashClosed && <button className="cash-closed-notice" onClick={onGoToCash}>Caja cerrada — abrí la caja para poder cobrar</button>}{insufficientOrigin && <p className="cash-closed-notice">Hay líneas sin stock suficiente en la ubicación elegida — corrígelas para poder cobrar.</p>}{unpricedLine && <p className="cash-closed-notice">{unpricedBannerText}</p>}<button data-pos-action="pay" className="pay-button" disabled={!cart.length || cashClosed || insufficientOrigin || unpricedLine} onClick={() => setPaymentOpen(true)}><HandCoins /> Cobrar <span>Bs {money(total)}</span></button></> : <>
      {/* TAREA 3 (Tanda 3): "Cotización" y "Crear pedido" llamaban las dos a openDraft()
          sin ningún argumento que las diferenciara — hacían exactamente lo mismo. Ambas
          terminan abriendo el mismo editor de cotización (onOpenDraftOrder siempre navega
          a Cotizaciones), así que "Crear pedido" prometía algo que no hacía. Se decidió
          dejar un solo botón acá; convertir una cotización en pedido ya es un paso propio
          del editor de Cotizaciones (convertir_cotizacion_a_pedido). */}
      <button className="draft-button" disabled={!cart.length} onClick={openDraft}><FileText /> Guardar borrador</button><div className="secondary-actions"><button disabled={!cart.length} onClick={openDraft}>Cotización</button></div>{unpricedLine && <p className="cash-closed-notice">{unpricedBannerText}</p>}<button data-pos-action="pay" className="pay-button" disabled={!cart.length || (channel === 'mayoreo' && unpricedLine)} onClick={() => channel === 'mayoreo' ? setPaymentOpen(true) : setAnticipoOpen(true)}><HandCoins /> {channel === 'mayoreo' ? 'Cobrar' : 'Registrar anticipo'} <span>Bs {money(total)}</span></button></>}</div>
    {editing && <EditCartItemModal item={editing} onClose={() => setEditing(null)} />}{paymentOpen && <PaymentModal onClose={() => setPaymentOpen(false)} onCheckoutSuccess={() => invalidateOriginStock()} />}{ticketOpen && <TicketPreviewModal onClose={() => setTicketOpen(false)} />}
    {anticipoOpen && <AnticipoModal onClose={() => setAnticipoOpen(false)} notify={notify} />}
    {reviewOpen && <CartReview items={cart} channel={channel} originStock={originStock} customer={customer} subtotal={subtotal} discount={discount} total={total} onClose={() => setReviewOpen(false)} onCheckout={() => { setReviewOpen(false); setPaymentOpen(true) }} />}
  </aside>
}
