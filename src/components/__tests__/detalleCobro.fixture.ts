import type { ActorCobro, DetalleCobro } from '../../domain/orders/detalleCobro'
export const cajera: ActorCobro = { id: '00000000-0000-0000-0000-000000000011', nombre: 'María López', rol: 'cajero', rol_actual: null, historico: false }
export const gerente: ActorCobro = { id: '00000000-0000-0000-0000-000000000012', nombre: 'Luis Herrera', rol: 'gerente', rol_actual: null, historico: false }
export const administradora: ActorCobro = { id: '00000000-0000-0000-0000-000000000013', nombre: 'Ana Rojas', rol: 'admin', rol_actual: null, historico: false }
export const detalleEjemplo: DetalleCobro = {
  pedido: { id: 701, numero: 'PED-2026-00701', estado: 'ABIERTO', total: 1200 }, partida_enfocada: null,
  resumen: { vigentes: 2, saldadas: 2, anuladas: 0 },
  partidas: [
    { id: 1701, documento: 'PA-2026-00701', referencia: 'Material para sucursal', estado: 'PAGADA', entrega_numero: 1, parent_id: null, total: 700, aplicado: 700, en_revision: 0, pendiente: 0, saldada: true, saldada_en: '2026-10-17T14:30:00Z', fecha_saldado_fuente: 'AUDITADA' },
    { id: 1702, documento: 'PA-2026-00701-E2', referencia: 'Ampliación del pedido', estado: 'PAGADA', entrega_numero: 2, parent_id: 1701, total: 500, aplicado: 500, en_revision: 0, pendiente: 0, saldada: true, saldada_en: '2026-10-17T15:30:00Z', fecha_saldado_fuente: 'AUDITADA' },
  ],
  pagos: [
    { id: 2701, medio: 'EFECTIVO', monto: 700, estado: 'CONFIRMADO', fecha_recepcion: '2026-10-17', creado_en: '2026-10-17T14:00:00Z', referencia: 'Recibo de ejemplo 701', cobrado_por: cajera, verificado_por: gerente, verificado_en: '2026-10-17T14:30:00Z', turno: { id: 61, caja: 'Caja Tienda', caja_id: 1, responsable: cajera }, devuelto: 0, aplicado_pedido: 700, aplicaciones: [{ partida_id: 1701, monto: 700 }] },
    { id: 2702, medio: 'TRANSFERENCIA', monto: 500, estado: 'CONFIRMADO', fecha_recepcion: '2026-10-17', creado_en: '2026-10-17T15:00:00Z', referencia: 'Transferencia de ejemplo', cobrado_por: administradora, verificado_por: gerente, verificado_en: '2026-10-17T15:30:00Z', turno: { id: 61, caja: 'Caja Tienda', caja_id: 1, responsable: cajera }, devuelto: 0, aplicado_pedido: 500, aplicaciones: [{ partida_id: 1702, monto: 500 }] },
  ], saldos: [],
  historial: [
    { id: 106, accion: 'PARTIDA_SALDADA', creado_en: '2026-10-17T15:30:00Z', actor: gerente, pago_id: null, partida_id: 1702, uso_id: null, antes: { pendiente: 500 }, despues: { pendiente: 0 } },
    { id: 105, accion: 'PAGO_CONFIRMADO', creado_en: '2026-10-17T15:30:00Z', actor: gerente, pago_id: 2702, partida_id: null, uso_id: null, antes: { estado: 'PROPUESTO' }, despues: { estado: 'CONFIRMADO' } },
    { id: 104, accion: 'COBRO_REGISTRADO', creado_en: '2026-10-17T15:00:00Z', actor: administradora, pago_id: 2702, partida_id: null, uso_id: null, antes: null, despues: { monto: 500 } },
    { id: 103, accion: 'PARTIDA_SALDADA', creado_en: '2026-10-17T14:30:00Z', actor: gerente, pago_id: null, partida_id: 1701, uso_id: null, antes: { pendiente: 700 }, despues: { pendiente: 0 } },
    { id: 102, accion: 'PAGO_CONFIRMADO', creado_en: '2026-10-17T14:30:00Z', actor: gerente, pago_id: 2701, partida_id: null, uso_id: null, antes: { estado: 'PROPUESTO' }, despues: { estado: 'CONFIRMADO' } },
    { id: 101, accion: 'COBRO_REGISTRADO', creado_en: '2026-10-17T14:00:00Z', actor: cajera, pago_id: 2701, partida_id: null, uso_id: null, antes: null, despues: { monto: 700 } },
  ], historial_total: 6, siguiente: null, captura_desde: '2026-10-17T12:00:00Z',
}
