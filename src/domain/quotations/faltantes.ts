import type { WorkflowLine } from '../../application/shared/models'

export interface Disponibilidad { disponible: number }
export type DisponibilidadMap = Record<string, Disponibilidad>

export interface FaltanteLinea {
  baseQty: number
  disponibleParaLinea: number
  faltante: number
  /** faltante / factor (entero cuando factor > 1). */
  faltantePresentacion: number
  /** (baseQty - faltante) / factor. */
  despachablePresentacion: number
}

export const baseQtyOf = (line: Pick<WorkflowLine, 'quantity' | 'factorUnidadBase'>): number =>
  line.quantity * (line.factorUnidadBase ?? 1)

/**
 * Brief S-PC: faltante por línea de catálogo, con saldo corrido por producto (la primera
 * línea de un producto toma de `disponible`, la siguiente de lo que queda). Productos
 * ausentes del mapa son "desconocidos": no se reporta faltante ni entran al resultado.
 */
export const calcularFaltantes = (
  lines: WorkflowLine[],
  disponibilidad: DisponibilidadMap,
): Record<string, FaltanteLinea> => {
  const saldo: Record<string, number> = {}
  const result: Record<string, FaltanteLinea> = {}
  for (const line of lines) {
    if (line.isCustomItem) continue
    const info = disponibilidad[line.productId]
    if (!info) continue
    const restante = saldo[line.productId] ?? info.disponible
    const baseQty = baseQtyOf(line)
    const disponibleParaLinea = Math.max(restante, 0)
    const factor = line.factorUnidadBase ?? 1
    const rawFaltante = Math.max(baseQty - disponibleParaLinea, 0)
    // No se despacha ni se compra media presentación: el faltante sube a la presentación entera
    // (mismo redondeo que aplica crear_pedido / enviar_linea_a_compra en la base).
    const faltante = factor > 1 ? Math.min(Math.ceil(rawFaltante / factor) * factor, baseQty) : rawFaltante
    result[line.id] = {
      baseQty, disponibleParaLinea, faltante,
      faltantePresentacion: faltante / factor,
      despachablePresentacion: (baseQty - faltante) / factor,
    }
    saldo[line.productId] = Math.max(restante - baseQty, 0)
  }
  return result
}

export type ItemPorComprar =
  | { lineId: string; name: string; sku: string; faltante: number; baseQty: number; unidad: string; factorUnidadBase: number; presentacionNombre?: string; faltantePresentacion: number; cantidad: number; esPersonalizado?: false }
  | { lineId: string; name: string; cantidad: number; esPersonalizado: true }

export const resumenPorComprar = (
  lines: WorkflowLine[],
  faltantes: Record<string, FaltanteLinea>,
): ItemPorComprar[] => {
  const items: ItemPorComprar[] = []
  for (const line of lines) {
    if (line.isCustomItem) {
      items.push({ lineId: line.id, name: line.name, cantidad: line.quantity, esPersonalizado: true })
      continue
    }
    const info = faltantes[line.id]
    if (line.comprarFaltante === true && info && info.faltante > 0) {
      items.push({ lineId: line.id, name: line.name, sku: line.sku, faltante: info.faltante, baseQty: info.baseQty, unidad: 'u. base',
        factorUnidadBase: line.factorUnidadBase ?? 1, presentacionNombre: line.presentacionNombre,
        faltantePresentacion: info.faltantePresentacion, cantidad: line.quantity,
      })
    }
  }
  return items
}
