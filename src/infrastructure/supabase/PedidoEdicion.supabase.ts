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
  | 'PARTIDA_DESFASADA' | 'REDUCCION_BAJO_PAGADO'
  | 'ITEM_INVALIDO' | 'CANTIDAD_INVALIDA' | 'PRECIO_INVALIDO' | 'DESCUENTO_INVALIDO' | 'DESCRIPCION_REQUERIDA'
  | 'PRODUCTO_INVALIDO' | 'PRESENTACION_INVALIDA'
  | 'SIN_SALDO' | 'SIN_FALTANTE' | 'TOTAL_NEGATIVO' | 'OP_INVALIDA' | 'CAMBIOS_INVALIDOS'
  | 'AVISO_INVALIDO' | 'AVISO_RESUELTO' | 'SUSTITUTO_DESPACHADO' | 'ACCION_INVALIDA'
  | 'PEDIDO_NO_ENCONTRADO' | 'IDS_INVALIDOS' | 'COMENTARIO_INVALIDO'

// Mensajes de respaldo: el servidor ya manda su propio texto en español (más específico, nombra
// el producto y las cantidades) y ese es el que se muestra; esto solo cubre un mensaje vacío.
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
  PARTIDA_DESFASADA: 'La cuenta del cliente en Hermes no coincide con el total del pedido. Corrígela en Hermes antes de editar.',
  REDUCCION_BAJO_PAGADO: 'La edición dejaría el pedido por debajo de lo ya pagado o entregado. Resuélvelo en Hermes.',
  ITEM_INVALIDO: 'El ítem no existe en el pedido.',
  CANTIDAD_INVALIDA: 'La cantidad debe ser mayor que cero.',
  PRECIO_INVALIDO: 'Indica un precio válido.',
  DESCUENTO_INVALIDO: 'El descuento debe estar entre 0 y 100.',
  DESCRIPCION_REQUERIDA: 'El ítem personalizado necesita una descripción.',
  PRODUCTO_INVALIDO: 'El producto no existe.',
  PRESENTACION_INVALIDA: 'La presentación no pertenece al producto.',
  SIN_SALDO: 'Ese ítem ya no tiene saldo por entregar.',
  SIN_FALTANTE: 'Ese ítem no tiene cantidad sin cubrir.',
  TOTAL_NEGATIVO: 'El total del pedido no puede quedar negativo.',
  OP_INVALIDA: 'Operación de edición desconocida.',
  CAMBIOS_INVALIDOS: 'La lista de cambios no es válida.',
  AVISO_INVALIDO: 'El aviso no existe.',
  AVISO_RESUELTO: 'El aviso ya fue resuelto.',
  SUSTITUTO_DESPACHADO: 'El sustituto ya salió: no se puede rechazar.',
  ACCION_INVALIDA: 'Esa acción no aplica a este aviso.',
  PEDIDO_NO_ENCONTRADO: 'El pedido no existe.',
  IDS_INVALIDOS: 'Lista de pedidos inválida.',
  COMENTARIO_INVALIDO: 'Escribe el comentario.',
}

export const mapErrorEdicion = (codigo: string): string => MENSAJES[codigo as CodigoErrorEdicion] ?? 'No se pudo completar la edición del pedido.'

export class EdicionPedidoError extends Error {
  constructor(readonly codigo: CodigoErrorEdicion | 'DESCONOCIDO', message: string) { super(message); this.name = 'EdicionPedidoError' }
}

const CODIGOS = new Set<string>(Object.keys(MENSAJES))

/** El servidor manda el código en `error.hint` y el texto en español en `error.message`. */
export const extraerCodigoEdicion = (error: { hint?: string | null }): CodigoErrorEdicion | null => {
  const hint = error.hint?.trim()
  return hint && CODIGOS.has(hint) ? (hint as CodigoErrorEdicion) : null
}

const lanzar = (error: { message?: string; hint?: string | null }): never => {
  const hint = error.hint?.trim() ?? ''
  const codigo = extraerCodigoEdicion(error)
  // Se prefiere el mensaje del servidor; el local solo cubre un mensaje vacío.
  throw new EdicionPedidoError(codigo ?? 'DESCONOCIDO', error.message || mapErrorEdicion(hint))
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
