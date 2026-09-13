import type { ReportDateRange } from '../../application/ports/reportsRepository'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'
import type {
  ComisionDevengoRow, ComisionesRepository, ComisionProductoHuerfano, ComisionRegla, ComisionReglaInput,
  ComisionVendedor,
} from '../../application/ports/comisionesRepository'

// Mock mode no simula el histórico transaccional completo — mismo enfoque pragmático que
// MockReportsRepository: un puñado de filas plausibles alcanza para ejercitar los
// estados vacío/cargando/poblado de la página.
let reglas: ComisionRegla[] = [
  { id: 'r1', tipo: 'MARCA', patron: 'ROARI', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 100, activo: true, nota: 'Seed inicial', creadoPor: 'migracion', creadoEn: '2026-09-12T00:00:00Z' },
  { id: 'r2', tipo: 'NOMBRE', patron: 'clip', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 200, activo: true, nota: 'Seed inicial', creadoPor: 'migracion', creadoEn: '2026-09-12T00:00:00Z' },
]

let vendedores: ComisionVendedor[] = [
  { perfilId: 'p1', nombre: 'Andrea Admin', email: 'nessxd14@gmail.com', activo: true, desde: '2026-08-01', nota: null },
  { perfilId: 'p2', nombre: 'Rony', email: 'piterali.argana@gmail.com', activo: true, desde: '2026-08-01', nota: null },
]

const perfilesDisponibles = [{ id: 'p3', nombre: 'Gabriel', email: 'gabrieloni62@gmail.com' }]

// Fechas relativas a hoy (no fijas) para que el período por defecto de la página
// (últimos 30 días) siempre las incluya, sin importar cuándo se corra el mock.
const mockDevengo: ComisionDevengoRow[] = [
  { id: '1', origen: 'PEDIDO', documentoId: '101', vendedorEmail: 'nessxd14@gmail.com', fecha: sumarDiasIso(hoyLocal(), -20), baseComisionableCents: 500000, totalDocumentoCents: 800000, porcentajeBp: 100, montoCents: 5000, estado: 'POTENCIAL' },
  { id: '2', origen: 'VTD', documentoId: '55', vendedorEmail: 'nessxd14@gmail.com', fecha: sumarDiasIso(hoyLocal(), -10), baseComisionableCents: 150000, totalDocumentoCents: 150000, porcentajeBp: 100, montoCents: 1500, estado: 'POTENCIAL' },
  { id: '3', origen: 'PEDIDO', documentoId: '102', vendedorEmail: 'piterali.argana@gmail.com', fecha: sumarDiasIso(hoyLocal(), -5), baseComisionableCents: 1200000, totalDocumentoCents: 1500000, porcentajeBp: 100, montoCents: 12000, estado: 'POTENCIAL' },
]

const mockHuerfanos: ComisionProductoHuerfano[] = [
  { productoId: '900', productoNombre: 'Marcador FABER CASTELL 12 colores', marca: 'FABER CASTELL', montoVendidoCents: 34000 },
]

const inRange = (fecha: string, dates: ReportDateRange) => fecha >= dates.from && fecha <= dates.to
let nextId = 100

export class MockComisionesRepository implements ComisionesRepository {
  async getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange }): Promise<ComisionDevengoRow[]> {
    return mockDevengo.filter((r) => r.vendedorEmail === input.vendedorEmail && inRange(r.fecha, input.dates))
  }
  async getEquipo(input: { dates: ReportDateRange }): Promise<ComisionDevengoRow[]> {
    return mockDevengo.filter((r) => inRange(r.fecha, input.dates))
  }
  async listReglas(): Promise<ComisionRegla[]> { return reglas }
  async createRegla(input: ComisionReglaInput): Promise<ComisionRegla> {
    const created: ComisionRegla = { ...input, id: String(nextId++), creadoEn: new Date().toISOString() }
    reglas = [...reglas, created]
    return created
  }
  async updateRegla(id: string, input: ComisionReglaInput): Promise<ComisionRegla> {
    const existing = reglas.find((r) => r.id === id)
    const updated: ComisionRegla = { ...input, id, creadoEn: existing?.creadoEn ?? new Date().toISOString() }
    reglas = reglas.map((r) => (r.id === id ? updated : r))
    return updated
  }
  async deleteRegla(id: string): Promise<void> { reglas = reglas.filter((r) => r.id !== id) }
  async listVendedores(): Promise<ComisionVendedor[]> { return vendedores }
  async setVendedorActivo(perfilId: string, activo: boolean): Promise<void> {
    vendedores = vendedores.map((v) => (v.perfilId === perfilId ? { ...v, activo } : v))
  }
  async addVendedor(perfilId: string, nota?: string): Promise<ComisionVendedor> {
    const disponible = perfilesDisponibles.find((p) => p.id === perfilId)
    const created: ComisionVendedor = { perfilId, nombre: disponible?.nombre ?? '', email: disponible?.email ?? '', activo: true, desde: hoyLocal(), nota: nota ?? null }
    vendedores = [...vendedores, created]
    return created
  }
  async listPerfilesDisponibles(): Promise<Array<{ id: string; nombre: string; email: string }>> {
    return perfilesDisponibles.filter((p) => !vendedores.some((v) => v.perfilId === p.id))
  }
  async getProductosHuerfanos(dates: ReportDateRange): Promise<ComisionProductoHuerfano[]> {
    void dates
    return mockHuerfanos
  }
}

export const comisionesRepository = new MockComisionesRepository()
