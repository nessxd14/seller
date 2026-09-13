import type { ReportDateRange } from './reportsRepository'

// Módulo de Comisiones, Fase 1 — cubre solo POTENCIAL (ver comision_devengo). No hay
// paginación por PageRequest como en reportsRepository: el volumen de documentos
// comisionables por vendedor y por período es chico (decenas, no miles).
export type ComisionOrigen = 'PEDIDO' | 'VTD'
export type ComisionEstado = 'POTENCIAL' | 'DEVENGADA' | 'LIQUIDADA' | 'ANULADA'

export interface ComisionDevengoRow {
  id: string
  origen: ComisionOrigen
  documentoId: string
  vendedorEmail: string
  fecha: string
  baseComisionableCents: number
  totalDocumentoCents: number
  porcentajeBp: number // basis points, 0..10000 (1% = 100)
  montoCents: number
  estado: ComisionEstado
}

export interface ComisionVendedorTotal {
  vendedorEmail: string
  documentos: number
  baseComisionableCents: number
  montoCents: number
}

export interface ComisionRegla {
  id: string
  tipo: 'MARCA' | 'NOMBRE'
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

export interface ComisionesRepository {
  // "Mis comisiones" — filas del vendedor de la sesión actual (RLS ya lo garantiza en
  // Supabase; el mock filtra por el email pasado).
  getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange }): Promise<ComisionDevengoRow[]>
  // "Equipo" (solo admin) — todas las filas del período, para desglose y total por vendedor.
  getEquipo(input: { dates: ReportDateRange }): Promise<ComisionDevengoRow[]>

  listReglas(): Promise<ComisionRegla[]>
  createRegla(input: ComisionReglaInput): Promise<ComisionRegla>
  updateRegla(id: string, input: ComisionReglaInput): Promise<ComisionRegla>
  deleteRegla(id: string): Promise<void>

  listVendedores(): Promise<ComisionVendedor[]>
  setVendedorActivo(perfilId: string, activo: boolean): Promise<void>
  // Alta: perfilId debe existir en `perfil` — igual que comision_vendedor.perfil_id FK.
  addVendedor(perfilId: string, nota?: string): Promise<ComisionVendedor>
  // Perfiles que todavía no están en comision_vendedor — para el selector de alta.
  listPerfilesDisponibles(): Promise<Array<{ id: string; nombre: string; email: string }>>

  getProductosHuerfanos(dates: ReportDateRange): Promise<ComisionProductoHuerfano[]>
}
