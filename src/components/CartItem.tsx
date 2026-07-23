import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType } from '../types'
import { ProductVisual } from './ProductVisual'
import { calculateLineTotal } from '../domain/sales/cartCalculator'
import { moneyToDecimal } from '../domain/common/money'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CartItem({ item, onEdit }: { item: CartItemType; onEdit: () => void }) {
  const { updateQuantity, removeItem } = usePos()
  const lineTotal = moneyToDecimal(calculateLineTotal({ unitPrice: item.precioAplicado, quantity: item.cantidad, discountPercent: item.descuento }))
  return <article className="cart-item"><ProductVisual type={item.imagen} color={item.color} small /><div className="cart-item-main"><div className="cart-title"><div><h4>{item.nombre}</h4><span>Bs {money(item.precioAplicado)} c/u {item.descuento > 0 && <em>−{item.descuento}%</em>}</span></div><button onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.nombre}`}><Trash2 /></button></div><div className="cart-line-bottom"><div className="qty-control"><button disabled={item.cantidad <= 1} onClick={() => updateQuantity(item.id, item.cantidad - 1)}><Minus /></button><strong>{item.cantidad}</strong><button onClick={() => updateQuantity(item.id, item.cantidad + 1)}><Plus /></button></div><button className="edit-link" onClick={onEdit}><Pencil /> Editar</button><strong className="line-total">Bs {money(lineTotal)}</strong></div></div></article>
}
