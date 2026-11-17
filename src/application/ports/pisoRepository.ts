import type { DemandaCanal, DemandaUnidad } from './demandaRepository'

/** Turno abierto de quien llama, con su resumen. `null` en `turnoActual` = sin turno. */
export interface PisoTurno {
  turnoId: number
  inicio: string
  sucursalId: number
  cobradas: number
  porCobrar: number
  noRealizadas: number
  porReclamar: number
  /** Próximo corte automático del turno (ISO). Ausente en el mock. */
  cierraA?: string
}

export type PisoTurnoCierre = 'MANUAL' | 'AUTOMATICO' | 'GERENTE' | 'CAJA'

/** Último turno cerrado hoy, cuando ya no hay uno abierto. */
export interface PisoTurnoUltimo {
  turnoId: number
  inicio: string
  fin: string
  cierre: PisoTurnoCierre
}

export interface EstadoTurnoPiso {
  turno: PisoTurno | null
  ultimo: PisoTurnoUltimo | null
}

/** Estado de la tarea QR de Almacén (`null` en el traslado = Almacén aún no la toma). */
export type TareaTrasladoEstado = 'PREPARANDO' | 'PREPARADO' | 'REVISANDO' | 'RECIBIDO'

export interface TrasladoPiso {
  id: string
  numero: string
  estado: string
  motivo: string
  origenId: number
  destinoId: number
  solicitadoEn: string
  mio: boolean
  nota: string | null
  tareaEstado: TareaTrasladoEstado | null
  alista: string | null
  alistadoEn: string | null
  retira: string | null
  retiroMio: boolean
  recibidoEn: string | null
  lineas: number
  conFaltante: boolean
}

export interface TrasladosPisoResultado {
  sucursalId: number
  traslados: TrasladoPiso[]
}

/** Venta que caja cobró sin vendedor y que se puede reclamar. Solo lo mínimo: sin cliente, pagos ni cajero. */
export interface VentaPorReclamar {
  ventaId: number
  numero: string
  total: number
  completadoEn: string
  producto: string | null
  nProductos: number
}

export interface ReclamoResultado {
  reclamoId: number
  ventaId: number
  deshacerHasta: string
}

export type MotivoNoRealizada = 'NO_HAY' | 'MUY_CARO' | 'OTRO'

export interface NoRealizadaLineaInput {
  productoId: number | null
  descripcion: string | null
  cantidad: number | null
  unidad: DemandaUnidad
  motivo: MotivoNoRealizada
  motivoTexto: string | null
}

export interface NoRealizadaInput {
  lineas: NoRealizadaLineaInput[]
  canal: DemandaCanal
  contactoNombre: string | null
  contactoTel: string | null
  quiereAviso: boolean
  fotoPath: string | null
}

export interface NoRealizadaResultado {
  visita: string
  lineas: Array<{ demandaId: number; motivo: MotivoNoRealizada; ideaId: number | null; vecesSemana: number | null }>
}

// ── Caja (escritorio): de quién es una venta ──
export interface CajaReclamo {
  ventaId: number
  perfilId: string
  nombre: string
  origen: 'RECLAMO' | 'CAJA'
  reclamadoEn: string
}

export interface CajaVendedorPiso {
  perfilId: string
  nombre: string
  enTurno: boolean
}

export interface PisoRepository {
  turnoActual(): Promise<PisoTurno | null>
  /** Una sola llamada: el turno abierto o, sin turno, el último cerrado de hoy. */
  estadoTurno(): Promise<EstadoTurnoPiso>
  traslados(dias?: number): Promise<TrasladosPisoResultado>
  iniciarTurno(sucursalId?: number): Promise<PisoTurno>
  finalizarTurno(): Promise<void>
  ventasPorReclamar(): Promise<VentaPorReclamar[]>
  reclamar(ventaId: number): Promise<ReclamoResultado>
  deshacerReclamo(ventaId: number): Promise<void>
  registrarNoRealizada(input: NoRealizadaInput): Promise<NoRealizadaResultado>
  cajaReclamos(ventaIds: number[]): Promise<CajaReclamo[]>
  cajaVendedoresPiso(): Promise<CajaVendedorPiso[]>
  /** `perfilId` null deja la venta sin dueño. Cambiar un dueño existente exige motivo. */
  cajaAsignarVendedor(ventaId: number, perfilId: string | null, motivo?: string): Promise<void>
}
