import { aceptarEstado, type PantallaEstado, type PantallaFase, type PantallaLinea } from '../../domain/pantalla/pantallaCliente'

/** Sin mensajes del emisor durante este tiempo, la tablet muestra reposo + «Sin conexión con caja». */
export const PANTALLA_SIN_CONEXION_MS = 35_000
/** Tiempo que se ve una corrección de cantidad o una línea quitada. */
export const PANTALLA_CORRECCION_MS = 2_500

export interface CorreccionLinea {
  id: number
  key: string
  tipo: 'cantidad' | 'quitado'
  cantidadAnterior?: number
  /** Solo en 'quitado': la línea ya no viene en el snapshot, se toma del anterior. */
  lineaQuitada?: PantallaLinea
}

export interface PantallaVista {
  estado: PantallaEstado | null
  sinConexion: boolean
  correccion: CorreccionLinea | null
  correccionSiguienteId: number
}

export type PantallaAccion =
  | { tipo: 'estado'; estado: PantallaEstado }
  | { tipo: 'sin-conexion' }
  | { tipo: 'correccion-vencida'; id: number }

export const vistaInicial: PantallaVista = { estado: null, sinConexion: false, correccion: null, correccionSiguienteId: 1 }

/** Qué corrección visual provoca el paso de un snapshot al siguiente (a partir de `ultimaKey` + `ultimoCambio`). */
export function derivarCorreccion(anterior: PantallaEstado | null, nuevo: PantallaEstado): Omit<CorreccionLinea, 'id'> | null {
  if (!anterior || !nuevo.ultimaKey) return null
  const key = nuevo.ultimaKey
  const previa = anterior.lineas.find((linea) => linea.key === key)
  const actual = nuevo.lineas.find((linea) => linea.key === key)
  if (nuevo.ultimoCambio === 'cantidad' && previa && actual && previa.cantidad !== actual.cantidad) {
    return { key, tipo: 'cantidad', cantidadAnterior: previa.cantidad }
  }
  if (nuevo.ultimoCambio === 'quitado' && previa && !actual) return { key, tipo: 'quitado', lineaQuitada: previa }
  return null
}

export function reducirVista(vista: PantallaVista, accion: PantallaAccion): PantallaVista {
  if (accion.tipo === 'sin-conexion') return vista.sinConexion ? vista : { ...vista, sinConexion: true }
  if (accion.tipo === 'correccion-vencida') return vista.correccion?.id === accion.id ? { ...vista, correccion: null } : vista
  // Un seq menor del mismo emisor se ignora; un emisor nuevo siempre se acepta (ver aceptarEstado).
  if (!aceptarEstado(vista.estado, accion.estado)) return vista.sinConexion ? { ...vista, sinConexion: false } : vista
  const derivada = derivarCorreccion(vista.estado, accion.estado)
  return {
    estado: accion.estado,
    sinConexion: false,
    correccion: derivada ? { ...derivada, id: vista.correccionSiguienteId } : vista.correccion,
    correccionSiguienteId: derivada ? vista.correccionSiguienteId + 1 : vista.correccionSiguienteId,
  }
}

/** La fase que se dibuja: sin conexión o sin mensajes todavía, reposo. */
export const faseVisible = (vista: PantallaVista): PantallaFase => (vista.sinConexion || !vista.estado ? 'reposo' : vista.estado.fase)
