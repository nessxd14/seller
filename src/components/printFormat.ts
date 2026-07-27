// Shared localStorage key + type for the default ticket print format, set from
// Configuración > Impresión (src/features/settings/ConfigPage.tsx) and read as the
// initial value by TicketPreviewModal's own per-print format selector.
export type PrintFormat = 'ticket-58' | 'ticket-80'
export const PRINT_FORMAT_STORAGE_KEY = 'roari-print-format-v1'

export const readDefaultPrintFormat = (): PrintFormat => {
  const stored = localStorage.getItem(PRINT_FORMAT_STORAGE_KEY)
  return stored === 'ticket-58' || stored === 'ticket-80' ? stored : 'ticket-80'
}
