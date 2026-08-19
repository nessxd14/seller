import type { Product } from '../../types'

const SIN_FAMILIA = '__sin_familia__'

export interface GrupoFamilia { key: string; nombre: string; productos: Product[] }

/**
 * Brief S2 — item 3: agrupar resultados por familia (producto.familia_id, ~32% de
 * cobertura). Familias con nombre van primero (alfabético); "Otros" (sin familia_id)
 * siempre al final, porque es el grupo mayoritario y no aporta nada como primer bloque.
 */
export const agruparPorFamilia = (productos: Product[]): GrupoFamilia[] => {
  const porFamilia = new Map<string, GrupoFamilia>()
  for (const producto of productos) {
    const key = producto.familiaId != null ? String(producto.familiaId) : SIN_FAMILIA
    const nombre = producto.familiaId != null ? (producto.familiaNombre || `Familia ${producto.familiaId}`) : 'Otros'
    if (!porFamilia.has(key)) porFamilia.set(key, { key, nombre, productos: [] })
    porFamilia.get(key)!.productos.push(producto)
  }
  const grupos = [...porFamilia.values()]
  grupos.sort((a, b) => (a.key === SIN_FAMILIA ? 1 : b.key === SIN_FAMILIA ? -1 : a.nombre.localeCompare(b.nombre)))
  return grupos
}

export const esGrupoSinFamilia = (key: string): boolean => key === SIN_FAMILIA
