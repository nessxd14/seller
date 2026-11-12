export type DemandaCanal = 'TIENDA' | 'MAYOR'
export type DemandaUnidad = 'UNIDADES' | 'HOJAS' | 'PAQUETES' | 'CAJAS'
export type DemandaEstado = 'ABIERTA' | 'SEGUIR_MIRANDO' | 'TRAER' | 'DESCARTADA' | 'LLEGO'
export type DemandaVia = 'OC' | 'EVENTUAL' | 'IMPORTACION'

export interface DemandaPrevia {
  ideaId: number | null
  titulo: string | null
  estado: DemandaEstado | null
  via: DemandaVia | null
  vecesSemana: number
  vecesTotal: number
}

export interface AnotarDemandaInput {
  productoId: number | null
  descripcion: string | null
  canal: DemandaCanal
  cantidadAprox: number
  unidad: DemandaUnidad
  contactoNombre: string | null
  contactoTel: string | null
  quiereAviso: boolean
  fotoPath: string | null
}

export interface AnotarDemandaResultado extends DemandaPrevia {
  demandaId: number
}

export interface DemandaRepository {
  previa(productoId: number | null, descripcion: string | null): Promise<DemandaPrevia>
  anotar(input: AnotarDemandaInput): Promise<AnotarDemandaResultado>
  /** Sube la foto (comprimida en el cliente) y devuelve el path dentro del bucket `demanda_fotos`. */
  subirFoto(file: File): Promise<string>
}
