import { Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { usePos } from '../context/PosContext'
import type { CartItem as CartItemType } from '../types'
import { ProductVisual } from './ProductVisual'
import { calculateLineTotal } from '../domain/sales/cartCalculator'
import { moneyToDecimal } from '../domain/common/money'

const money = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CartItem({ item, onEdit, originStock, onSetOrigin }: { item: CartItemType; onEdit: () => void; originStock?: { tienda: number; almacen: number }; onSetOrigin?: (location: 'Tienda' | 'Almacén') => void }) {
  const { updateQuantity, removeItem } = usePos()
  const lineTotal = moneyToDecimal(calculateLineTotal({ unitPrice: item.precioAplicado, quantity: item.cantidad, discountPercent: item.descuento }))
  const insufficient = onSetOrigin && originStock ? (item.ubicacion === 'Tienda' ? originStock.tienda : originStock.almacen) < item.cantidad : false
  return <article className="cart-item"><ProductVisual type={item.imagen} color={item.color} small imagenUrl={item.imagenUrl} /><div className="cart-item-main"><div className="cart-title"><div><h4>{item.nombre}</h4><span>Bs {money(item.precioAplicado)} c/u {item.descuento > 0 && <em>−{item.descuento}%</em>}</span></div><button onClick={() => removeItem(item.id)} aria-label={`Eliminar ${item.nombre}`}><Trash2 /></button></div>
    {onSetOrigin && <div className="channel-tabs origin-tabs" role="group" aria-label={`Origen ${item.nombre}`}>{(['Tienda', 'Almacén'] as const).map((loc) => <button key={loc} type="button" className={item.ubicacion === loc ? 'active' : ''} onClick={() => onSetOrigin(loc)}>{loc}{originStock ? ` ${loc === 'Tienda' ? originStock.tienda : originStock.almacen}` : ''}</button>)}</div>}
    {insufficient && <small className="line-stock-error">Stock insuficiente en {item.ubicacion} para {item.cantidad} uds.</small>}
    <div className="cart-line-bottom"><div className="qty-control"><button disabled={item.cantidad <= 1} onClick={() => updateQuantity(item.id, item.cantidad - 1)}><Minus /></button><strong>{item.cantidad}</strong><button onClick={() => updateQuantity(item.id, item.cantidad + 1)}><Plus /></button></div><button className="edit-link" onClick={onEdit}><Pencil /> Editar</button><strong className="line-total">Bs {money(lineTotal)}</strong></div></div></article>
}
