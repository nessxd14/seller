import type { ReportDateRange } from './reportsRepository'

// Módulo de Comisiones. Fase 1 cubría solo POTENCIAL; Fase 2 agrega DEVENGADA
// automática (VTD al instante, PEDIDO al saldarse la partida en hermes) y
// LIQUIDADA por lotes (comision_liquidacion). No hay paginación por PageRequest
// como en reportsRepository: el volumen de documentos comisionables por vendedor y
// por período sigue siendo chico (cientos, no miles) — Fase 2 3.6 pide paginación
// client-side sobre lo ya traído, no un cambio de esta forma.
export type ComisionOrigen = 'PEDIDO' | 'VTD'
export type ComisionEstado = 'POTENCIAL' | 'DEVENGADA' | 'LIQUIDADA' | 'ANULADA'

export interface ComisionDevengoRow {
  id: string
  origen: ComisionOrigen
  documentoId: string
  vendedorEmail: string
  clienteNombre: string | null
  fecha: string
  baseComisionableCents: number
  totalDocumentoCents: number
  porcentajeBp: number // basis points, 0..10000 (1% = 100)
  montoCents: number
  estado: ComisionEstado
  liquidacionId: string | null
  liquidacionFecha: string | null
  // Fase 3, Parte 2 — al menos una línea de este documento es personalizada (sin
  // producto_id) y comisiona. Se congela junto con el resto en comision_registrar_pedido
  // / se completa en el backfill; no se recalcula recorriendo líneas en el cliente.
  tienePersonalizadoComisionable: boolean
}

// Brief Fase 2, 3.1: "qué falta para cobrar" — hermes.partida_abierta/pago tienen su
// propia RLS (perfil.hermes_acceso) que la mayoría de los vendedores no tiene, así que
// esto llega por el RPC comision_seguimiento (ver ComisionRepository.supabase.ts), no
// por columnas de comision_devengo. Se combina con la fila por `devengoId` en la UI.
export interface ComisionSeguimiento {
  devengoId: string
  partidas: number // 0 = sin partida en cartera (solo aplica a origen PEDIDO)
  partidaTotalCents: number
  imputadoCents: number
  pendienteCents: number
  fechaVencimiento: string | null
  diasVencido: number | null // positivo si ya venció
  relojCorriendo: boolean
}

export interface ComisionLineaDevengo {
  productoId: string | null // null = ítem personalizado (pedido_linea sin producto)
  productoNombre: string
  marca: string | null
  subtotalCents: number
  porcentajeBp: number | null // null = no matcheó ninguna regla
  comisiona: boolean
  // Fase 3, Parte 2 — auditar antes de pagar: una comisión sobre texto libre depende de
  // cómo alguien escribió la descripción, no de un catálogo controlado.
  esPersonalizado: boolean
  reglaTipo: ComisionRegla['tipo'] | null
  reglaPatron: string | null
}

export interface ComisionLiquidacion {
  id: string
  vendedorEmail: string
  montoTotalCents: number
  medioPago: string | null
  referencia: string | null
  comprobanteUrl: string | null
  nota: string | null
  creadoPor: string
  creadoEn: string
  anuladoEn: string | null
  anuladoPor: string | null
  motivoAnulacion: string | null
}

export interface ComisionVendedorTotal {
  vendedorEmail: string
  documentos: number
  baseComisionableCents: number
  montoCents: number
}

export interface ComisionRegla {
  id: string
  // Fase 3: DESCRIPCION matchea pedido_linea.descripcion (ILIKE) — para líneas
  // personalizadas ("limpieza" → 0,5%). MARCA sobre descripción usa límite de palabra en
  // el backend (comision_regla_ganadora_personalizada), no ILIKE — ver migración.
  tipo: 'MARCA' | 'NOMBRE' | 'DESCRIPCION'
  patron: string
  accion: 'INCLUIR' | 'EXCLUIR'
  porcentajeBp: number
  prioridad: number
  activo: boolean
  nota: string | null
  creadoPor: string | null
  creadoEn: string
}
export type ComisionReglaInput = Omit<ComisionRegla, 'id' | 'creadoEn'>

export interface ComisionVendedor {
  perfilId: string
  nombre: string
  email: string
  activo: boolean
  desde: string
  nota: string | null
}

export interface ComisionProductoHuerfano {
  productoId: string
  productoNombre: string
  marca: string | null
  montoVendidoCents: number
}

export interface ComisionFiltros {
  estado?: ComisionEstado
  origen?: ComisionOrigen
  vendedorEmail?: string
}

export interface ComisionesRepository {
  // "Mis comisiones" — filas del vendedor de la sesión actual (RLS ya lo garantiza en
  // Supabase; el mock filtra por el email pasado).
  getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]>
  // "Equipo" (solo gerente) — todas las filas del período, para desglose y total por vendedor.
  getEquipo(input: { dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]>
  // Fase 2, 3.1 — estado de cobro por devengo (RPC, no columnas de comision_devengo).
  getSeguimiento(dates: ReportDateRange): Promise<ComisionSeguimiento[]>
  // Fase 2, 3.2 — desglose de líneas de un documento (fila expandible).
  getLineasDevengo(devengoId: string): Promise<ComisionLineaDevengo[]>

  listReglas(): Promise<ComisionRegla[]>
  createRegla(input: ComisionReglaInput): Promise<ComisionRegla>
  updateRegla(id: string, input: ComisionReglaInput): Promise<ComisionRegla>
  deleteRegla(id: string): Promise<void>
  // Fase 2, 3.8 — cuántos productos matchea cada regla (detecta reglas con 0, como el
  // toner/envius/blinder clip del sistema viejo).
  getReglaConteo(): Promise<Record<string, number>>

  listVendedores(): Promise<ComisionVendedor[]>
  setVendedorActivo(perfilId: string, activo: boolean): Promise<void>
  // Alta: perfilId debe existir en `perfil` — igual que comision_vendedor.perfil_id FK.
  addVendedor(perfilId: string, nota?: string): Promise<ComisionVendedor>
  // Perfiles que todavía no están en comision_vendedor — para el selector de alta.
  listPerfilesDisponibles(): Promise<Array<{ id: string; nombre: string; email: string }>>

  getProductosHuerfanos(dates: ReportDateRange): Promise<ComisionProductoHuerfano[]>

  // Fase 2, Parte 2 — liquidación por lotes (solo gerente; RLS/función lo validan
  // también del lado del servidor).
  listLiquidaciones(vendedorEmail?: string): Promise<ComisionLiquidacion[]>
  crearLiquidacion(input: { vendedorEmail: string; devengoIds: string[]; medioPago?: string; referencia?: string; comprobanteUrl?: string; nota?: string }): Promise<ComisionLiquidacion>
  anularLiquidacion(liquidacionId: string, motivo: string): Promise<void>
}
