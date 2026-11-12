import type { AnotarDemandaInput, DemandaPrevia, DemandaRepository } from '../../application/ports/demandaRepository'

const KEY = 'roari-demanda-v1'
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000

interface Nota extends AnotarDemandaInput { id: number; creadoEn: number }

const leer = (): Nota[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Nota[] } catch { return [] }
}

// Misma regla de agrupación que la base, simplificada: mismo producto, o mismo texto en minúsculas.
const clave = (n: { productoId: number | null; descripcion: string | null }) =>
  n.productoId != null ? `p:${n.productoId}` : `t:${(n.descripcion ?? '').trim().toLowerCase()}`

const resumen = (notas: Nota[], productoId: number | null, descripcion: string | null): DemandaPrevia => {
  const k = clave({ productoId, descripcion })
  const iguales = notas.filter((n) => clave(n) === k)
  const desde = Date.now() - SEMANA_MS
  const primera = iguales[0]
  return {
    ideaId: primera ? primera.id : null,
    titulo: primera ? (primera.descripcion ?? `Producto ${primera.productoId}`) : null,
    estado: primera ? 'ABIERTA' : null,
    via: null,
    vecesSemana: iguales.filter((n) => n.creadoEn >= desde).length,
    vecesTotal: iguales.length,
  }
}

export const demandaRepository: DemandaRepository = {
  async previa(productoId, descripcion) { return resumen(leer(), productoId, descripcion) },
  async anotar(input) {
    if (input.productoId == null && !input.descripcion?.trim()) throw new Error('Indica qué buscó el cliente.')
    if (input.quiereAviso && !input.contactoTel?.trim()) throw new Error('Para avisarle al cliente hace falta su teléfono')
    const notas = leer()
    const id = notas.length + 1
    const siguiente = [...notas, { ...input, id, creadoEn: Date.now() }]
    localStorage.setItem(KEY, JSON.stringify(siguiente))
    return { demandaId: id, ...resumen(siguiente, input.productoId, input.descripcion) }
  },
  async subirFoto(file) { return `mock/${crypto.randomUUID()}-${file.name}` },
}
