// Contrato de la pantalla del cliente (tablet frente al cliente). Lo comparten el emisor
// (el Seller del cajero) y la tablet: los dos importan estos tipos y nada más.
//
// Transporte: Supabase Realtime broadcast en un canal privado. Siempre viaja el snapshot
// completo, nunca deltas: una tablet que se reconecta queda al día con el siguiente mensaje.
import { netUnitPriceCents, ventaLineTotalCents } from '../sales/ventaPricing'

export const PANTALLA_TOPIC = (cajaId: number) => `pantalla:caja:${cajaId}`
export const PANTALLA_EVENT = 'estado'

export type PantallaFase = 'reposo' | 'venta' | 'cobro' | 'gracias'

export interface PantallaLinea {
  key: string                 // estable por línea del carrito (id del ítem como texto)
  nombre: string
  presentacion: string        // mismo texto que muestra el carrito para la presentación elegida
  cantidad: number
  precioUnitario: number      // Bs, neto del descuento de línea, 2 decimales
  subtotal: number            // Bs, IGUAL a lo que Caja cobra por esa línea
  imagenUrl: string | null    // URL pública del bucket producto_imagenes; null si no hay
}

export interface PantallaCobro {
  metodo: 'efectivo' | 'qr' | 'transferencia' | 'mixto'
  recibido?: number           // efectivo
  cambio?: number             // efectivo
  efectivo?: number           // mixto
  digital?: number            // mixto (parte QR o transferencia)
}

export type PantallaCambio = 'agregado' | 'cantidad' | 'quitado'

export interface PantallaEstado {
  v: 1
  seq: number                 // creciente por pestaña emisora; la tablet ignora un seq menor
  emisorId: string            // id aleatorio por pestaña emisora (una pestaña nueva reinicia el orden)
  cajaId: number
  ts: string                  // ISO
  fase: PantallaFase
  lineas: PantallaLinea[]     // en orden del carrito (la más antigua primero)
  ultimaKey: string | null    // key de la última línea agregada o cambiada
  ultimoCambio: PantallaCambio | null
  unidades: number
  subtotal: number
  descuento: number           // Bs, número positivo
  total: number
  cobro?: PantallaCobro
  ticket?: string             // número VTA que se muestra tras el cobro
}

/** Lo mínimo que se lee de una línea del carrito (CartItem es compatible). */
export interface LineaCarrito {
  id: number
  nombre: string
  cantidad: number
  precioAplicado: number
  descuento: number
  presentacionNombre?: string
  unidadMedida?: string
  isCustomItem?: boolean
  imagenUrl?: string
  imagenMiniaturaUrl?: string
}

export interface ConstruirEstadoEntrada {
  cajaId: number
  seq: number
  emisorId: string
  fase: PantallaFase
  carrito: readonly LineaCarrito[]
  /** `subtotal` y `total` de usePos(): la pantalla nunca recalcula lo que Caja cobra. */
  subtotal: number
  total: number
  ultimaKey?: string | null
  ultimoCambio?: PantallaCambio | null
  cobro?: PantallaCobro
  ticket?: string
  ts?: string
}

const aBs = (centavos: number) => centavos / 100
const redondear = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100

export function construirLineas(carrito: readonly LineaCarrito[]): PantallaLinea[] {
  return carrito.map((item) => ({
    key: String(item.id),
    nombre: item.nombre,
    presentacion: item.presentacionNombre ?? (item.isCustomItem ? item.unidadMedida : undefined) ?? 'Unidad',
    cantidad: item.cantidad,
    // Mismas funciones que usa Caja al cobrar (registrar_venta): sin desajuste de centavos.
    precioUnitario: aBs(netUnitPriceCents(item)),
    subtotal: aBs(ventaLineTotalCents(item)),
    imagenUrl: item.imagenUrl ?? item.imagenMiniaturaUrl ?? null,
  }))
}

export function construirEstado(entrada: ConstruirEstadoEntrada): PantallaEstado {
  const lineas = construirLineas(entrada.carrito)
  const estado: PantallaEstado = {
    v: 1,
    seq: entrada.seq,
    emisorId: entrada.emisorId,
    cajaId: entrada.cajaId,
    ts: entrada.ts ?? new Date().toISOString(),
    fase: entrada.fase,
    lineas,
    ultimaKey: entrada.ultimaKey ?? null,
    ultimoCambio: entrada.ultimoCambio ?? null,
    unidades: lineas.reduce((suma, linea) => suma + linea.cantidad, 0),
    subtotal: entrada.subtotal,
    descuento: Math.max(0, redondear(entrada.subtotal - entrada.total)),
    total: entrada.total,
  }
  if (entrada.cobro) estado.cobro = entrada.cobro
  if (entrada.ticket) estado.ticket = entrada.ticket
  return estado
}

/** Compara el carrito anterior con el nuevo y dice qué línea cambió y cómo. null = sin cambio de líneas. */
export function detectarCambio(
  anterior: readonly PantallaLinea[],
  nuevo: readonly PantallaLinea[],
): { ultimaKey: string; ultimoCambio: PantallaCambio } | null {
  const previas = new Map(anterior.map((linea) => [linea.key, linea]))
  const actuales = new Set(nuevo.map((linea) => linea.key))
  // Una línea agregada gana sobre una cantidad cambiada; se toma la más reciente (última del carrito).
  const agregadas = nuevo.filter((linea) => !previas.has(linea.key))
  if (agregadas.length) return { ultimaKey: agregadas[agregadas.length - 1].key, ultimoCambio: 'agregado' }
  const cambiadas = nuevo.filter((linea) => previas.get(linea.key)?.cantidad !== linea.cantidad)
  if (cambiadas.length) return { ultimaKey: cambiadas[cambiadas.length - 1].key, ultimoCambio: 'cantidad' }
  const quitadas = anterior.filter((linea) => !actuales.has(linea.key))
  if (quitadas.length) return { ultimaKey: quitadas[quitadas.length - 1].key, ultimoCambio: 'quitado' }
  return null
}

const FASES: readonly PantallaFase[] = ['reposo', 'venta', 'cobro', 'gracias']

/** El mensaje viene de la red: solo se acepta lo que cumple el contrato y es de esta caja. */
export function esPantallaEstado(valor: unknown, cajaId: number): valor is PantallaEstado {
  if (!valor || typeof valor !== 'object') return false
  const e = valor as Partial<PantallaEstado>
  return e.v === 1
    && e.cajaId === cajaId
    && typeof e.seq === 'number' && Number.isFinite(e.seq)
    && typeof e.emisorId === 'string' && e.emisorId.length > 0
    && typeof e.fase === 'string' && FASES.includes(e.fase)
    && Array.isArray(e.lineas)
    && typeof e.total === 'number' && typeof e.subtotal === 'number'
}

/**
 * Orden de llegada: dentro del mismo emisor se ignora un seq menor o igual al ya visto;
 * un emisor nuevo (pestaña nueva del cajero) siempre se acepta y reinicia el orden.
 */
export function aceptarEstado(actual: PantallaEstado | null, nuevo: PantallaEstado): boolean {
  if (!actual) return true
  if (actual.emisorId !== nuevo.emisorId) return true
  return nuevo.seq > actual.seq
}
