import { supabase } from './supabaseClient'
import { cambiosParaServidor } from '../../domain/orders/edicionPedido'
import type {
  AccionAviso, CambioPedido, LineaTiempo, PedidoDetalle, PedidoEdicionPort, PrevisualizacionEdicion, ResultadoEdicion, ResumenPedido,
} from '../../domain/orders/pedidoEdicion.types'

// Brief "Seller: edición de pedido" §3 — Cation y Hermes comparten base, así que estas RPC se
// llaman directo (no por api/hermes/*). Las reglas de negocio (quién edita, qué precio se
// puede tocar, qué pasa con lo ya alistado) las decide el servidor y llegan por `permisos`,
// `precio_bloqueado`, `advertencias` y los códigos de error: nada de eso se replica acá.

export type CodigoErrorEdicion =
  | 'VERSION_CAMBIADA' | 'MOTIVO_REQUERIDO' | 'CANTIDAD_BAJO_DESPACHADO' | 'ITEM_CON_DESPACHO' | 'PARTIR_NO_CUADRA'
  | 'PRECIO_REQUIERE_AUTORIZACION' | 'CLIENTE_CON_PAGOS' | 'SIN_PERMISO' | 'PEDIDO_NO_EDITABLE'

const MENSAJES: Record<CodigoErrorEdicion, string> = {
  VERSION_CAMBIADA: 'Almacén o alguien más cambió el pedido. Recarga para ver la versión nueva; tus cambios se intentarán reaplicar.',
  MOTIVO_REQUERIDO: 'Escribe el motivo del cambio.',
  CANTIDAD_BAJO_DESPACHADO: 'No puedes bajar de lo ya despachado.',
  ITEM_CON_DESPACHO: 'Ese ítem ya tiene unidades despachadas: usa Cerrar saldo.',
  PARTIR_NO_CUADRA: 'Las partes no suman la cantidad del ítem.',
  PRECIO_REQUIERE_AUTORIZACION: 'Cambiar el precio de lo ya despachado o pagado requiere autorización.',
  CLIENTE_CON_PAGOS: 'El cliente no se puede cambiar: la partida tiene pagos.',
  SIN_PERMISO: 'No tienes permiso para editar este pedido.',
  PEDIDO_NO_EDITABLE: 'Este pedido ya no se puede editar.',
}

export const mapErrorEdicion = (codigo: string): string => MENSAJES[codigo as CodigoErrorEdicion] ?? 'No se pudo completar la edición del pedido.'

export class EdicionPedidoError extends Error {
  constructor(readonly codigo: CodigoErrorEdicion | 'DESCONOCIDO', message: string) { super(message); this.name = 'EdicionPedidoError' }
}

const CODIGOS = Object.keys(MENSAJES) as CodigoErrorEdicion[]

/** El código llega en el mensaje (RAISE EXCEPTION 'CODIGO'), en `hint` o en `details`. */
export const extraerCodigoEdicion = (error: { message?: string; hint?: string | null; details?: string | null }): CodigoErrorEdicion | null => {
  const texto = `${error.message ?? ''} ${error.hint ?? ''} ${error.details ?? ''}`
  return CODIGOS.find((codigo) => texto.includes(codigo)) ?? null
}

const lanzar = (error: { message?: string; hint?: string | null; details?: string | null }): never => {
  const codigo = extraerCodigoEdicion(error)
  if (codigo) throw new EdicionPedidoError(codigo, mapErrorEdicion(codigo))
  throw new EdicionPedidoError('DESCONOCIDO', error.message || mapErrorEdicion(''))
}

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) return lanzar(error)
  return data as T
}

// PostgREST corta en silencio a 1.000 filas: por eso el resumen de la lista pasa por una RPC
// en tandas de hasta 200 ids, nunca por una lectura directa de tablas.
const TANDA_RESUMEN = 200

export const pedidoEdicionSupabase: PedidoEdicionPort = {
  detalle: (pedidoId) => rpc<PedidoDetalle>('pedido_detalle', { p_pedido_id: pedidoId }),
  previsualizar: (pedidoId, versionEsperada, cambios) =>
    rpc<PrevisualizacionEdicion>('previsualizar_edicion_pedido', { p_pedido_id: pedidoId, p_version_esperada: versionEsperada, p_cambios: cambiosParaServidor(cambios) }),
  editar: (pedidoId, versionEsperada, cambios: CambioPedido[], motivo) =>
    rpc<ResultadoEdicion>('editar_pedido', { p_pedido_id: pedidoId, p_version_esperada: versionEsperada, p_cambios: cambiosParaServidor(cambios), p_motivo: motivo }),
  async resolverAviso(avisoId: number, accion: AccionAviso) {
    await rpc('resolver_aviso_pedido', { p_aviso_id: avisoId, p_accion: accion })
  },
  lineaTiempo: (pedidoId) => rpc<LineaTiempo>('linea_tiempo_pedido', { p_pedido_id: pedidoId }),
  async comentar(pedidoId, texto) {
    await rpc('comentar_pedido', { p_pedido_id: pedidoId, p_texto: texto })
  },
  async resumenPedidos(ids) {
    const resultado: ResumenPedido[] = []
    for (let i = 0; i < ids.length; i += TANDA_RESUMEN) {
      const filas = await rpc<ResumenPedido[] | null>('resumen_pedidos', { p_ids: ids.slice(i, i + TANDA_RESUMEN) })
      resultado.push(...(filas ?? []))
    }
    return resultado
  },
}
