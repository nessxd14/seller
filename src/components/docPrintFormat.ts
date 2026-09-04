// Brief "Correcciones de impresión de documentos" — Parte 3: formato rollo (80mm) para
// cotización y nota de entrega. Distinto del formato de ticket de venta
// (printFormat.ts / PRINT_FORMAT_STORAGE_KEY) — son universos de documentos separados
// (ticket de venta vs. cotización/pedido/nota de entrega), con su propio default en
// Configuración > Impresión.
export type DocPrintFormat = 'carta' | 'rollo-80'
export const DOC_PRINT_FORMAT_STORAGE_KEY = 'roari-doc-print-format-v1'

export const readDefaultDocPrintFormat = (): DocPrintFormat => {
  const stored = localStorage.getItem(DOC_PRINT_FORMAT_STORAGE_KEY)
  return stored === 'rollo-80' ? stored : 'carta'
}
