// Datos de la vista "Pagos" para VITE_POS_MODE=mock (featureFlags.supabase = false). Basados en la maqueta aprobada.
import type { ClienteHistorial, FilaPago, HistorialPagos, ParamsHistorialPagos, ResumenPagos } from '../../domain/pagos/historialPagos'
import { hoyLaPaz } from '../../domain/pagos/historialPagos'
import { sumarDiasIso } from '../../domain/common/fechas'

interface ClienteMock { id: number; nombre: string; categoria: string; documento: string; pendienteHoy: number; aFavorHoy: number }
export const CLIENTES_MOCK: readonly ClienteMock[] = [
  { id: 9, nombre: 'MARIA YUJRA', categoria: 'mayorista', documento: '4455667', pendienteHoy: 0, aFavorHoy: 0 },
  { id: 44, nombre: 'BNB', categoria: 'corporativo', documento: '1016253021', pendienteHoy: 439.5, aFavorHoy: 0 },
  { id: 51, nombre: 'DDE-BENI', categoria: 'institucional', documento: '1023456022', pendienteHoy: 3200, aFavorHoy: 18150 },
]

type Base = Omit<FilaPago, 'fecha' | 'clave'> & { dias: number; hora: string; id: string }
const base = (b: Partial<Base> & Pick<Base, 'id' | 'dias' | 'hora' | 'clienteId' | 'cliente' | 'tipo' | 'estado'>): Base => ({
  clase: 'PAGO', pagoId: null, medio: null, monto: 0, usado: 0, aFavor: 0, referencia: null, referenciaImpresion: null,
  motivo: null, motivoDetalle: null, registradoPor: 'cajaroari1tdd', confirmadoPor: null, confirmadoEn: null, turnoDe: 'cajaroari1tdd', aplicaciones: [], ...b,
})

const FILAS_BASE: readonly Base[] = [
  base({ id: 'pago-391', pagoId: 391, dias: 1, hora: '15:59', clienteId: 9, cliente: 'MARIA YUJRA', tipo: 'CUENTA', medio: 'EFECTIVO', monto: 961, estado: 'CONFIRMADO', confirmadoPor: 'Rony', confirmadoEn: '2026-11-11T21:10:00Z',
    aplicaciones: [{ pedidoId: 678, referencia: 'PED-2026-00594', monto: 383 }, { pedidoId: 679, referencia: 'PED-2026-00596', monto: 578 }] }),
  base({ id: 'pago-392', pagoId: 392, dias: 1, hora: '11:20', clienteId: 51, cliente: 'DDE-BENI', tipo: 'ANTICIPO', medio: 'TRANSFERENCIA', monto: 18150, aFavor: 18150, estado: 'CONFIRMADO',
    referencia: 'Transferencia 7781203', referenciaImpresion: '7781203', registradoPor: 'juanmamanil331', confirmadoPor: 'Rony', confirmadoEn: '2026-11-11T17:00:00Z', turnoDe: 'juanmamanil331' }),
  base({ id: 'pago-393', pagoId: 393, dias: 0, hora: '09:41', clienteId: 51, cliente: 'DDE-BENI', tipo: 'ANTICIPO', medio: 'QR', monto: 989, aFavor: 989, estado: 'POR_VERIFICAR',
    motivo: 'ADELANTO_PEDIDO_FUTURO', motivoDetalle: null, registradoPor: 'juanmamanil331', turnoDe: 'juanmamanil331' }),
  // Historial del cliente BNB (3 pagos confirmados + 1 aplicación de saldo + 1 anulado que no se imprime).
  base({ id: 'pago-380', pagoId: 380, dias: 3, hora: '10:05', clienteId: 44, cliente: 'BNB', tipo: 'CUENTA', medio: 'TRANSFERENCIA', monto: 9669.5, estado: 'CONFIRMADO',
    referencia: 'Transferencia 5976098039', referenciaImpresion: '5976098039', confirmadoPor: 'Rony', confirmadoEn: '2026-11-09T16:00:00Z', turnoDe: 'juanmamanil331', registradoPor: 'juanmamanil331',
    aplicaciones: [{ pedidoId: 597, referencia: 'PED-00597', monto: 4600 }, { pedidoId: 600, referencia: 'PED-00600', monto: 4930 }, { pedidoId: 802, referencia: 'PED-00802', monto: 139.5 }] }),
  base({ id: 'pago-372', pagoId: 372, dias: 9, hora: '16:30', clienteId: 44, cliente: 'BNB', tipo: 'PEDIDO', medio: 'QR', monto: 8000, estado: 'CONFIRMADO', confirmadoPor: 'Rony', confirmadoEn: '2026-11-03T20:00:00Z',
    aplicaciones: [{ pedidoId: 590, referencia: 'PED-00590', monto: 8000 }] }),
  base({ id: 'pago-360', pagoId: 360, dias: 20, hora: '12:00', clienteId: 44, cliente: 'BNB', tipo: 'PEDIDO', medio: 'EFECTIVO', monto: 3530, estado: 'CONFIRMADO', confirmadoPor: 'Rony', confirmadoEn: '2026-10-23T17:00:00Z',
    aplicaciones: [{ pedidoId: 571, referencia: 'PED-00571', monto: 3530 }] }),
  base({ id: 'pago-365', pagoId: 365, dias: 14, hora: '10:00', clienteId: 44, cliente: 'BNB', tipo: 'PEDIDO', medio: 'EFECTIVO', monto: 500, estado: 'ANULADO', registradoPor: 'juanmamanil331', turnoDe: 'juanmamanil331',
    aplicaciones: [] }),
  base({ id: 'saldo-3', clase: 'SALDO', dias: 6, hora: '14:15', clienteId: 44, cliente: 'BNB', tipo: 'SALDO', usado: 9530, estado: 'CONFIRMADO', registradoPor: 'Rony', turnoDe: null,
    aplicaciones: [{ pedidoId: 580, referencia: 'PED-00580', monto: 2400 }, { pedidoId: 583, referencia: 'PED-00583', monto: 3100 }, { pedidoId: 585, referencia: 'PED-00585', monto: 2030 }, { pedidoId: 588, referencia: 'PED-00588', monto: 2000 }] }),
]

const aIso = (dias: number, hora: string): string => {
  const dia = sumarDiasIso(hoyLaPaz(), -dias)
  return `${dia}T${String((Number(hora.slice(0, 2)) + 4) % 24).padStart(2, '0')}:${hora.slice(3)}:00.000Z`
}
const fechaLaPaz = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' })

const redondear = (n: number) => Math.round(n * 100) / 100
const suma = (filas: FilaPago[], pick: (f: FilaPago) => number) => redondear(filas.reduce((s, f) => s + pick(f), 0))

export function consultarHistorialPagosMock(params: ParamsHistorialPagos, rol: string | undefined): HistorialPagos {
  const todas: FilaPago[] = FILAS_BASE.map(({ dias, hora, id, ...resto }) => ({ ...resto, clave: id, fecha: aIso(dias, hora) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  const q = params.buscar?.trim().toLowerCase()
  const filtradas = todas.filter(f => {
    const dia = fechaLaPaz(f.fecha)
    return dia >= params.desde && dia <= params.hasta
      && (params.clienteId == null || f.clienteId === params.clienteId)
      && (!params.tipo || f.tipo === params.tipo)
      && (!params.estado || f.estado === params.estado)
      && (!params.medio || f.medio === params.medio)
      && (!params.soloConfirmados || f.estado === 'CONFIRMADO')
      && (!q || f.cliente.toLowerCase().includes(q) || (f.referencia ?? '').toLowerCase().includes(q))
  })
  const offset = params.offset ?? 0
  const limite = params.limite ?? 100
  const confirmados = filtradas.filter(f => f.clase === 'PAGO' && f.estado === 'CONFIRMADO')
  const resumen: ResumenPagos | null = rol === 'admin' || rol === 'gerente' ? {
    recibido: suma(confirmados, f => f.monto),
    porVerificar: suma(filtradas.filter(f => f.clase === 'PAGO' && f.estado === 'POR_VERIFICAR'), f => f.monto),
    aFavor: suma(confirmados, f => f.aFavor),
    conSaldo: suma(filtradas.filter(f => f.clase === 'SALDO'), f => f.usado),
  } : null
  let cliente: ClienteHistorial | undefined
  if (params.clienteId != null) {
    const c = CLIENTES_MOCK.find(x => x.id === params.clienteId)
    const conSaldo = suma(filtradas.filter(f => f.clase === 'SALDO'), f => f.usado)
    cliente = c ? {
      sinCuenta: false, clienteId: c.id, nombre: c.nombre, categoria: c.categoria, documento: c.documento, pendienteHoy: c.pendienteHoy, aFavorHoy: c.aFavorHoy,
      periodo: { pagos: confirmados.length, recibido: suma(confirmados, f => f.monto), aplicadoPedidos: redondear(suma(confirmados, f => f.monto - f.aFavor) + conSaldo), conSaldo },
    } : { sinCuenta: true }
  }
  return { filas: filtradas.slice(offset, offset + limite), total: filtradas.length, resumen, cliente }
}
