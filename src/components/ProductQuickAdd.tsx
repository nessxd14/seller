import { useEffect, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import type { Product } from '../types'
import { agruparPorFamilia, esGrupoSinFamilia } from '../domain/catalog/agruparPorFamilia'

export interface ProductQuickAddChip { productId: number; nombre: string; cantidad: number }

/**
 * Brief S2 — reemplaza el buscador+dropdown de DraftOrderEditor (el que sí reproduce el
 * bug: "al agregar, la búsqueda se reinicia"). Este componente NUNCA limpia `value` por
 * su cuenta al agregar — eso quedó deliberadamente afuera; solo Escape lo hace. Agrupa
 * por familia, muestra chips de lo ya agregado arriba, y soporta flechas/Enter/Escape.
 */
export function ProductQuickAdd({
  value, onValueChange, results, loading, chips, priceFor, onAdd, onRemoveChip, placeholder,
}: {
  value: string
  onValueChange: (value: string) => void
  results: Product[]
  loading: boolean
  chips: ProductQuickAddChip[]
  priceFor: (product: Product) => string
  onAdd: (product: Product) => void
  onRemoveChip: (productId: number) => void
  placeholder?: string
}) {
  const [resaltado, setResaltado] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const grupos = agruparPorFamilia(results)
  const plano = grupos.flatMap((g) => g.productos)
  // El resaltado se reinicia cada vez que cambia el set de resultados — evita quedar
  // apuntando a un índice que ya no existe (p. ej. de 8 resultados a 2).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el índice resaltado con el set de resultados que llega desde afuera (prop), no hay nada que "no necesitar" acá
  useEffect(() => { setResaltado(0) }, [results])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setResaltado((i) => Math.min(i + 1, Math.max(0, plano.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setResaltado((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const producto = plano[resaltado]; if (producto) onAdd(producto) }
    else if (e.key === 'Escape') { e.preventDefault(); onValueChange(''); inputRef.current?.blur() }
  }

  return (
    <div className="quick-add">
      {chips.length > 0 && (
        <div className="quick-add-chips">
          {chips.map((chip) => (
            <span className="quick-add-chip" key={chip.productId}>
              {chip.nombre} <b>×{chip.cantidad}</b>
              <button type="button" onClick={() => onRemoveChip(chip.productId)} aria-label={`Quitar ${chip.nombre}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="quick-add-input"><Search size={14} /><input ref={inputRef} placeholder={placeholder ?? 'Buscar producto por nombre o SKU…'} value={value} onChange={(e) => onValueChange(e.target.value)} onKeyDown={onKeyDown} /></div>
      {value && (
        <div className="quick-add-results">
          {loading && <span className="empty-hint">Buscando…</span>}
          {!loading && !plano.length && <span className="empty-hint">Sin resultados</span>}
          {!loading && grupos.map((grupo) => (
            <div className="quick-add-group" key={grupo.key}>
              {!esGrupoSinFamilia(grupo.key) && <div className="quick-add-group-header">{grupo.nombre}</div>}
              {grupo.productos.map((producto) => {
                const index = plano.indexOf(producto)
                const yaAgregado = chips.find((c) => c.productId === producto.id)
                return (
                  <button
                    type="button"
                    key={producto.id}
                    title={producto.nombre}
                    className={index === resaltado ? 'resaltado' : ''}
                    onMouseEnter={() => setResaltado(index)}
                    onClick={() => onAdd(producto)}
                  >
                    <strong>{producto.nombre}</strong>
                    <small>{[producto.sku, producto.codigoBarra].filter(Boolean).join(' · ')}</small>
                    <span className="precio">{priceFor(producto)}</span>
                    {yaAgregado && <span className="quick-add-ya"><Plus size={11} /> en carrito ×{yaAgregado.cantidad}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
