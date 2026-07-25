import { Building2, Landmark, Plus, Warehouse, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuoteDraft, WorkflowLine } from '../../application/shared/models'
import type { CustomerRecord } from '../../application/shared/models'
import { customerService, productRepository } from '../../infrastructure/services'
import { mockAuthSessionProvider } from '../../infrastructure/mock/MockAuthSessionProvider'
import { formatMoney, money } from '../../domain/common/money'
import { Modal } from '../../components/Modal'
import type { Product } from '../../types'

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

export function DraftOrderEditor({ quote, onClose, onSave, onCreateOrder, onConvert }: {
  quote: QuoteDraft
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
  const [priceEditorLineId, setPriceEditorLineId] = useState<string | null>(null)
  const [actorId, setActorId] = useState('pos')
  const [saving, setSaving] = useState(false)

  useEffect(() => { void mockAuthSessionProvider.getSession().then((session) => session && setActorId(session.user.id)) }, [])
  useEffect(() => { void customerService.list().then(setCustomers) }, [])

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      void productRepository.search({ query: productQuery, active: true, page: { page: 1, pageSize: 20 } }).then((page) => { if (!cancelled) setProductResults(page.items) })
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [productQuery])

  const filteredCustomers = useMemo(
    () => customers.filter((c) => `${c.name} ${c.document} ${c.email}`.toLowerCase().includes(customerQuery.toLowerCase())).slice(0, 8),
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

  const addCatalogProduct = (product: Product) => {
    if (value.lines.some((line) => line.productId === String(product.id) && !line.isCustomItem)) return
    const unitPriceCents = Math.round(priceForChannel(product, value.channel) * 100)
    const newLine: WorkflowLine = {
      id: crypto.randomUUID(),
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
    setProductQuery('')
    setProductResults([])
  }

  const scanBarcode = async () => {
    const sku = scanSku.trim()
    if (!sku) return
    const found = productResults.find((p) => p.sku === sku) ?? (await productRepository.getById(sku).catch(() => null))
    const product = found ?? productResults.find((p) => p.sku.toLowerCase() === sku.toLowerCase())
    if (product) addCatalogProduct(product)
    setScanSku('')
  }

  const addCustomLine = () => {
    const newLine: WorkflowLine = {
      id: crypto.randomUUID(),
      productId: '',
      name: 'Ítem personalizado',
      sku: '',
      quantity: 1,
      unitPriceCents: 0,
      discountBasisPoints: 0,
      isCustomItem: true,
      note: '',
    }
    setValue((v) => ({ ...v, lines: [...v.lines, newLine] }))
  }

  const updateLine = (id: string, patch: Partial<WorkflowLine>) =>
    setValue((v) => ({ ...v, lines: v.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) }))

  const removeLine = (id: string) => setValue((v) => ({ ...v, lines: v.lines.filter((line) => line.id !== id) }))

  const catalogLines = value.lines.filter((line) => !line.isCustomItem)
  const customLines = value.lines.filter((line) => line.isCustomItem)

  const runAction = async (action: (q: QuoteDraft) => void | Promise<void>) => {
    setSaving(true)
    try { await action(value) } finally { setSaving(false) }
  }

  return (
    <Modal title={value.id ? `Cotización ${value.number || value.id}` : 'Nueva cotización'} subtitle={readOnly ? 'Solo lectura — esta cotización ya no está en borrador' : 'Editor tipo borrador de pedido'} onClose={onClose} wide>
      <div className="modal-body quote-editor draft-order-editor">
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
          </label>
          <label>Vigencia<input type="date" disabled={readOnly} value={value.validUntil} onChange={(e) => setValue((v) => ({ ...v, validUntil: e.target.value }))} /></label>
          <label>Descuento general (Bs)<input type="number" min="0" disabled={readOnly} value={value.generalDiscountCents / 100} onChange={(e) => setValue((v) => ({ ...v, generalDiscountCents: Math.max(0, Math.round(Number(e.target.value) * 100)) }))} /></label>
          <label className="full">Condiciones comerciales<input disabled={readOnly} value={value.terms} onChange={(e) => setValue((v) => ({ ...v, terms: e.target.value }))} /></label>
          <label className="full">Observaciones<textarea rows={2} disabled={readOnly} value={value.notes} onChange={(e) => setValue((v) => ({ ...v, notes: e.target.value }))} /></label>
        </div>

        {!readOnly && (
          <div className="line-add-controls">
            <input placeholder="Buscar producto por nombre o SKU..." value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
            <input
              placeholder="Escanear código (Enter)"
              value={scanSku}
              onChange={(e) => setScanSku(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scanBarcode() } }}
            />
            {productQuery && (
              <div className="product-search-results">
                {productResults.map((p) => (
                  <button type="button" key={p.id} onClick={() => addCatalogProduct(p)}>
                    <strong>{p.nombre}</strong><small>{p.sku} · {formatMoney(money(Math.round(priceForChannel(p, value.channel) * 100)))}</small>
                  </button>
                ))}
                {!productResults.length && <span className="empty-hint">Sin resultados</span>}
              </div>
            )}
          </div>
        )}

        <div className="editor-lines draft-lines">
          <header><strong>Productos</strong></header>
          {catalogLines.map((line) => (
            <div key={line.id} className="draft-line-row">
              <span><strong>{line.name}</strong><small>{line.sku}</small></span>
              <input aria-label={`Cantidad ${line.name}`} type="number" min="1" disabled={readOnly} value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Math.max(1, Number(e.target.value)) })} />
              <select aria-label={`Origen ${line.name}`} disabled={readOnly} value={line.sourceLocation ?? 'Almacén'} onChange={(e) => updateLine(line.id, { sourceLocation: e.target.value as 'Tienda' | 'Almacén' })}>
                <option value="Almacén">Almacén</option>
                <option value="Tienda">Tienda</option>
              </select>
              <button type="button" className="price-cell" disabled={readOnly} onClick={() => setPriceEditorLineId(priceEditorLineId === line.id ? null : line.id)}>
                {formatMoney(money(line.unitPriceCents))}{line.discountBasisPoints > 0 && <small> −{(line.discountBasisPoints / 100).toFixed(1)}%</small>}
                {line.priceOverridden && <small className="overridden-badge">editado</small>}
              </button>
              <strong>{formatMoney(money(lineTotalCents(line)))}</strong>
              {!readOnly && <button type="button" onClick={() => removeLine(line.id)}><X /></button>}
              {priceEditorLineId === line.id && (
                <PricePopover
                  line={line}
                  onClose={() => setPriceEditorLineId(null)}
                  onApply={(patch) => { updateLine(line.id, { ...patch, priceOverridden: true, modifiedBy: actorId, modifiedAt: new Date().toISOString() }); setPriceEditorLineId(null) }}
                />
              )}
            </div>
          ))}
          {!catalogLines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Sin productos de catálogo.</div>}
        </div>

        <div className="editor-lines draft-lines custom-lines">
          <header><strong>Ítems especiales / a pedido</strong>{!readOnly && <button type="button" onClick={addCustomLine}><Plus /> Añadir ítem personalizado</button>}</header>
          {customLines.map((line) => (
            <div key={line.id} className="draft-line-row custom-line-row">
              <input aria-label="Descripción" disabled={readOnly} placeholder="Descripción" value={line.name} onChange={(e) => updateLine(line.id, { name: e.target.value })} />
              <input aria-label="Cantidad" type="number" min="1" disabled={readOnly} value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Math.max(1, Number(e.target.value)) })} />
              <input aria-label="Precio" type="number" min="0" disabled={readOnly} value={line.unitPriceCents / 100} onChange={(e) => updateLine(line.id, { unitPriceCents: Math.max(0, Math.round(Number(e.target.value) * 100)) })} />
              <input aria-label="Nota" disabled={readOnly} placeholder="Nota (ej. comprar a proveedor X)" value={line.note ?? ''} onChange={(e) => updateLine(line.id, { note: e.target.value })} />
              <strong>{formatMoney(money(lineTotalCents(line)))}</strong>
              {!readOnly && <button type="button" onClick={() => removeLine(line.id)}><X /></button>}
            </div>
          ))}
          {!customLines.length && <div className="empty-hint" style={{ padding: '10px 12px' }}>Sin ítems especiales.</div>}
        </div>

        <div className="totals-footer">
          <div><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          <div><span>Descuento general</span><strong>-{formatMoney(money(value.generalDiscountCents))}</strong></div>
          <div className="total"><span>Total</span><strong>{formatMoney(money(totalCents))}</strong></div>
        </div>
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        {!readOnly && <button className="primary-button" disabled={!value.lines.length || saving} onClick={() => void runAction(onSave)}>Guardar como cotización</button>}
        {!readOnly && onCreateOrder && <button className="primary-button" disabled={!value.lines.length || saving} onClick={() => void runAction(onCreateOrder)}>Crear pedido</button>}
        {onConvert && (value.status === 'draft' || value.status === 'approved') && <button className="primary-button" disabled={saving} onClick={() => void runAction(onConvert)}>Convertir a pedido</button>}
      </footer>
    </Modal>
  )
}

function PricePopover({ line, onApply, onClose }: { line: WorkflowLine; onApply: (patch: Partial<WorkflowLine>) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'price' | 'discount'>('price')
  const [priceInput, setPriceInput] = useState(String(line.unitPriceCents / 100))
  const [discountInput, setDiscountInput] = useState(String(line.discountBasisPoints / 100))
  return (
    <div className="price-popover" role="dialog" aria-label="Editar precio">
      <div className="price-popover-tabs">
        <button type="button" className={mode === 'price' ? 'active' : ''} onClick={() => setMode('price')}>Precio unitario</button>
        <button type="button" className={mode === 'discount' ? 'active' : ''} onClick={() => setMode('discount')}>Descuento %</button>
      </div>
      {mode === 'price'
        ? <input type="number" min="0" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} autoFocus />
        : <input type="number" min="0" max="100" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} autoFocus />}
      <div className="price-popover-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-button" onClick={() => onApply(mode === 'price' ? { unitPriceCents: Math.max(0, Math.round(Number(priceInput) * 100)) } : { discountBasisPoints: Math.min(10_000, Math.max(0, Math.round(Number(discountInput) * 100))) })}>Aplicar</button>
      </div>
    </div>
  )
}
