// Brief T1 — Tarea 5: nombre de archivo al imprimir/guardar como PDF.
// window.print() no da otra palanca sobre el nombre del PDF que Chrome
// genera — usa document.title tal cual. Lógica pura, separada del componente
// que la usa (DocumentoExportable/TrasladoExportable) para poder testear las
// reglas de sanitización sin un DOM.

const CARACTERES_ILEGALES = /[/\\:*?"<>|]/g
const DIACRITICOS = /[\u0300-\u036f]/g

// Sanitiza un texto libre (nombre de cliente, destino, etc.) antes de
// concatenarlo al nombre de archivo: sin acentos, sin caracteres que rompen
// nombres de archivo en Windows/macOS, sin espacios repetidos, acotado a 60
// caracteres — reglas fáciles de romper sin darse cuenta, por eso viven
// juntas y testeadas acá en vez de repetidas inline en cada componente.
export function sanitizarParaArchivo(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .replace(CARACTERES_ILEGALES, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

// "PED-2026-00123 - Ferreteria Los Andes" — sin cliente (o si queda vacío
// tras sanitizar), solo el número.
export function nombreArchivoDocumento(numero: string, cliente?: string): string {
  const clienteLimpio = cliente ? sanitizarParaArchivo(cliente) : ''
  return clienteLimpio ? `${numero} - ${clienteLimpio}` : numero
}
