// Brief S11 Bloque B2: comparar dos versiones de pedido_version (la anterior y la que se
// está mirando) para marcar qué cambió — sin esto hay que comparar a ojo, que es
// justamente lo que el versionado viene a evitar. Tipo mínimo estructural, no importa el
// shape completo de infrastructure/supabase/OrderAdmin.supabase.ts (la capa de dominio no
// depende de infraestructura).
export interface VersionDiffLine {
  lineaId: number
  cantidadBase: number
  precioUnitario: number
}

export type LineDiffKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface LineDiffEntry {
  lineaId: number
  kind: LineDiffKind
  cantidadCambio: boolean
  precioCambio: boolean
}

/**
 * Compara `anterior` (versión previa, `undefined` si `actual` es la versión 1) contra
 * `actual` (la versión que se está mirando) y devuelve, por lineaId, qué cambió: agregada
 * (no estaba antes), quitada (estaba antes y ya no), o con cantidad/precio distinto.
 * Las líneas quitadas se devuelven en el Map aunque no estén en `actual` — el llamador
 * las necesita para pintarlas tachadas en la vista de la versión vieja.
 */
export const diffVersionLines = (anterior: VersionDiffLine[] | undefined, actual: VersionDiffLine[]): Map<number, LineDiffEntry> => {
  const prevById = new Map((anterior ?? []).map((l) => [l.lineaId, l]))
  const actualIds = new Set(actual.map((l) => l.lineaId))
  const result = new Map<number, LineDiffEntry>()
  for (const line of actual) {
    const prev = prevById.get(line.lineaId)
    if (!prev) {
      result.set(line.lineaId, { lineaId: line.lineaId, kind: 'added', cantidadCambio: false, precioCambio: false })
      continue
    }
    const cantidadCambio = prev.cantidadBase !== line.cantidadBase
    const precioCambio = prev.precioUnitario !== line.precioUnitario
    result.set(line.lineaId, { lineaId: line.lineaId, kind: cantidadCambio || precioCambio ? 'changed' : 'unchanged', cantidadCambio, precioCambio })
  }
  for (const prev of anterior ?? []) {
    if (!actualIds.has(prev.lineaId)) {
      result.set(prev.lineaId, { lineaId: prev.lineaId, kind: 'removed', cantidadCambio: false, precioCambio: false })
    }
  }
  return result
}
