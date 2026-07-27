import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { getPrice } from '../data/products'
import type { CartItem, Product, SalesChannel } from '../types'
import { calculateCartTotals } from '../domain/sales/cartCalculator'

// TAREA 4: the cart's active customer. undefined/null id means "Cliente de mostrador"
// (anonymous, cliente_id = null at checkout) — the default and always-available state.
export interface CartCustomer {
  id?: string
  name: string
  documento?: string
}

interface PosState {
  channel: SalesChannel
  setChannel: (channel: SalesChannel) => void
  cart: CartItem[]
  addProduct: (product: Product) => void
  updateQuantity: (id: number, quantity: number) => void
  updateItem: (id: number, values: Partial<CartItem>) => void
  removeItem: (id: number) => void
  clearCart: () => void
  discount: number
  setDiscount: (value: number) => void
  subtotal: number
  total: number
  operationNumber: number
  newOperation: () => void
  restoreSuspended: () => boolean
  hasSuspendedSale: boolean
  loadSuspendedSale: (sale: { channel: SalesChannel; cart: CartItem[]; discount: number; customer?: CartCustomer | null }) => void
  customer: CartCustomer | null
  selectCustomer: (customer: CartCustomer | null) => void
}

const PosContext = createContext<PosState | null>(null)

export function PosProvider({ children }: { children: ReactNode }) {
  const [channel, setChannelState] = useState<SalesChannel>('retail')
  const [cart, setCart] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [operationNumber, setOperationNumber] = useState(1048)
  const [hasSuspendedSale, setHasSuspendedSale] = useState(() => Boolean(localStorage.getItem('roari-suspended-sale')))
  const [customer, setCustomer] = useState<CartCustomer | null>(null)
  const selectCustomer = (next: CartCustomer | null) => setCustomer(next)

  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

  const setChannel = (next: SalesChannel) => {
    setChannelState(next)
    // Bug fix (brief TAREA 3): getPrice() always returns the product's PER-BASE-UNIT channel
    // price. A line with an active non-base presentation (e.g. "3 Caja") must multiply that
    // by its factorUnidadBase to get the per-presentation-unit price — otherwise switching
    // channels silently re-prices a "Caja" line as if it were a single loose unit. Mirrors
    // DraftOrderEditor's channel/presentation recompute: reset to the new channel's suggested
    // price (any manual override the seller made is discarded, same as changing presentation).
    // TAREA B: lines the seller already manually re-priced (precioModificado) are frozen —
    // "se respeta" applies to both the applied price and its discount, so neither is touched
    // by an automatic channel switch. Untouched lines keep the exact recompute above,
    // including the presentation-factor multiplication.
    setCart((items) => items.map((item) => item.precioModificado
      ? item
      : { ...item, precioAplicado: roundMoney(getPrice(item, next) * (item.factorUnidadBase ?? 1)), descuento: 0 }))
    setDiscount(0)
  }

  const addProduct = (product: Product) => setCart((items) => {
    const existing = items.find((item) => item.id === product.id)
    return existing
      ? items.map((item) => item.id === product.id ? { ...item, cantidad: item.cantidad + 1 } : item)
      : [...items, { ...product, cantidad: 1, precioAplicado: getPrice(product, channel), descuento: 0, ubicacion: 'Tienda' as const, observacion: '', motivoPrecio: '' }]
  })

  const updateQuantity = (id: number, quantity: number) => setCart((items) => items.map((item) => item.id === id ? { ...item, cantidad: Math.max(1, Math.floor(quantity)) } : item))
  const updateItem = (id: number, values: Partial<CartItem>) => setCart((items) => items.map((item) => item.id === id ? { ...item, ...values, cantidad: Math.max(1, Math.floor(values.cantidad ?? item.cantidad)), precioAplicado: Math.max(0, roundMoney(values.precioAplicado ?? item.precioAplicado)), descuento: Math.min(100, Math.max(0, values.descuento ?? item.descuento)) } : item))
  const removeItem = (id: number) => setCart((items) => items.filter((item) => item.id !== id))
  const clearCart = () => { setCart([]); setDiscount(0) }
  const newOperation = () => { clearCart(); setChannelState('retail'); setCustomer(null); setOperationNumber((number) => number + 1) }
  const totals = useMemo(() => calculateCartTotals(cart.map((item) => ({ unitPrice: item.precioAplicado, quantity: item.cantidad, discountPercent: item.descuento })), discount), [cart, discount])
  const subtotal = totals.subtotalDecimal
  const total = totals.totalDecimal
  const safeSetDiscount = (value: number) => setDiscount(roundMoney(Math.min(subtotal, Math.max(0, Number.isFinite(value) ? value : 0))))
  const restoreSuspended = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('roari-suspended-sale') ?? '') as { channel: SalesChannel; cart: CartItem[]; discount: number }
      if (!Array.isArray(saved.cart) || !saved.channel) return false
      setChannelState(saved.channel)
      setCart(saved.cart.map((item) => ({ ...item, cantidad: Math.max(1, Math.floor(item.cantidad)), precioAplicado: Math.max(0, roundMoney(item.precioAplicado)), descuento: Math.min(100, Math.max(0, item.descuento)) })))
      setDiscount(Math.max(0, saved.discount || 0))
      // Legacy single-slot suspended sale predates the customer picker (TAREA 4) and
      // never carried a customer field — restoring one always resets to "Cliente de
      // mostrador" rather than crashing on a field that was never there.
      setCustomer(null)
      localStorage.removeItem('roari-suspended-sale')
      setHasSuspendedSale(false)
      return true
    } catch { return false }
  }
  // TAREA 4 backward compatibility: `sale.customer` is absent on sales suspended before
  // this round (the v2 localStorage records didn't carry it yet). `?? null` mirrors the
  // same optional-field tolerance already established for CartItem's presentation fields
  // — a missing customer degrades to "Cliente de mostrador," never a crash.
  const loadSuspendedSale = (sale: { channel: SalesChannel; cart: CartItem[]; discount: number; customer?: CartCustomer | null }) => {
    setChannelState(sale.channel)
    setCart(sale.cart)
    setDiscount(Math.max(0, sale.discount))
    setCustomer(sale.customer ?? null)
  }

  return <PosContext.Provider value={{ channel, setChannel, cart, addProduct, updateQuantity, updateItem, removeItem, clearCart, discount, setDiscount: safeSetDiscount, subtotal, total, operationNumber, newOperation, restoreSuspended, hasSuspendedSale, loadSuspendedSale, customer, selectCustomer }}>{children}</PosContext.Provider>
}

export const usePos = () => {
  const context = useContext(PosContext)
  if (!context) throw new Error('usePos debe usarse dentro de PosProvider')
  return context
}
