// Piso — lógica pura del pedido que el vendedor arma en su teléfono. Sin React ni red:
// todo lo que decide precios, totales y qué se manda al servidor vive acá y se prueba aparte.
import type { PedidoVendedorEstado, PedidoVendedorLineaInput, PedidoVendedorRecord } from '../../application/shared/models'

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

/** Mismo porcentaje que aplica el servidor: lista menos 10 %. */
export const DESCUENTO_MAXIMO = 0.1

/** Ventana en la que el escáner ignora una lectura repetida del mismo código. */
export const VENTANA_DEDUP_MS = 1500

export interface LineaPiso {
  /** Id local estable (React key). Nunca el linea_id del servidor: cambia en cada guardado. */
  localId: string
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
  /** Precio de lista de la unidad base del catálogo (para sugerir el de otras presentaciones). */
  precioRetail: number | null
  /** Lista y mínimo de ESTA línea según el servidor (se actualizan en cada guardado). */
  precioLista: number | null
  precioMinimo: number | null
  /** null = todavía sin precio (producto sin precio de lista: el vendedor lo propone). */
  precioUnitario: number | null
  /** Último precio que el servidor aceptó; a él se vuelve si rechaza uno por debajo del mínimo. */
  precioGuardado: number | null
  /** Mensaje del servidor para esta línea (p. ej. 23514). */
  error?: string
}

export interface PedidoLocal {
  clave: string
  pedidoId: string | null
  codigo: string | null
  numeroDia: number | null
  estado: PedidoVendedorEstado
  lineas: LineaPiso[]
  nota: string | null
  /** Se incrementa en cada cambio local; sirve para descartar respuestas viejas. */
  revision: number
  /** Última revisión confirmada por el servidor. revision !== guardadoRevision ⇒ hay cambios sin guardar. */
  guardadoRevision: number
  /** Se pausa tras un 23514: no se reintenta solo hasta el próximo cambio del vendedor. */
  pausado?: boolean
  creadoEn: string
  snapshot: PedidoVendedorRecord | null
}

export interface ProductoPiso { id: number; nombre: string; sku: string; precioRetail: number }
export interface PresentacionPiso { id: number; nombre: string; factorUnidadBase: number; esBase: boolean }

/** Piso de precio (lista − 10 %) solo para unidad base con precio de catálogo; el servidor lo confirma al guardar. */
export const precioMinimoLocal = (precioRetail: number | null | undefined, esBase: boolean): number | null =>
  esBase && precioRetail != null && precioRetail > 0 ? round2(precioRetail * (1 - DESCUENTO_MAXIMO)) : null

/** Mismo cálculo que CartItem al cambiar de presentación: precio base × factor. */
export const precioSugerido = (precioRetail: number | null | undefined, factor: number): number | null =>
  precioRetail != null && precioRetail > 0 ? round2(precioRetail * factor) : null

/** ¿Este precio viola el mínimo conocido? (solo informa; el servidor decide). */
export const bajoElMinimo = (precio: number, minimo: number | null): boolean => minimo != null && round2(precio) < minimo

const esBasePresentacion = (p?: PresentacionPiso): boolean => !p || p.esBase || p.factorUnidadBase === 1
const claveLinea = (l: Pick<LineaPiso, 'productoId' | 'presentacionId' | 'esPersonalizado'>) => `${l.productoId}|${l.presentacionId ?? 'base'}`

export const nuevaLinea = (product: ProductoPiso, presentation: PresentacionPiso | undefined, localId: string): LineaPiso => {
  const base = esBasePresentacion(presentation)
  const factor = base ? 1 : presentation!.factorUnidadBase
  const precio = precioSugerido(product.precioRetail, factor)
  return {
    localId, productoId: product.id, nombre: product.nombre, sku: product.sku || null,
    presentacionId: base ? null : presentation!.id, presentacionNombre: base ? null : presentation!.nombre, esBase: base, factor,
    esPersonalizado: false, unidadMedida: null, cantidad: 1,
    precioRetail: product.precioRetail > 0 ? product.precioRetail : null,
    precioLista: precio, precioMinimo: precioMinimoLocal(product.precioRetail, base),
    precioUnitario: precio, precioGuardado: null,
  }
}

/** Mismo producto y misma presentación suma 1 a la cantidad; si no, línea nueva al final. */
export const agregarProducto = (lineas: LineaPiso[], product: ProductoPiso, presentation: PresentacionPiso | undefined, localId: string): LineaPiso[] => {
  const nueva = nuevaLinea(product, presentation, localId)
  const i = lineas.findIndex((l) => !l.esPersonalizado && claveLinea(l) === claveLinea(nueva))
  if (i < 0) return [...lineas, nueva]
  return lineas.map((l, idx) => (idx === i ? { ...l, cantidad: round2(l.cantidad + 1) } : l))
}

export const agregarPersonalizado = (lineas: LineaPiso[], input: { descripcion: string; unidadMedida: string; cantidad: number; precio: number }, localId: string): LineaPiso[] => [
  ...lineas,
  {
    localId, productoId: null, nombre: input.descripcion.trim(), sku: null, presentacionId: null, presentacionNombre: null, esBase: true, factor: 1,
    esPersonalizado: true, unidadMedida: input.unidadMedida, cantidad: input.cantidad, precioRetail: null, precioLista: null, precioMinimo: null,
    precioUnitario: input.precio, precioGuardado: null,
  },
]

/** Cambia de presentación: el precio vuelve a ser el sugerido (precio base × factor) y el mínimo solo existe en unidad base. */
export const cambiarPresentacion = (linea: LineaPiso, presentation: PresentacionPiso): LineaPiso => {
  const base = esBasePresentacion(presentation)
  const factor = base ? 1 : presentation.factorUnidadBase
  const precio = precioSugerido(linea.precioRetail, factor)
  return {
    ...linea, presentacionId: base ? null : presentation.id, presentacionNombre: base ? null : presentation.nombre, esBase: base, factor,
    precioLista: precio, precioMinimo: precioMinimoLocal(linea.precioRetail, base), precioUnitario: precio, error: undefined,
  }
}

export const totalPedido = (lineas: LineaPiso[]): { total: number; sinPrecio: number } => {
  let total = 0
  let sinPrecio = 0
  for (const l of lineas) {
    if (l.precioUnitario == null || l.precioUnitario <= 0) sinPrecio++
    else total += round2(l.precioUnitario * l.cantidad)
  }
  return { total: round2(total), sinPrecio }
}

/** p_lineas: en catálogo el precio se omite mientras no exista (el servidor usa la lista); el personalizado siempre lo lleva. */
export const aLineasPayload = (lineas: LineaPiso[]): PedidoVendedorLineaInput[] =>
  lineas.map((l): PedidoVendedorLineaInput => l.esPersonalizado
    ? { esPersonalizado: true, descripcion: l.nombre, unidadMedida: l.unidadMedida || 'UNIDAD', cantidad: l.cantidad, precioUnitario: l.precioUnitario ?? 0 }
    : { productoId: l.productoId as number, presentacionId: l.presentacionId, cantidad: l.cantidad, ...(l.precioUnitario != null ? { precioUnitario: l.precioUnitario } : {}) })

export type LecturasRecientes = Record<string, number>

/** De-duplicación del escáner: el mismo valor se ignora VENTANA_DEDUP_MS después de aceptado. */
export const aceptarLectura = (recientes: LecturasRecientes, code: string, now: number, ventana: number = VENTANA_DEDUP_MS): { aceptada: boolean; recientes: LecturasRecientes } => {
  const vigentes: LecturasRecientes = {}
  for (const [valor, at] of Object.entries(recientes)) if (now - at < ventana) vigentes[valor] = at
  if (code in vigentes) return { aceptada: false, recientes: vigentes }
  return { aceptada: true, recientes: { ...vigentes, [code]: now } }
}

/**
 * Aplica la respuesta del servidor al pedido local. Los datos del pedido (id, código, número del
 * día, estado) siempre se aplican; lista, mínimo y precio aceptado por línea —que se asignan por
 * `orden`, nunca por linea_id— solo si el vendedor no cambió nada desde que se envió la petición.
 */
export const fusionarRespuesta = (local: PedidoLocal, server: PedidoVendedorRecord, revision: number): PedidoLocal => {
  const base: PedidoLocal = { ...local, pedidoId: server.pedidoId, codigo: server.codigo, numeroDia: server.numeroDia, estado: server.estado, snapshot: server }
  if (local.revision !== revision) return base
  const porOrden = new Map(server.lineas.map((l) => [l.orden, l]))
  return {
    ...base,
    guardadoRevision: revision,
    lineas: local.lineas.map((l, i) => {
      const s = porOrden.get(i + 1)
      if (!s) return l
      return { ...l, precioLista: s.precioLista, precioMinimo: s.precioMinimo, precioGuardado: s.precioUnitario, error: undefined }
    }),
  }
}

/** Reconstruye un pedido local desde el servidor (otro teléfono o storage borrado). */
export const pedidoDesdeServidor = (server: PedidoVendedorRecord, clave: string, nuevoId: () => string): PedidoLocal => ({
  clave, pedidoId: server.pedidoId, codigo: server.codigo, numeroDia: server.numeroDia, estado: server.estado, nota: server.nota,
  revision: 0, guardadoRevision: 0, creadoEn: server.enviadoEn ?? new Date().toISOString(), snapshot: server,
  lineas: [...server.lineas].sort((a, b) => a.orden - b.orden).map((l): LineaPiso => ({
    localId: nuevoId(), productoId: l.productoId, nombre: l.nombre, sku: l.sku, presentacionId: l.esBase ? null : l.presentacionId,
    presentacionNombre: l.esBase ? null : l.presentacion, esBase: l.esBase, factor: l.factor, esPersonalizado: l.esPersonalizado,
    unidadMedida: l.unidadMedida, cantidad: l.cantidad,
    precioRetail: l.esPersonalizado ? null : l.precioLista != null ? round2(l.precioLista / (l.factor || 1)) : null,
    precioLista: l.precioLista, precioMinimo: l.precioMinimo, precioUnitario: l.precioUnitario > 0 ? l.precioUnitario : null, precioGuardado: l.precioUnitario,
  })),
})

/** ¿Se puede enviar? Al menos una línea y todas con precio > 0. */
export const puedeEnviar = (lineas: LineaPiso[]): boolean => lineas.length > 0 && lineas.every((l) => l.precioUnitario != null && l.precioUnitario > 0 && l.cantidad > 0)

export const hayCambiosSinGuardar = (p: PedidoLocal): boolean => p.revision !== p.guardadoRevision

/** Error de red (sin código de Postgres) ⇒ reintentar; cualquier otro lo rechazó el servidor. */
export const esErrorDeRed = (error: unknown): boolean => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return !(typeof code === 'string' && code.length > 0)
}

export const CODIGO_PRECIO_MINIMO = '23514'
