// Brief "Seller: edición de pedido" — contrato de tipos con las RPC de la migración
// 2026-10-23_pedidos_edicion.sql (pedido_detalle, previsualizar_edicion_pedido,
// editar_pedido, resolver_aviso_pedido, linea_tiempo_pedido, comentar_pedido,
// resumen_pedidos). Los importes viajan en Bs con 2 decimales, tal cual el servidor.
// Sin React ni I/O: lo comparten el dominio, la capa Supabase y el mock.

export type EstadoComercial = 'ABIERTO' | 'CERRADO' | 'CANCELADO'
export type EstadoSurtido = 'SIN_DESPACHAR' | 'PARCIAL' | 'DESPACHADO'
export type EstadoPagoPedido = 'PENDIENTE' | 'PARCIAL' | 'PAGADO'
export type EstadoDevolucion = 'NINGUNA' | 'PARCIAL' | 'TOTAL'
export type TipoSurtido = 'ORIGINAL' | 'PARTIDA' | 'SUSTITUTO' | 'COMPRA'
export type EstadoLineaSurtido = 'DESPACHADA' | 'POR_DESPACHAR' | 'POR_COMPRAR' | 'SIN_CUBRIR' | (string & {})

export interface PedidoCabecera {
  id: number
  numero: string
  version: number
  cliente_id: number | null
  cliente_nombre: string
  categoria: 'TIENDA' | 'MAYOR' | 'INSTITUCIONAL' | 'CORPORATIVO'
  condicion_pago: 'CONTADO' | 'CREDITO' | null
  medio_pago: string | null
  referencia: string | null
  descuento_general: number
  total: number
  creado_por: string | null
  creado_en: string
  cotizacion_origen_id: number | null
  cotizacion_origen_numero: string | null
}

export interface PedidoEstados {
  comercial: EstadoComercial
  surtido: EstadoSurtido
  lineas_despachadas: number
  lineas_total: number
  pago: EstadoPagoPedido
  pagado: number
  devolucion: EstadoDevolucion
}

export interface PedidoLineaSurtido {
  id: number
  /** Producto realmente surtido (el sustituto, si lo hay). Pre-llena "Ponerle precio propio". */
  producto_id?: number | null
  presentacion_id?: number | null
  descripcion: string
  cantidad_presentacion: number
  estado: EstadoLineaSurtido
  tipo_surtido: TipoSurtido
  ubicacion: string | null
  tanda: number | null
  alistada: boolean
  nota: string | null
}

export interface PedidoItem {
  id: number
  producto_id: number | null
  presentacion_id: number | null
  presentacion_nombre: string | null
  descripcion: string
  es_personalizado: boolean
  unidad_medida: string | null
  cantidad_presentacion: number
  cantidad_despachada: number
  cantidad_sin_cubrir: number
  precio_unitario: number
  descuento_pct: number
  subtotal: number
  estado: 'VIGENTE' | 'QUITADO'
  origen_item_id: number | null
  precio_bloqueado: boolean
  precio_bloqueado_motivo: string | null
  lineas: PedidoLineaSurtido[]
}

export type TipoAviso = 'SUSTITUCION' | 'SIN_CUBRIR'

export interface PedidoAviso {
  id: number
  tipo: TipoAviso
  item_id: number
  linea_id: number | null
  texto: string
  monto: number
  creado_por: string
  creado_en: string
  motivo: string | null
}

export interface PedidoCuenta {
  partida_total: number
  pagado: number
  saldo: number
  sincronizada: boolean
}

export interface PedidoPermisos {
  puede_editar: boolean
  puede_editar_precio_despachado: boolean
  puede_cambiar_cliente: boolean
  motivo_no_editable: string | null
}

export interface PedidoDetalle {
  pedido: PedidoCabecera
  estados: PedidoEstados
  items: PedidoItem[]
  avisos: PedidoAviso[]
  cuenta: PedidoCuenta
  permisos: PedidoPermisos
}

/** Campos solo de interfaz (nombre visible) que el serializador quita antes de llamar al servidor. */
export interface ParteItem {
  producto_id: number | null
  presentacion_id: number | null
  cantidad_presentacion: number
  precio_unitario: number
  linea_ids: number[]
  nombre?: string
}

export type CambioPedido =
  | {
      op: 'agregar'
      producto_id: number | null
      presentacion_id: number | null
      cantidad_presentacion: number
      precio_unitario: number
      descuento_pct: number
      es_personalizado: boolean
      descripcion: string | null
      unidad_medida: string | null
      faltante: 'COMPRAR' | null
      nombre?: string
      presentacion_nombre?: string
    }
  | { op: 'cantidad'; item_id: number; cantidad_presentacion: number }
  | { op: 'precio'; item_id: number; precio_unitario: number; descuento_pct: number }
  | { op: 'partir'; item_id: number; partes: ParteItem[] }
  | { op: 'cambiar_producto_saldo'; item_id: number; producto_id: number; presentacion_id: number | null; precio_unitario: number; nombre?: string }
  | { op: 'cerrar_saldo'; item_id: number }
  | { op: 'quitar'; item_id: number }
  | { op: 'saldo_a_compra'; item_id: number }
  | { op: 'datos'; descuento_general: number; condicion_pago: 'CONTADO' | 'CREDITO' | null; medio_pago: string | null; referencia: string | null }

export interface PrevisualizacionEdicion {
  total_anterior: number
  total_nuevo: number
  delta: number
  cuenta: {
    partida_antes: number
    partida_despues: number
    pagado: number
    saldo_antes: number
    saldo_despues: number
    saldo_a_favor: number
  }
  almacen: Array<{ accion: 'LINEA_NUEVA' | 'LINEA_CANCELADA' | 'COMPRA_CANCELADA' | 'SIN_CAMBIO_FISICO' | 'AVISO_CERRADO'; texto: string }>
  advertencias: Array<{ codigo: string; texto: string }>
  errores: Array<{ codigo: string; item_id?: number | null; texto: string }>
}

export interface ResultadoEdicion { ok: true; version: number; total: number }

export type AccionAviso = 'MANTENER_PRECIO' | 'ACEPTAR' | 'RECHAZAR_SUSTITUTO'

export type RolActor = 'SELLER' | 'ALMACEN' | 'CAJA' | 'SISTEMA'

export interface EventoTiempo {
  id: number
  sesion_id: number | null
  actor: string
  actor_rol: RolActor
  tipo: string
  titulo: string
  cambios: Array<{ texto: string }>
  delta_total: number | null
  total_antes: number | null
  total_despues: number | null
  version_antes: number | null
  version_despues: number | null
  motivo: string | null
  creado_en: string
}

export interface ComentarioTiempo { id: number; autor: string; texto: string; creado_en: string }
export interface VersionTiempo { version: number; etiqueta: string; total: number; creado_en: string }

export interface LineaTiempo {
  eventos: EventoTiempo[]
  comentarios: ComentarioTiempo[]
  versiones: VersionTiempo[]
}

export interface ResumenPedido {
  pedido_id: number
  version: number
  estado_surtido: EstadoSurtido
  avisos: TipoAviso[]
  /** Fecha de la última edición del Seller (para "vN · editado <fecha>"); opcional en el contrato. */
  editado_en?: string | null
}

/** Puerto que implementan la capa Supabase y el mock; el resto de la app solo conoce esto. */
export interface PedidoEdicionPort {
  detalle(pedidoId: number): Promise<PedidoDetalle>
  previsualizar(pedidoId: number, versionEsperada: number, cambios: CambioPedido[]): Promise<PrevisualizacionEdicion>
  editar(pedidoId: number, versionEsperada: number, cambios: CambioPedido[], motivo: string): Promise<ResultadoEdicion>
  resolverAviso(avisoId: number, accion: AccionAviso): Promise<void>
  lineaTiempo(pedidoId: number): Promise<LineaTiempo>
  comentar(pedidoId: number, texto: string): Promise<void>
  resumenPedidos(ids: number[]): Promise<ResumenPedido[]>
}
