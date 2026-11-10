// Registrar pago → pestaña "Pedidos": el cajero marca a qué pedidos corresponde el dinero.
// Todo se calcula en centavos enteros para que la suma de las aplicaciones coincida exacto.
import { formatMoney, moneyFromDecimal } from '../common/money'

export interface PartidaAsignable { partidaId: number; pendiente: number }

/** Una fila de la tabla: un pedido abierto o una partida sin pedido ("saldo anterior"). */
export interface FilaAsignable {
  clave: string
  etiqueta: string
  fecha?: string
  pendiente: number
  partidas: PartidaAsignable[]
}

export interface Aplicacion { partidaId: number; monto: number }

export interface ResultadoAsignacion {
  /** Por fila marcada: cuánto se le aplica (Bs). Las no marcadas no aparecen. */
  filas: { clave: string; seAplica: number }[]
  aplicado: number
  sobrante: number
  aplicaciones: Aplicacion[]
}

const cents = (bs: number) => Math.round((bs + Number.EPSILON) * 100)
const bs = (c: number) => c / 100

export function asignarMonto(monto: number, filas: FilaAsignable[], marcadas: ReadonlySet<string> | readonly string[]): ResultadoAsignacion {
  const set = marcadas instanceof Set ? marcadas : new Set(marcadas as readonly string[])
  let restante = Math.max(0, cents(monto))
  const totalCents = restante
  const resultFilas: { clave: string; seAplica: number }[] = []
  const aplicaciones: Aplicacion[] = []
  for (const fila of filas) {
    if (!set.has(fila.clave)) continue
    const aplicaFila = Math.min(Math.max(0, cents(fila.pendiente)), restante)
    restante -= aplicaFila
    resultFilas.push({ clave: fila.clave, seAplica: bs(aplicaFila) })
    // Reparto dentro del pedido, partida por partida en el orden recibido.
    let porRepartir = aplicaFila
    fila.partidas.forEach((partida, i) => {
      if (porRepartir <= 0) return
      const esUltima = i === fila.partidas.length - 1
      // La última partida absorbe cualquier diferencia de redondeo para que la suma sea exacta.
      const parte = esUltima ? porRepartir : Math.min(Math.max(0, cents(partida.pendiente)), porRepartir)
      if (parte > 0) aplicaciones.push({ partidaId: partida.partidaId, monto: bs(parte) })
      porRepartir -= parte
    })
  }
  return { filas: resultFilas, aplicado: bs(totalCents - restante), sobrante: bs(restante), aplicaciones }
}

const MAX_FUERZA_BRUTA = 15

/**
 * Conjunto más chico de filas cuyo pendiente suma exactamente `monto` (± 0,005).
 * Empates: gana el conjunto con las filas más antiguas (filas llegan ordenadas, más antiguo primero).
 */
export function combinacionExacta(monto: number, filas: FilaAsignable[]): FilaAsignable[] | null {
  const objetivo = cents(monto)
  if (objetivo <= 0) return null
  const candidatas = filas
    .map((fila, indice) => ({ fila, indice, c: cents(fila.pendiente) }))
    .filter(x => x.c > 0)
  const n = candidatas.length
  if (!n) return null
  let mejor: number[] | null = null
  const mejorQue = (a: number[], b: number[] | null) => {
    if (!b) return true
    if (a.length !== b.length) return a.length < b.length
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return false
  }
  if (n <= MAX_FUERZA_BRUTA) {
    for (let mask = 1; mask < (1 << n); mask++) {
      let suma = 0
      const idx: number[] = []
      for (let i = 0; i < n; i++) if (mask & (1 << i)) { suma += candidatas[i].c; idx.push(i) }
      if (suma === objetivo && mejorQue(idx, mejor)) mejor = idx
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (candidatas[i].c === objetivo && mejorQue([i], mejor)) mejor = [i]
    }
    if (!mejor) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (candidatas[i].c + candidatas[j].c === objetivo && mejorQue([i, j], mejor)) mejor = [i, j]
      }
    }
  }
  return mejor ? mejor.map(i => candidatas[i].fila) : null
}

export const mensajeSobrante = (sobrante: number) =>
  `Sobran ${formatMoney(moneyFromDecimal(sobrante))}. Márcalo en otro pedido o usa la pestaña Anticipo.`

/** Motivo que bloquea el envío, o `null` si se puede registrar. */
export function validarCobroPedidos(input: { monto: number; filas: FilaAsignable[]; marcadas: ReadonlySet<string> | readonly string[] }): string | null {
  if (!(cents(input.monto) > 0)) return 'Escribe el monto recibido.'
  const set = input.marcadas instanceof Set ? input.marcadas : new Set(input.marcadas as readonly string[])
  const marcadasValidas = input.filas.filter(f => set.has(f.clave))
  if (!marcadasValidas.length) return 'Marca los pedidos que paga este dinero.'
  const { sobrante } = asignarMonto(input.monto, input.filas, set)
  const hayNoMarcadas = input.filas.some(f => !set.has(f.clave) && cents(f.pendiente) > 0)
  if (sobrante > 0 && hayNoMarcadas) return mensajeSobrante(sobrante)
  return null
}
