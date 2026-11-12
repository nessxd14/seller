import type { PisoRepository, PisoTurno } from '../../application/ports/pisoRepository'

const KEY = 'roari-piso-turno-v1'
const SUCURSAL_TIENDA = 2

const leer = (): PisoTurno | null => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as PisoTurno | null } catch { return null }
}

// Modo mock: solo el turno vive en este navegador; ventas de caja y reclamos no existen sin base.
export const pisoRepository: PisoRepository = {
  async turnoActual() { return leer() },
  async iniciarTurno(sucursalId) {
    const actual = leer()
    if (actual) return actual
    const turno: PisoTurno = { turnoId: Date.now(), inicio: new Date().toISOString(), sucursalId: sucursalId ?? SUCURSAL_TIENDA, cobradas: 0, porCobrar: 0, noRealizadas: 0, porReclamar: 0 }
    localStorage.setItem(KEY, JSON.stringify(turno))
    return turno
  },
  async finalizarTurno() { localStorage.removeItem(KEY) },
  async ventasPorReclamar() { return [] },
  async reclamar() { throw new Error('Las ventas de caja no están disponibles en modo mock.') },
  async deshacerReclamo() { throw new Error('Las ventas de caja no están disponibles en modo mock.') },
  async registrarNoRealizada(input) {
    if (!input.lineas.length) throw new Error('Agrega al menos un producto')
    return { visita: crypto.randomUUID(), lineas: input.lineas.map((l, i) => ({ demandaId: i + 1, motivo: l.motivo, ideaId: null, vecesSemana: null })) }
  },
  async cajaReclamos() { return [] },
  async cajaVendedoresPiso() { return [] },
  async cajaAsignarVendedor() { throw new Error('Asignar vendedor no está disponible en modo mock.') },
}
