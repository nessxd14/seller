import { useEffect, useState } from 'react'
import type { Product } from '../types'
import { listLineIdentifiers, productRepository } from '../infrastructure/services'
import type { LineIdentifiers } from './LineIdentifiersRow'
import { Modal } from './Modal'

/**
 * Brief: resolveScannedCode returns `{ kind: 'ambiguous', productIds }` for the ~40
 * barra/fábrica/SKU codes shared by more than one product in production. Before this,
 * the Enter handler just toasted and discarded the candidates, forcing the cajero to
 * redo the search by name from scratch. This modal shows the actual candidates so they
 * can pick the right one in one click.
 */
export function AmbiguousScanPicker({ productIds, onPick, onClose }: { productIds: number[]; onPick: (product: Product) => void; onClose: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [identifiers, setIdentifiers] = useState<Record<string, LineIdentifiers>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      Promise.all(productIds.map((id) => productRepository.getById(String(id)))).then((results) => results.filter((p): p is Product => p != null)),
      listLineIdentifiers(productIds.map(String)),
    ]).then(([foundProducts, foundIdentifiers]) => {
      if (cancelled) return
      setProducts(foundProducts)
      setIdentifiers(foundIdentifiers)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [productIds])

  return (
    <Modal title="Código en más de un producto" subtitle="Elegí cuál corresponde" onClose={onClose}>
      <div className="ambiguous-scan-results">
        {loading && <span className="empty-hint">Buscando…</span>}
        {!loading && !products.length && <span className="empty-hint">No se encontraron los productos</span>}
        {!loading && products.map((product) => {
          const marca = identifiers[String(product.id)]?.marca
          return (
            <button type="button" key={product.id} className="ambiguous-scan-row" onClick={() => onPick(product)}>
              <strong>{product.nombre}</strong>
              <small>{[product.sku, marca].filter(Boolean).join(' · ')}</small>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
