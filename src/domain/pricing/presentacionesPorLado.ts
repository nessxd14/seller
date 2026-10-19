// Dónde se vende cada presentación: tienda (mostrador, VTD, celular del piso) o almacén
// (cotizaciones, pedidos mayoristas). La base de datos rechaza líneas nuevas con una
// presentación no habilitada para el lado (23514); esto evita ofrecerlas en pantalla.
export type LadoVenta = 'tienda' | 'almacen'

export interface PresentacionPorLado {
  esBase: boolean
  factorUnidadBase: number
  /** Ausente = habilitada. */
  vendeTienda?: boolean
  vendeAlmacen?: boolean
}

export const presentacionVendeEnLado = (p: PresentacionPorLado, lado: LadoVenta): boolean =>
  (lado === 'tienda' ? p.vendeTienda : p.vendeAlmacen) !== false

export const presentacionesDelLado = <T extends PresentacionPorLado>(list: readonly T[], lado: LadoVenta): T[] =>
  list.filter((p) => presentacionVendeEnLado(p, lado))

/** Opciones del selector para elecciones nuevas: solo las del lado, pero la presentación actual de la línea (aunque ya no se venda) se conserva visible. */
export const opcionesDelLado = <T extends PresentacionPorLado & { id: number }>(list: readonly T[], actualId: number | undefined, lado: LadoVenta): T[] =>
  list.filter((p) => presentacionVendeEnLado(p, lado) || p.id === actualId)

/** La base si está habilitada; si no, la habilitada de menor factor; si ninguna, undefined. */
export const presentacionInicial = <T extends PresentacionPorLado>(list: readonly T[], lado: LadoVenta): T | undefined => {
  const habilitadas = presentacionesDelLado(list, lado)
  return habilitadas.find((p) => p.esBase) ?? [...habilitadas].sort((a, b) => a.factorUnidadBase - b.factorUnidadBase)[0]
}

/** Etiqueta para ProductInfoPopover; null si se vende en ambos lados. */
export const etiquetaDondeSeVende = (p: PresentacionPorLado): string | null => {
  const t = presentacionVendeEnLado(p, 'tienda')
  const a = presentacionVendeEnLado(p, 'almacen')
  if (t && a) return null
  if (t) return 'Solo tienda'
  if (a) return 'Solo almacén'
  return 'No se vende'
}

export const mensajeSinPresentacion = (lado: LadoVenta): string =>
  lado === 'tienda' ? 'Este producto no se vende en tienda.' : 'Este producto no se pide en almacén.'

export const mensajePresentacionNoDisponible = (nombre: string, lado: LadoVenta): string =>
  lado === 'tienda' ? `«${nombre}» no se vende en tienda.` : `«${nombre}» no se pide en almacén.`
