import { useEffect, useState } from 'react'
import type { DemandaPrevia, DemandaUnidad, DemandaCanal } from '../../application/ports/demandaRepository'
import { getStockBySucursalBatch, productRepository } from '../../infrastructure/services'
import type { Product } from '../../types'

// Piezas que comparten las hojas del piso que anotan lo que el cliente buscó (Venta no realizada).

export const MIN_CARACTERES = 2
const DEBOUNCE_MS = 250
const MAX_COINCIDENCIAS = 5

export const UNIDADES: Array<{ valor: DemandaUnidad; texto: string }> = [
  { valor: 'UNIDADES', texto: 'Unidades' }, { valor: 'HOJAS', texto: 'Hojas' }, { valor: 'PAQUETES', texto: 'Paquetes' }, { valor: 'CAJAS', texto: 'Cajas' },
]
export const CANALES: Array<{ valor: DemandaCanal; texto: string }> = [{ valor: 'TIENDA', texto: 'Tienda' }, { valor: 'MAYOR', texto: 'Por mayor' }]

export interface Stock { tienda: number; almacen: number }

export const lineaStock = (s: Stock | undefined): string | null => {
  if (!s) return null
  if (s.tienda <= 0 && s.almacen <= 0) return 'sin stock en Tienda ni Almacén'
  if (s.tienda <= 0) return `sin stock en Tienda · ${s.almacen} en Almacén`
  if (s.almacen <= 0) return `${s.tienda} en Tienda · sin stock en Almacén`
  return `${s.tienda} en Tienda · ${s.almacen} en Almacén`
}

export const esSinConexion = (e: unknown): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) || (e instanceof Error && /failed to fetch|network|load failed/i.test(e.message))

export function useCoincidencias(texto: string, activo: boolean) {
  const [encontrados, setEncontrados] = useState<{ q: string; productos: Product[]; stock: Map<number, Stock> }>({ q: '', productos: [], stock: new Map() })
  const q = texto.trim()
  useEffect(() => {
    if (!activo || q.length < MIN_CARACTERES) return
    let cancelado = false
    const id = window.setTimeout(() => {
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: MAX_COINCIDENCIAS } })
        .then(async (page) => {
          if (cancelado) return
          setEncontrados({ q, productos: page.items, stock: new Map() })
          try {
            const lote = await getStockBySucursalBatch(page.items.map((p) => p.id))
            if (!cancelado) setEncontrados({ q, productos: page.items, stock: new Map([...lote].map(([pid, s]) => [pid, { tienda: s.tiendaVendible, almacen: s.almacenVendible }])) })
          } catch { /* sin stock fiable no se muestra la línea */ }
        })
        .catch(() => { if (!cancelado) setEncontrados({ q, productos: [], stock: new Map() }) })
    }, DEBOUNCE_MS)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [q, activo])
  // Solo valen los resultados de lo que está escrito ahora.
  return encontrados.q === q && activo ? encontrados : { q, productos: [] as Product[], stock: new Map<number, Stock>() }
}

export function BannerPrevio({ previa }: { previa: DemandaPrevia | null }) {
  if (!previa || (previa.vecesSemana <= 0 && previa.estado !== 'TRAER' && previa.estado !== 'LLEGO')) return null
  return <div className="demanda-previa" role="status">
    {previa.vecesSemana > 0 && <p>Ya la pidieron {previa.vecesSemana} veces esta semana. Tu anotación se suma a esas.</p>}
    {previa.estado === 'TRAER' && <p>Ya se está trayendo.</p>}
    {previa.estado === 'LLEGO' && <p>Ya llegó: avisa a caja/almacén.</p>}
  </div>
}
