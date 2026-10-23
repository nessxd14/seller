// Escenario T11 del brief de edición de pedidos: PED-2026-00706, versión 4, pagado Bs 300.
// Lo usan el mock (modo VITE_POS_MODE=mock) y las pruebas del dominio.
import type { OrderView } from '../../application/shared/models'
import type { LineaTiempo, PedidoDetalle } from '../../domain/orders/pedidoEdicion.types'

export const PEDIDO_ESCENARIO_ID = 706

export const crearDetalleEscenario = (): PedidoDetalle => ({
  pedido: {
    id: PEDIDO_ESCENARIO_ID,
    numero: 'PED-2026-00706',
    version: 4,
    cliente_id: 12,
    cliente_nombre: 'Cliente de prueba',
    categoria: 'MAYOR',
    condicion_pago: 'CREDITO',
    medio_pago: null,
    referencia: null,
    descuento_general: 0,
    total: 908,
    creado_por: 'natalia@roari.bo',
    creado_en: '2026-10-20T14:05:00Z',
    cotizacion_origen_id: 551,
    cotizacion_origen_numero: 'COT-2026-00551',
  },
  estados: { comercial: 'ABIERTO', surtido: 'PARCIAL', lineas_despachadas: 2, lineas_total: 7, pago: 'PARCIAL', pagado: 300, devolucion: 'NINGUNA' },
  items: [
    {
      id: 901, producto_id: 4410, presentacion_id: 88, presentacion_nombre: null, descripcion: 'Trijet Digno 0.7 azul', es_personalizado: false, unidad_medida: null,
      cantidad_presentacion: 500, cantidad_despachada: 200, cantidad_sin_cubrir: 0, precio_unitario: 0.85, descuento_pct: 0, subtotal: 425, estado: 'VIGENTE', origen_item_id: null,
      precio_bloqueado: true, precio_bloqueado_motivo: 'Hay 200 u ya despachadas: cambiar el precio requiere autorización.',
      lineas: [
        { id: 4746, producto_id: 4410, presentacion_id: 88, descripcion: 'Trijet Digno 0.7 azul', cantidad_presentacion: 200, estado: 'DESPACHADA', tipo_surtido: 'ORIGINAL', ubicacion: 'Almacén', tanda: 1, alistada: true, nota: null },
        { id: 4765, producto_id: 850, presentacion_id: 91, descripcion: 'Wenao Colle', cantidad_presentacion: 300, estado: 'POR_DESPACHAR', tipo_surtido: 'SUSTITUTO', ubicacion: 'Almacén', tanda: 2, alistada: false, nota: null },
      ],
    },
    {
      id: 902, producto_id: 5120, presentacion_id: 91, presentacion_nombre: 'Paquete (50)', descripcion: 'Fastener', es_personalizado: false, unidad_medida: null,
      cantidad_presentacion: 15, cantidad_despachada: 0, cantidad_sin_cubrir: 0, precio_unitario: 11, descuento_pct: 0, subtotal: 165, estado: 'VIGENTE', origen_item_id: null,
      precio_bloqueado: false, precio_bloqueado_motivo: null,
      lineas: [{ id: 4770, descripcion: 'Fastener', cantidad_presentacion: 15, estado: 'POR_DESPACHAR', tipo_surtido: 'ORIGINAL', ubicacion: 'Almacén', tanda: null, alistada: false, nota: null }],
    },
    {
      id: 903, producto_id: 3302, presentacion_id: 55, presentacion_nombre: null, descripcion: 'Fixocola', es_personalizado: false, unidad_medida: null,
      cantidad_presentacion: 15, cantidad_despachada: 0, cantidad_sin_cubrir: 0, precio_unitario: 6, descuento_pct: 0, subtotal: 90, estado: 'VIGENTE', origen_item_id: null,
      precio_bloqueado: false, precio_bloqueado_motivo: null,
      lineas: [
        { id: 4780, descripcion: 'Fixocola', cantidad_presentacion: 10, estado: 'POR_DESPACHAR', tipo_surtido: 'ORIGINAL', ubicacion: 'Tienda · Salón', tanda: null, alistada: false, nota: null },
        { id: 4781, descripcion: 'Fixocola', cantidad_presentacion: 5, estado: 'POR_COMPRAR', tipo_surtido: 'COMPRA', ubicacion: null, tanda: null, alistada: false, nota: null },
      ],
    },
    {
      id: 904, producto_id: 2210, presentacion_id: 60, presentacion_nombre: 'Resma', descripcion: 'Bond Brío carta', es_personalizado: false, unidad_medida: null,
      cantidad_presentacion: 10, cantidad_despachada: 6, cantidad_sin_cubrir: 4, precio_unitario: 38, descuento_pct: 0, subtotal: 228, estado: 'VIGENTE', origen_item_id: null,
      precio_bloqueado: true, precio_bloqueado_motivo: 'Hay 6 resmas ya despachadas: cambiar el precio requiere autorización.',
      lineas: [
        { id: 4790, descripcion: 'Bond Brío carta', cantidad_presentacion: 6, estado: 'DESPACHADA', tipo_surtido: 'ORIGINAL', ubicacion: 'Almacén', tanda: 1, alistada: true, nota: null },
        { id: 4791, descripcion: 'Bond Brío carta', cantidad_presentacion: 4, estado: 'SIN_CUBRIR', tipo_surtido: 'ORIGINAL', ubicacion: null, tanda: null, alistada: false, nota: null },
      ],
    },
  ],
  avisos: [
    { id: 31, tipo: 'SUSTITUCION', item_id: 901, linea_id: 4765, texto: 'Almacén cubrió 300 de Trijet Digno 0.7 azul con Wenao Colle.', monto: 0, creado_por: 'Rovin', creado_en: '2026-10-22T16:40:00Z', motivo: 'Sin stock de Trijet en el almacén' },
    { id: 32, tipo: 'SIN_CUBRIR', item_id: 904, linea_id: 4791, texto: 'Almacén no tiene 4 de Bond Brío carta.', monto: 152, creado_por: 'Rovin', creado_en: '2026-10-22T16:52:00Z', motivo: 'Sin stock y sin compra en curso' },
  ],
  cuenta: { partida_total: 908, pagado: 300, saldo: 608, sincronizada: true },
  permisos: { puede_editar: true, puede_editar_precio_despachado: false, puede_cambiar_cliente: false, motivo_no_editable: null },
})

export const crearTiempoEscenario = (): LineaTiempo => ({
  eventos: [
    { id: 4, sesion_id: null, actor: 'Rovin', actor_rol: 'ALMACEN', tipo: 'SIN_CUBRIR', titulo: 'marcó 4 resmas de Bond Brío carta como sin cubrir', cambios: [{ texto: 'Bond Brío carta: 4 de 10 sin cubrir' }], delta_total: -152, total_antes: 1060, total_despues: 908, version_antes: 3, version_despues: 4, motivo: 'Sin stock y sin compra en curso', creado_en: '2026-10-22T16:52:00Z' },
    { id: 3, sesion_id: null, actor: 'Rovin', actor_rol: 'ALMACEN', tipo: 'SUSTITUCION', titulo: 'cubrió 300 de Trijet con Wenao Colle', cambios: [{ texto: 'Trijet Digno 0.7 azul: 300 u sustituidas por Wenao Colle' }], delta_total: 0, total_antes: 1060, total_despues: 1060, version_antes: 2, version_despues: 3, motivo: 'Sin stock de Trijet en el almacén', creado_en: '2026-10-22T16:40:00Z' },
    { id: 2, sesion_id: null, actor: 'Natalia S.', actor_rol: 'CAJA', tipo: 'ANTICIPO', titulo: 'registró un anticipo de Bs 300,00', cambios: [{ texto: 'Anticipo Bs 300,00 en efectivo' }], delta_total: null, total_antes: null, total_despues: null, version_antes: null, version_despues: null, motivo: null, creado_en: '2026-10-21T10:15:00Z' },
    { id: 1, sesion_id: null, actor: 'natalia@roari.bo', actor_rol: 'SELLER', tipo: 'CREACION', titulo: 'creó el pedido desde COT-2026-00551', cambios: [{ texto: '4 ítems · Bs 1.060,00' }], delta_total: null, total_antes: null, total_despues: 1060, version_antes: null, version_despues: 1, motivo: null, creado_en: '2026-10-20T14:05:00Z' },
  ],
  comentarios: [],
  versiones: [
    { version: 4, etiqueta: 'Sin cubrir de Bond Brío', total: 908, creado_en: '2026-10-22T16:52:00Z' },
    { version: 3, etiqueta: 'Sustitución de Trijet', total: 1060, creado_en: '2026-10-22T16:40:00Z' },
    { version: 2, etiqueta: 'Anticipo registrado', total: 1060, creado_en: '2026-10-21T10:15:00Z' },
    { version: 1, etiqueta: 'Pedido creado', total: 1060, creado_en: '2026-10-20T14:05:00Z' },
  ],
})

/** Fila de la lista de pedidos (OrderView) para el escenario: el detalle real sale de `pedido_detalle`. */
export const ordenEscenario = (): OrderView => ({
  id: String(PEDIDO_ESCENARIO_ID),
  number: 'PED-2026-00706',
  customerId: '12',
  customerName: 'Cliente de prueba',
  channel: 'mayoreo',
  status: 'preparing',
  createdAt: '2026-10-20T14:05:00Z',
  sourceQuoteId: '551',
  sourceQuoteNumber: 'COT-2026-00551',
  creadoPor: 'natalia@roari.bo',
  conditionPago: 'CREDITO',
  subtotalCents: 90800,
  totalCents: 90800,
  lines: [],
  events: [],
})
