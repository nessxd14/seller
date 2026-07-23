import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { getPrice } from '../data/products'
import type { CartItem, Product, SalesChannel } from '../types'
import { calculateCartTotals } from '../domain/sales/cartCalculator'

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
  loadSuspendedSale: (sale: { channel: SalesChannel; cart: CartItem[]; discount: number }) => void
}

const PosContext = createContext<PosState | null>(null)

export function PosProvider({ children }: { children: ReactNode }) {
  const [channel, setChannelState] = useState<SalesChannel>('retail')
  const [cart, setCart] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [operationNumber, setOperationNumber] = useState(1048)
  const [hasSuspendedSale, setHasSuspendedSale] = useState(() => Boolean(localStorage.getItem('roari-suspended-sale')))

  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

  const setChannel = (next: SalesChannel) => {
    setChannelState(next)
    setCart((items) => items.map((item) => ({ ...item, precioAplicado: getPrice(item, next), descuento: 0 })))
    setDiscount(0)
  }

  const addProduct = (product: Product) => setCart((items) => {
    const existing = items.find((item) => item.id === product.id)
    return existing
      ? items.map((item) => item.id === product.id ? { ...item, cantidad: item.cantidad + 1 } : item)
      : [...items, { ...product, cantidad: 1, precioAplicado: getPrice(product, channel), descuento: 0, ubicacion: 'Tienda principal', observacion: '', motivoPrecio: '' }]
  })

  const updateQuantity = (id: number, quantity: number) => setCart((items) => items.map((item) => item.id === id ? { ...item, cantidad: Math.max(1, Math.floor(quantity)) } : item))
  const updateItem = (id: number, values: Partial<CartItem>) => setCart((items) => items.map((item) => item.id === id ? { ...item, ...values, cantidad: Math.max(1, Math.floor(values.cantidad ?? item.cantidad)), precioAplicado: Math.max(0, roundMoney(values.precioAplicado ?? item.precioAplicado)), descuento: Math.min(100, Math.max(0, values.descuento ?? item.descuento)) } : item))
  const removeItem = (id: number) => setCart((items) => items.filter((item) => item.id !== id))
  const clearCart = () => { setCart([]); setDiscount(0) }
  const newOperation = () => { clearCart(); setChannelState('retail'); setOperationNumber((number) => number + 1) }
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
      localStorage.removeItem('roari-suspended-sale')
      setHasSuspendedSale(false)
      return true
    } catch { return false }
  }
  const loadSuspendedSale = (sale: { channel: SalesChannel; cart: CartItem[]; discount: number }) => {
    setChannelState(sale.channel)
    setCart(sale.cart)
    setDiscount(Math.max(0, sale.discount))
  }

  return <PosContext.Provider value={{ channel, setChannel, cart, addProduct, updateQuantity, updateItem, removeItem, clearCart, discount, setDiscount: safeSetDiscount, subtotal, total, operationNumber, newOperation, restoreSuspended, hasSuspendedSale, loadSuspendedSale }}>{children}</PosContext.Provider>
}

export const usePos = () => {
  const context = useContext(PosContext)
  if (!context) throw new Error('usePos debe usarse dentro de PosProvider')
  return context
}
