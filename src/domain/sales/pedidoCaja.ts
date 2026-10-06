// Caja — verificación y cobro de un pedido de vendedor. Lógica pura, sin React ni red.
// Los precios se manejan en centavos; el payload sale en bolivianos con el mismo formato que
// buildVentaLineas produce para registrar_venta.
import type { PedidoCobroLineaPayload, PedidoCobroQuitadaPayload, PedidoVendedorRecord } from '../../application/shared/models'
import { SUCURSAL_TIENDA_ID } from '../../infrastructure/supabase/mappers'
import { precioMinimoLocal, precioSugerido, type PresentacionPiso, type ProductoPiso } from './pedidoPiso'

export interface LineaCaja {
  /** Clave local estable (React key). Para líneas del pedido deriva del linea_id, estable desde que la caja toma el pedido. */
  key: string
  /** null = producto agregado en caja. */
  pedidoLineaId: string | null
  productoId: number | null
  nombre: string
  sku: string | null
  /** null = unidad base. */
  presentacionId: number | null
  presentacionNombre: string | null
  esBase: boolean
  factor: number
  esPersonalizado: boolean
  unidadMedida: string | null
  cantidad: number
  precioCents: number
  /** Lo que dejó el vendedor, solo para mostrar. */
  cantidadVendedor: number | null
  precioVendedorCents: number | null
  precioListaCents: number | null
  /** Precio base de catálogo (por unidad base): para sugerir al cambiar de presentación. */
  precioRetailCents: number | null
  /** Mínimo vigente para esta línea (lista − 10 %); null si no aplica (paquetes, sin precio, personalizados). */
  precioMinimoCents: number | null
  verificada: boolean
  quitada: boolean
  motivoQuitada?: string
  motivoDescuento?: string
  agregada: boolean
}

const aCents = (bs: number | null | undefined): number | null => (bs == null ? null : Math.round(bs * 100))

/** Lector de códigos con teclado en inglés: en distribución española el guion llega como apóstrofo. */
export const parsearCodigoPedido = (text: string): string | null => {
  const m = /^PDV\D?(\d+)$/i.exec(text.trim())
  return m ? m[1] : null
}

export const lineasDesdePedido = (pedido: PedidoVendedorRecord): LineaCaja[] =>
  [...pedido.lineas].sort((a, b) => a.orden - b.orden).map((l): LineaCaja => ({
    key: `pl-${l.lineaId}`, pedidoLineaId: l.lineaId, productoId: l.productoId, nombre: l.nombre, sku: l.sku,
    presentacionId: l.esBase ? null : l.presentacionId, presentacionNombre: l.esBase ? null : l.presentacion, esBase: l.esBase, factor: l.factor || 1,
    esPersonalizado: l.esPersonalizado, unidadMedida: l.unidadMedida, cantidad: l.cantidad, precioCents: aCents(l.precioUnitario) ?? 0,
    cantidadVendedor: l.cantidad, precioVendedorCents: aCents(l.precioUnitario), precioListaCents: aCents(l.precioLista),
    precioRetailCents: l.esPersonalizado || l.precioLista == null ? null : Math.round((l.precioLista * 100) / (l.factor || 1)),
    precioMinimoCents: aCents(l.precioMinimo), verificada: false, quitada: false, agregada: false,
  }))

/** Producto agregado en caja: cantidad 1, unidad base, precio de catálogo; ya nace verificado (lo puso el cajero). */
export const lineaAgregada = (product: ProductoPiso, key: string): LineaCaja => {
  const minimo = precioMinimoLocal(product.precioRetail, true)
  return {
    key, pedidoLineaId: null, productoId: product.id, nombre: product.nombre, sku: product.sku || null, presentacionId: null, presentacionNombre: null,
    esBase: true, factor: 1, esPersonalizado: false, unidadMedida: null, cantidad: 1, precioCents: aCents(product.precioRetail) ?? 0,
    cantidadVendedor: null, precioVendedorCents: null, precioListaCents: aCents(product.precioRetail > 0 ? product.precioRetail : null),
    precioRetailCents: aCents(product.precioRetail > 0 ? product.precioRetail : null), precioMinimoCents: aCents(minimo),
    verificada: true, quitada: false, agregada: true,
  }
}

export type ResultadoVerificacion = 'verificada' | 'ya_verificada' | 'no_esta'

/**
 * Escaneo de un producto: marca la primera línea sin verificar que coincida, prefiriendo la misma
 * presentación (`presentacionId` null = base; undefined = sin preferencia).
 */
export const verificarPorEscaneo = (lineas: LineaCaja[], productoId: number, presentacionId?: number | null): { lineas: LineaCaja[]; resultado: ResultadoVerificacion } => {
  const candidatas = lineas.filter((l) => !l.quitada && !l.esPersonalizado && l.productoId === productoId)
  if (!candidatas.length) return { lineas, resultado: 'no_esta' }
  const pendientes = candidatas.filter((l) => !l.verificada)
  if (!pendientes.length) return { lineas, resultado: 'ya_verificada' }
  const elegida = (presentacionId !== undefined && pendientes.find((l) => l.presentacionId === presentacionId)) || pendientes[0]
  return { lineas: lineas.map((l) => (l.key === elegida.key ? { ...l, verificada: true } : l)), resultado: 'verificada' }
}

/** El precio final está por debajo del mínimo de la línea: el cajero no tiene piso, pero debe dar el motivo. */
export const necesitaMotivo = (l: LineaCaja): boolean => !l.quitada && l.precioMinimoCents != null && l.precioCents < l.precioMinimoCents

export const totalLineaCents = (l: LineaCaja): number => Math.round(l.precioCents * l.cantidad)
export const totalCents = (lineas: LineaCaja[]): number => lineas.filter((l) => !l.quitada).reduce((sum, l) => sum + totalLineaCents(l), 0)
/** Total que armó el vendedor, para compararlo con el actual. */
export const totalVendedorCents = (lineas: LineaCaja[]): number =>
  lineas.filter((l) => l.pedidoLineaId != null).reduce((sum, l) => sum + Math.round((l.precioVendedorCents ?? 0) * (l.cantidadVendedor ?? 0)), 0)

/** Razones por las que todavía no se puede cobrar (la primera sirve de ayuda en el botón). */
export const bloqueos = (lineas: LineaCaja[]): string[] => {
  const vivas = lineas.filter((l) => !l.quitada)
  const razones: string[] = []
  const sinVerificar = vivas.filter((l) => !l.verificada).length
  if (sinVerificar) razones.push(`Faltan ${sinVerificar} línea${sinVerificar > 1 ? 's' : ''} por verificar o quitar`)
  const sinMotivo = vivas.filter((l) => necesitaMotivo(l) && !(l.motivoDescuento ?? '').trim()).length
  if (sinMotivo) razones.push(`Falta el motivo del descuento en ${sinMotivo} línea${sinMotivo > 1 ? 's' : ''}`)
  if (!vivas.length) razones.push('No queda ningún producto en el pedido')
  else if (totalCents(lineas) <= 0) razones.push('El total es cero')
  return razones
}

// ── Ediciones: cualquier cambio de cantidad o precio deja la línea verificada ─────────────────
export const editarCantidad = (l: LineaCaja, cantidad: number): LineaCaja => ({ ...l, cantidad, verificada: true })
export const editarPrecio = (l: LineaCaja, precioCents: number): LineaCaja => ({ ...l, precioCents: Math.round(precioCents), verificada: true })
export const verificarLinea = (l: LineaCaja, verificada = true): LineaCaja => ({ ...l, verificada })
export const quitarLinea = (l: LineaCaja, motivo?: string): LineaCaja => ({ ...l, quitada: true, motivoQuitada: motivo || undefined })
export const restaurarLinea = (l: LineaCaja): LineaCaja => ({ ...l, quitada: false, motivoQuitada: undefined })

/** Cambiar de presentación reinicia el precio al sugerido y recalcula el mínimo con precioMinimoLocal. */
export const cambiarPresentacionCaja = (l: LineaCaja, p: PresentacionPiso): LineaCaja => {
  const base = p.esBase || p.factorUnidadBase === 1
  const factor = base ? 1 : p.factorUnidadBase
  const retail = l.precioRetailCents != null ? l.precioRetailCents / 100 : null
  const sugerido = precioSugerido(retail, factor)
  return {
    ...l, presentacionId: base ? null : p.id, presentacionNombre: base ? null : p.nombre, esBase: base, factor,
    precioCents: aCents(sugerido) ?? 0, precioListaCents: aCents(sugerido), precioMinimoCents: aCents(precioMinimoLocal(retail, base)),
    motivoDescuento: undefined, verificada: true,
  }
}

/**
 * Payload de cobrar_pedido_vendedor: toda línea del pedido aparece una sola vez, en `lineas` (con
 * pedido_linea_id y verificada) o en `quitadas`. Una línea agregada en caja que se quitó se descarta.
 */
export const construirCobro = (lineas: LineaCaja[]): { lineas: PedidoCobroLineaPayload[]; quitadas: PedidoCobroQuitadaPayload[]; totalCents: number } => {
  const payload: PedidoCobroLineaPayload[] = []
  const quitadas: PedidoCobroQuitadaPayload[] = []
  for (const l of lineas) {
    if (l.quitada) {
      if (l.pedidoLineaId != null) quitadas.push({ pedido_linea_id: Number(l.pedidoLineaId), ...(l.motivoQuitada ? { motivo: l.motivoQuitada } : {}) })
      continue
    }
    const origen: Partial<PedidoCobroLineaPayload> = l.pedidoLineaId != null ? { pedido_linea_id: Number(l.pedidoLineaId), verificada: true } : {}
    const motivo = necesitaMotivo(l) && l.motivoDescuento?.trim() ? { motivo_descuento: l.motivoDescuento.trim() } : {}
    const precio = l.precioCents / 100
    if (l.esPersonalizado) {
      payload.push({ es_personalizado: true, descripcion: l.nombre, unidad_medida: l.unidadMedida || 'UNIDAD', cantidad_base: l.cantidad, precio_unitario: precio, ...origen })
    } else {
      payload.push({
        producto_id: l.productoId as number,
        ...(l.presentacionId != null ? { presentacion_id: l.presentacionId, cantidad_presentacion: l.cantidad } : { cantidad_base: l.cantidad }),
        precio_unitario: precio, sucursal_origen_id: SUCURSAL_TIENDA_ID, ...origen, ...motivo,
      })
    }
  }
  return { lineas: payload, quitadas, totalCents: totalCents(lineas) }
}

export const minutosEsperando = (enviadoEn: string | null, ahora: number = Date.now()): number | null =>
  enviadoEn ? Math.max(0, Math.floor((ahora - new Date(enviadoEn).getTime()) / 60000)) : null
