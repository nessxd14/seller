// Precio de una presentación según canal. Lógica pura: el servidor (guardar_pedido_vendedor /
// cobrar_pedido_vendedor) aplica la misma regla; la pantalla solo tiene que mostrar el mismo número.
import type { SalesChannel } from '../../types'

export type PreciosPresentacion = Record<SalesChannel, number | null>

export interface PresentacionConPrecio {
  nombre: string
  esBase: boolean
  factorUnidadBase: number
  /** Precio ya resuelto por canal (v_presentacion_precio); null = el producto no tiene precio en ese canal. */
  precios?: PreciosPresentacion
}

/** Umbral del aviso de precio bajo: por debajo del 50 % del sugerido. */
export const UMBRAL_PRECIO_BAJO = 0.5

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Precio sugerido de la presentación para el canal: el resuelto por la base de datos (precio
 * propio o precio del canal × factor). Solo si es null se usa el cálculo de siempre,
 * precio base del canal × factor. null si tampoco hay precio base.
 */
export const precioSugerido = (
  presentation: Pick<PresentacionConPrecio, 'factorUnidadBase' | 'precios'> | undefined,
  channel: SalesChannel,
  basePriceForChannel: number | null | undefined,
): number | null => {
  const resuelto = presentation?.precios?.[channel]
  if (resuelto != null) return round2(resuelto)
  if (basePriceForChannel == null) return null
  return round2(basePriceForChannel * (presentation?.factorUnidadBase ?? 1))
}

/** El precio unitario está por debajo de la mitad del sugerido. Sin sugerido (o sugerido 0) no hay aviso. */
export const esPrecioBajo = (precio: number, sugerido: number | null | undefined): boolean =>
  sugerido != null && sugerido > 0 && precio < sugerido * UMBRAL_PRECIO_BAJO

const fmtQty = (n: number): string => n.toLocaleString('es-BO')
const fmtBs = (n: number): string => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Nombre de la unidad base ("Hoja", "Pieza"…) a partir de las presentaciones cargadas; "u" si aún no están. */
export const nombreUnidadBase = (presentations: ReadonlyArray<Pick<PresentacionConPrecio, 'nombre' | 'esBase'>> | undefined): string =>
  presentations?.find((p) => p.esBase)?.nombre.trim() || 'u'

/** "15 PAQUETE (50) = 750 Pieza". */
export const textoEquivalencia = (cantidad: number, presentacionNombre: string | undefined, factor: number, baseNombre: string): string =>
  `${fmtQty(cantidad)} ${presentacionNombre ?? ''} = ${fmtQty(cantidad * factor)} ${baseNombre}`.replace('  ', ' ')

/** "Precio muy bajo para 1 PAQUETE (500 Hoja): sugerido Bs 32,00". */
export const textoPrecioBajo = (presentacionNombre: string | undefined, factor: number, baseNombre: string, sugerido: number): string => {
  const nombre = presentacionNombre?.trim() || baseNombre
  const detalle = factor !== 1 && !nombre.includes('(') ? ` (${fmtQty(factor)} ${baseNombre})` : ''
  return `Precio muy bajo para 1 ${nombre}${detalle}: sugerido Bs ${fmtBs(sugerido)}`
}
