import type { ReportDateRange } from '../../application/ports/reportsRepository'
import { hoyLocal, sumarDiasIso } from '../../domain/common/fechas'
import type {
  ComisionDevengoRow, ComisionesRepository, ComisionFiltros, ComisionLineaDevengo, ComisionLiquidacion,
  ComisionProductoHuerfano, ComisionRegla, ComisionReglaInput, ComisionSeguimiento, ComisionVendedor,
} from '../../application/ports/comisionesRepository'

// Mock mode no simula el histórico transaccional completo — mismo enfoque pragmático que
// MockReportsRepository: un puñado de filas plausibles alcanza para ejercitar los
// estados vacío/cargando/poblado de la página.
let reglas: ComisionRegla[] = [
  { id: 'r1', tipo: 'MARCA', patron: 'ROARI', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 100, activo: true, nota: 'Seed inicial', creadoPor: 'migracion', creadoEn: '2026-09-12T00:00:00Z' },
  { id: 'r2', tipo: 'NOMBRE', patron: 'clip', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 200, activo: true, nota: 'Seed inicial', creadoPor: 'migracion', creadoEn: '2026-09-12T00:00:00Z' },
  // Fase 2, 3.8: regla con 0 matches — así se ve el estado "invisible" que hay que detectar.
  { id: 'r3', tipo: 'MARCA', patron: 'MARCA-INEXISTENTE', accion: 'INCLUIR', porcentajeBp: 100, prioridad: 100, activo: true, nota: null, creadoPor: 'migracion', creadoEn: '2026-09-12T00:00:00Z' },
  // Fase 3, 1.1: "limpieza" al 0,5%, prioridad baja para ganar sobre cualquier otra regla.
  { id: 'r4', tipo: 'DESCRIPCION', patron: 'limpieza', accion: 'INCLUIR', porcentajeBp: 50, prioridad: 10, activo: true, nota: 'Seed Fase 3', creadoPor: 'migracion', creadoEn: '2026-09-24T00:00:00Z' },
]

let vendedores: ComisionVendedor[] = [
  { perfilId: 'p1', nombre: 'Andrea Admin', email: 'nessxd14@gmail.com', activo: true, desde: '2026-08-01', nota: null },
  { perfilId: 'p2', nombre: 'Rony', email: 'piterali.argana@gmail.com', activo: true, desde: '2026-08-01', nota: null },
]

const perfilesDisponibles = [{ id: 'p3', nombre: 'Gabriel', email: 'gabrieloni62@gmail.com' }]

// Fechas relativas a hoy (no fijas) para que el período por defecto de la página
// (últimos 30 días) siempre las incluya, sin importar cuándo se corra el mock.
let mockDevengo: ComisionDevengoRow[] = [
  { id: '1', origen: 'PEDIDO', documentoId: '101', vendedorEmail: 'nessxd14@gmail.com', clienteNombre: 'Librería San Marcos', fecha: sumarDiasIso(hoyLocal(), -20), baseComisionableCents: 500000, totalDocumentoCents: 800000, porcentajeBp: 100, montoCents: 5000, estado: 'POTENCIAL', liquidacionId: null, liquidacionFecha: null, tienePersonalizadoComisionable: false },
  { id: '2', origen: 'VTD', documentoId: '55', vendedorEmail: 'nessxd14@gmail.com', clienteNombre: 'Cliente de mostrador', fecha: sumarDiasIso(hoyLocal(), -10), baseComisionableCents: 150000, totalDocumentoCents: 150000, porcentajeBp: 100, montoCents: 1500, estado: 'DEVENGADA', liquidacionId: null, liquidacionFecha: null, tienePersonalizadoComisionable: false },
  { id: '3', origen: 'PEDIDO', documentoId: '102', vendedorEmail: 'piterali.argana@gmail.com', clienteNombre: 'Colegio Nueva Esperanza', fecha: sumarDiasIso(hoyLocal(), -5), baseComisionableCents: 1200000, totalDocumentoCents: 1500000, porcentajeBp: 100, montoCents: 12000, estado: 'DEVENGADA', liquidacionId: null, liquidacionFecha: null, tienePersonalizadoComisionable: false },
  { id: '4', origen: 'PEDIDO', documentoId: '103', vendedorEmail: 'piterali.argana@gmail.com', clienteNombre: 'Ferretería El Constructor', fecha: sumarDiasIso(hoyLocal(), -25), baseComisionableCents: 300000, totalDocumentoCents: 400000, porcentajeBp: 100, montoCents: 3000, estado: 'LIQUIDADA', liquidacionId: 'l1', liquidacionFecha: sumarDiasIso(hoyLocal(), -2), tienePersonalizadoComisionable: false },
  // Fase 3: pedido con líneas personalizadas comisionables (una vía "limpieza", otra vía
  // una regla NOMBRE existente) — para ejercitar el ícono de la fila y el desglose.
  { id: '5', origen: 'PEDIDO', documentoId: '104', vendedorEmail: 'nessxd14@gmail.com', clienteNombre: 'Ferretería El Constructor', fecha: sumarDiasIso(hoyLocal(), -3), baseComisionableCents: 90000, totalDocumentoCents: 250000, porcentajeBp: 75, montoCents: 675, estado: 'POTENCIAL', liquidacionId: null, liquidacionFecha: null, tienePersonalizadoComisionable: true },
]

const mockLineas: Record<string, ComisionLineaDevengo[]> = {
  '1': [
    { productoId: '10', productoNombre: 'Cuaderno TUKI 50 hojas', marca: 'TUKI', subtotalCents: 300000, porcentajeBp: 100, comisiona: true, esPersonalizado: false, reglaTipo: 'MARCA', reglaPatron: 'TUKI' },
    { productoId: '11', productoNombre: 'Bolígrafo BIC azul', marca: 'BIC', subtotalCents: 200000, porcentajeBp: null, comisiona: false, esPersonalizado: false, reglaTipo: null, reglaPatron: null },
    { productoId: null, productoNombre: 'Ítem personalizado', marca: null, subtotalCents: 300000, porcentajeBp: null, comisiona: false, esPersonalizado: true, reglaTipo: null, reglaPatron: null },
  ],
  '5': [
    { productoId: null, productoNombre: 'GUANTES PARA LIMPIEZA', marca: null, subtotalCents: 45000, porcentajeBp: 50, comisiona: true, esPersonalizado: true, reglaTipo: 'DESCRIPCION', reglaPatron: 'limpieza' },
    { productoId: null, productoNombre: 'CINTA DE EMBALAJE DE 100 YARDA', marca: null, subtotalCents: 45000, porcentajeBp: 100, comisiona: true, esPersonalizado: true, reglaTipo: 'NOMBRE', reglaPatron: 'cinta de embalaje' },
    { productoId: null, productoNombre: 'PILA NORMAL AA', marca: null, subtotalCents: 160000, porcentajeBp: null, comisiona: false, esPersonalizado: true, reglaTipo: null, reglaPatron: null },
  ],
}

let mockLiquidaciones: ComisionLiquidacion[] = [
  { id: 'l1', vendedorEmail: 'piterali.argana@gmail.com', montoTotalCents: 3000, medioPago: 'TRANSFERENCIA', referencia: 'TR-0012', comprobanteUrl: null, nota: null, creadoPor: 'piterali.argana@gmail.com', creadoEn: sumarDiasIso(hoyLocal(), -2), anuladoEn: null, anuladoPor: null, motivoAnulacion: null },
]

const mockSeguimiento: Record<string, ComisionSeguimiento> = {
  '1': { devengoId: '1', partidas: 1, partidaTotalCents: 800000, imputadoCents: 320000, pendienteCents: 480000, fechaVencimiento: sumarDiasIso(hoyLocal(), 8), diasVencido: null, relojCorriendo: true },
}

const mockHuerfanos: ComisionProductoHuerfano[] = [
  { productoId: '900', productoNombre: 'Marcador FABER CASTELL 12 colores', marca: 'FABER CASTELL', montoVendidoCents: 34000 },
]

const inRange = (fecha: string, dates: ReportDateRange) => fecha >= dates.from && fecha <= dates.to
const matchFiltros = (row: ComisionDevengoRow, filtros?: ComisionFiltros) =>
  (!filtros?.estado || row.estado === filtros.estado)
  && (!filtros?.origen || row.origen === filtros.origen)
  && (!filtros?.vendedorEmail || row.vendedorEmail === filtros.vendedorEmail)
let nextId = 100

export class MockComisionesRepository implements ComisionesRepository {
  async getMisComisiones(input: { vendedorEmail: string; dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]> {
    return mockDevengo.filter((r) => r.vendedorEmail === input.vendedorEmail && inRange(r.fecha, input.dates) && matchFiltros(r, input.filtros))
  }
  async getEquipo(input: { dates: ReportDateRange; filtros?: ComisionFiltros }): Promise<ComisionDevengoRow[]> {
    return mockDevengo.filter((r) => inRange(r.fecha, input.dates) && matchFiltros(r, input.filtros))
  }
  async getSeguimiento(dates: ReportDateRange): Promise<ComisionSeguimiento[]> {
    return mockDevengo.filter((r) => inRange(r.fecha, dates)).map((r) => mockSeguimiento[r.id] ?? {
      devengoId: r.id, partidas: r.origen === 'PEDIDO' ? 1 : 0, partidaTotalCents: r.totalDocumentoCents,
      imputadoCents: r.estado === 'POTENCIAL' ? 0 : r.totalDocumentoCents, pendienteCents: r.estado === 'POTENCIAL' ? r.totalDocumentoCents : 0,
      fechaVencimiento: null, diasVencido: null, relojCorriendo: false,
    })
  }
  async getLineasDevengo(devengoId: string): Promise<ComisionLineaDevengo[]> { return mockLineas[devengoId] ?? [] }
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
  async getReglaConteo(): Promise<Record<string, number>> {
    // r3 (MARCA-INEXISTENTE) queda deliberadamente en 0 — ver comentario del seed arriba.
    // r4 (limpieza) cuenta líneas personalizadas, no productos — ver migración Fase 3.
    return Object.fromEntries(reglas.map((r) => [r.id, r.id === 'r3' ? 0 : r.id === 'r4' ? 1 : 12]))
  }
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
  async listLiquidaciones(vendedorEmail?: string): Promise<ComisionLiquidacion[]> {
    return vendedorEmail ? mockLiquidaciones.filter((l) => l.vendedorEmail === vendedorEmail) : mockLiquidaciones
  }
  async crearLiquidacion(input: { vendedorEmail: string; devengoIds: string[]; medioPago?: string; referencia?: string; comprobanteUrl?: string; nota?: string }): Promise<ComisionLiquidacion> {
    const elegibles = mockDevengo.filter((d) => input.devengoIds.includes(d.id))
    if (elegibles.some((d) => d.vendedorEmail !== input.vendedorEmail || d.estado !== 'DEVENGADA') || elegibles.length !== input.devengoIds.length) {
      throw new Error(`Alguno de los devengos seleccionados no está DEVENGADA o no es de ${input.vendedorEmail}`)
    }
    const montoTotalCents = elegibles.reduce((sum, d) => sum + d.montoCents, 0)
    const created: ComisionLiquidacion = {
      id: `l${nextId++}`, vendedorEmail: input.vendedorEmail, montoTotalCents,
      medioPago: input.medioPago ?? null, referencia: input.referencia ?? null, comprobanteUrl: input.comprobanteUrl ?? null,
      nota: input.nota ?? null, creadoPor: input.vendedorEmail, creadoEn: new Date().toISOString(),
      anuladoEn: null, anuladoPor: null, motivoAnulacion: null,
    }
    mockLiquidaciones = [created, ...mockLiquidaciones]
    mockDevengo = mockDevengo.map((d) => (input.devengoIds.includes(d.id) ? { ...d, estado: 'LIQUIDADA', liquidacionId: created.id, liquidacionFecha: created.creadoEn } : d))
    return created
  }
  async anularLiquidacion(liquidacionId: string, motivo: string): Promise<void> {
    mockLiquidaciones = mockLiquidaciones.map((l) => (l.id === liquidacionId ? { ...l, anuladoEn: new Date().toISOString(), anuladoPor: 'mock', motivoAnulacion: motivo } : l))
    mockDevengo = mockDevengo.map((d) => (d.liquidacionId === liquidacionId ? { ...d, estado: 'DEVENGADA', liquidacionId: null, liquidacionFecha: null } : d))
  }
}

export const comisionesRepository = new MockComisionesRepository()
