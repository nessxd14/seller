// Validadores de entrada compartidos por los endpoints de api/. Todos son estrictos con el
// tipo: nada de Number(x) sobre objetos/arrays (Number([5]) === 5 colaba arrays).

const ENTERO_POSITIVO_TEXTO = /^[1-9]\d{0,15}$/

/** Entero positivo seguro, como number o como string de dígitos (los ids bigint de la base
 *  viajan como string en la cola de reintentos). Devuelve null si no cumple. */
export function enteroPositivo(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0 ? valor : null
  if (typeof valor === 'string' && ENTERO_POSITIVO_TEXTO.test(valor)) {
    const n = Number(valor)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

/** Lista de enteros positivos, con tope. Devuelve null si algo no cumple. */
export function listaEnterosPositivos(valor: unknown, max: number): number[] | null {
  if (!Array.isArray(valor) || valor.length > max) return null
  const out: number[] = []
  for (const item of valor) {
    const n = typeof item === 'number' ? enteroPositivo(item) : null
    if (n === null) return null
    out.push(n)
  }
  return out
}
