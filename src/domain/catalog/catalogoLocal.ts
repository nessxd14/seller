import type { Product } from '../../types'
import { normalizarBusqueda } from '../customers/textSearch'
import { cleanProductQuery } from './productSearch'
import {
  rowToPresentation, rowToProduct, singlePresentation,
  type LineIdentifiers, type Presentation, type PresentacionRow, type ProductoRow, type ResolverRow, type ScannedPresentation,
} from './mapeoProducto'

// Índice del catálogo activo en memoria. Funciones puras: sin Supabase, sin estado global.
// El cargador (infrastructure/supabase/CatalogoLocal.supabase.ts) lo construye una vez y el
// repositorio responde búsqueda, presentaciones, identificadores y códigos desde acá.

export interface FilaPresentacionCatalogo extends PresentacionRow { producto_id: number }

export interface FilaIdentificador { id: number; presentacion_id: number; tipo: string; valor: string; es_principal: boolean | null }

interface InfoPresentacion { productoId: number; nombre: string; factor: number }
interface FilaCodigo { presentacionId: number; esPrincipal: boolean }

interface EntradaBusqueda {
  readonly id: number
  readonly nombre: string
  readonly nombreNormalizado: string
  readonly texto: string
  /** SKU y todos los códigos barra/fábrica activos, en minúsculas, para el match exacto. */
  readonly codigos: ReadonlySet<string>
}

export interface IndiceCatalogo {
  readonly productos: ReadonlyMap<number, Product>
  /** Ordenado por nombre (es) y luego id: la búsqueda solo filtra y reparte en grupos. */
  readonly entradas: readonly EntradaBusqueda[]
  readonly presentaciones: ReadonlyMap<number, readonly Presentation[]>
  readonly identificadoresLinea: ReadonlyMap<number, LineIdentifiers>
  readonly filasPorCodigo: ReadonlyMap<string, readonly FilaCodigo[]>
  readonly presentacionAProducto: ReadonlyMap<number, InfoPresentacion>
  readonly productoPorSku: ReadonlyMap<string, number>
}

export interface DatosCatalogo {
  productos: readonly ProductoRow[]
  presentaciones: readonly FilaPresentacionCatalogo[]
  identificadores: readonly FilaIdentificador[]
}

const TIPOS_CODIGO_VISIBLE = ['barra', 'fabrica']

const agrupar = <K, V>(items: readonly V[], clave: (item: V) => K): Map<K, V[]> => {
  const mapa = new Map<K, V[]>()
  for (const item of items) {
    const lista = mapa.get(clave(item))
    if (lista) lista.push(item)
    else mapa.set(clave(item), [item])
  }
  return mapa
}

const porPrincipalYPresentacion = (a: FilaCodigo, b: FilaCodigo) =>
  Number(b.esPrincipal) - Number(a.esPrincipal) || a.presentacionId - b.presentacionId

export const construirIndice = ({ productos, presentaciones, identificadores }: DatosCatalogo): IndiceCatalogo => {
  const presOrdenadas = [...presentaciones].sort((a, b) => a.presentacion_id - b.presentacion_id)
  const presPorProducto = agrupar(presOrdenadas, (fila) => fila.producto_id)
  const idsPorPresentacion = agrupar(
    [...identificadores].sort((a, b) => Number(Boolean(b.es_principal)) - Number(Boolean(a.es_principal)) || a.id - b.id),
    (fila) => fila.presentacion_id,
  )

  const presentacionAProducto = new Map<number, InfoPresentacion>()
  for (const fila of presOrdenadas) {
    presentacionAProducto.set(fila.presentacion_id, { productoId: fila.producto_id, nombre: fila.nombre, factor: Number(fila.factor_unidad_base) || 1 })
  }

  const filasPorCodigo = new Map<string, FilaCodigo[]>()
  for (const fila of identificadores) {
    const lista = filasPorCodigo.get(fila.valor) ?? []
    lista.push({ presentacionId: fila.presentacion_id, esPrincipal: Boolean(fila.es_principal) })
    filasPorCodigo.set(fila.valor, lista)
  }
  filasPorCodigo.forEach((lista) => lista.sort(porPrincipalYPresentacion))

  const mapaProductos = new Map<number, Product>()
  const mapaPresentaciones = new Map<number, Presentation[]>()
  const mapaLinea = new Map<number, LineIdentifiers>()
  const productoPorSku = new Map<string, number>()
  const entradas: EntradaBusqueda[] = []

  for (const fila of productos) {
    const presDelProducto = presPorProducto.get(fila.id) ?? []
    // Presentación base para los códigos visibles: igual que fetchBarcodeCodes, la última
    // fila es_base gana; dentro de ella el primer barra/fábrica (es_principal primero).
    const base = presDelProducto.filter((pres) => pres.es_base).at(-1)
    const codigosBase: { barra?: string; fabrica?: string } = {}
    for (const ident of base ? idsPorPresentacion.get(base.presentacion_id) ?? [] : []) {
      if (ident.tipo === 'barra' && !codigosBase.barra) codigosBase.barra = ident.valor
      if (ident.tipo === 'fabrica' && !codigosBase.fabrica) codigosBase.fabrica = ident.valor
    }
    const producto = rowToProduct(fila, codigosBase)
    mapaProductos.set(fila.id, producto)
    mapaLinea.set(fila.id, { barra: codigosBase.barra, fabrica: codigosBase.fabrica, marca: fila.marca ?? undefined })
    if (fila.sku_interno) productoPorSku.set(fila.sku_interno, fila.id)

    const activas = presDelProducto.filter((pres) => pres.activo !== false)
    mapaPresentaciones.set(fila.id, [...activas].sort((a, b) => Number(b.es_base) - Number(a.es_base)).map(rowToPresentation))

    const valoresCodigo = presDelProducto
      .flatMap((pres) => idsPorPresentacion.get(pres.presentacion_id) ?? [])
      .filter((ident) => TIPOS_CODIGO_VISIBLE.includes(ident.tipo))
      .map((ident) => ident.valor)
    entradas.push({
      id: fila.id,
      nombre: fila.nombre,
      nombreNormalizado: normalizarBusqueda(fila.nombre),
      texto: normalizarBusqueda([fila.nombre, fila.sku_interno ?? '', fila.marca ?? '', ...valoresCodigo].join(' ')),
      codigos: new Set([producto.sku, ...valoresCodigo].map((valor) => valor.toLocaleLowerCase())),
    })
  }
  entradas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.id - b.id)

  return {
    productos: mapaProductos,
    entradas,
    presentaciones: mapaPresentaciones,
    identificadoresLinea: mapaLinea,
    filasPorCodigo,
    presentacionAProducto,
    productoPorSku,
  }
}

export const buscarEnCatalogo = (
  indice: IndiceCatalogo,
  query: string,
  { page, pageSize }: { page: number; pageSize: number },
): { items: Product[]; total: number } => {
  const limpia = cleanProductQuery(query)
  const normalizada = normalizarBusqueda(limpia)
  const terminos = normalizada.split(/\s+/).filter(Boolean)
  const codigo = limpia.toLocaleLowerCase()
  const exactos: EntradaBusqueda[] = []
  const prefijo: EntradaBusqueda[] = []
  const resto: EntradaBusqueda[] = []
  for (const entrada of indice.entradas) {
    if (!terminos.every((termino) => entrada.texto.includes(termino))) continue
    if (codigo && entrada.codigos.has(codigo)) exactos.push(entrada)
    else if (normalizada && entrada.nombreNormalizado.startsWith(normalizada)) prefijo.push(entrada)
    else resto.push(entrada)
  }
  const ordenados = [...exactos, ...prefijo, ...resto]
  const desde = Math.max(0, (page - 1) * pageSize)
  const items = ordenados.slice(desde, desde + pageSize).map((entrada) => ({ ...(indice.productos.get(entrada.id) as Product) }))
  return { items, total: ordenados.length }
}

export type ResultadoCodigoLocal =
  | { kind: 'found'; productId: number; presentation?: ScannedPresentation }
  | { kind: 'ambiguous'; productIds: number[] }

/**
 * Espejo local de `resolveScannedCode` (RPC `resolver_identificador` + SKU). Devuelve `null`
 * cuando no puede responder con certeza: el llamador usa entonces la red.
 */
export const resolverCodigoLocal = (indice: IndiceCatalogo, codigo: string): ResultadoCodigoLocal | null => {
  // eslint-disable-next-line no-control-regex -- los lectores físicos a veces mandan basura de control antes del Enter
  const code = codigo.trim().replace(/[\x00-\x1F\x7F]/g, '')
  if (!code) return null
  const filas = indice.filasPorCodigo.get(code)
  if (filas?.length) {
    const resueltas: ResolverRow[] = []
    for (const fila of filas) {
      const info = indice.presentacionAProducto.get(fila.presentacionId)
      if (!info) return null
      resueltas.push({ producto_id: info.productoId, presentacion_id: fila.presentacionId, factor_unidad_base: info.factor, presentacion_nombre: info.nombre })
    }
    const productIds = [...new Set(resueltas.map((fila) => fila.producto_id))]
    if (productIds.length > 1) return { kind: 'ambiguous', productIds }
    const presentation = singlePresentation(resueltas)
    return presentation ? { kind: 'found', productId: productIds[0], presentation } : { kind: 'found', productId: productIds[0] }
  }
  const porSku = indice.productoPorSku.get(code)
  return porSku != null ? { kind: 'found', productId: porSku } : null
}
