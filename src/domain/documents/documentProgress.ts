import type { WorkflowLine } from '../../application/shared/models'

export const isInactiveDocumentLine = (line: WorkflowLine) =>
  ['CAMBIADA', 'RECHAZADO', 'RETIRADA'].includes(line.lineStatus ?? '')

export function documentLineProgress(line: WorkflowLine) {
  if (isInactiveDocumentLine(line)) return { dispatched: null, pending: 0 }
  const dispatched = line.dispatchedQuantity ?? (
    line.lineStatus === 'DESPACHADA' || line.lineStatus === 'COMPRADO_DIRECTO' ? line.quantity
      : line.lineStatus ? 0 : null
  )
  return { dispatched, pending: dispatched == null ? null : Math.max(0, line.quantity - dispatched) }
}

export const formatDocumentQuantity = (value: number) => value.toLocaleString('es-BO', { maximumFractionDigits: 6 })

export function formatDocumentDate(value?: string) {
  if (!value) return ''
  // Una fecha sin hora es un día de calendario, no medianoche UTC.
  const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (plainDate) return `${plainDate[3]}/${plainDate[2]}/${plainDate[1]}`
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-BO', {
    timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
