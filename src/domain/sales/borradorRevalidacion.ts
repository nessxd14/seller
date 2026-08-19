import type { CartItem, Product, SalesChannel } from '../../types'
import { getPrice } from '../../data/products'

export interface CambioLinea {
  productId: number
  nombre: string
  tipo: 'eliminado' | 'precio'
  precioAnterior?: number
  precioActual?: number
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/**
 * Brief S1: "el contenido guardado es una foto del momento... hay que revalidar productos
 * y precios contra la base y avisar de las diferencias, no restaurar a ciegas". Nunca
 * pisa `item.precioAplicado` en silencio — solo informa; quien decide es el cajero, con
 * el editor de línea que ya existe.
 */
export const revalidarCarrito = async (
  cart: CartItem[],
  channel: SalesChannel,
  getById: (id: string) => Promise<Product | null>,
): Promise<{ cart: CartItem[]; cambios: CambioLinea[] }> => {
  const cambios: CambioLinea[] = []
  const resultado: CartItem[] = []
  for (const item of cart) {
    // Brief S11 Bloque C: un ítem personalizado no tiene producto de catálogo — nada que revalidar.
    if (item.isCustomItem) { resultado.push(item); continue }
    const actual = await getById(String(item.id))
    if (!actual) {
      cambios.push({ productId: item.id, nombre: item.nombre, tipo: 'eliminado' })
      continue
    }
    const precioActual = roundMoney(getPrice(actual, channel) * (item.factorUnidadBase ?? 1))
    if (!item.precioModificado && Math.abs(precioActual - item.precioAplicado) > 0.001) {
      cambios.push({ productId: item.id, nombre: item.nombre, tipo: 'precio', precioAnterior: item.precioAplicado, precioActual })
    }
    resultado.push(item)
  }
  return { cart: resultado, cambios }
}
