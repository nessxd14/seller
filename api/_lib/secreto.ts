import { timingSafeEqual } from 'node:crypto'

// Comparación de secretos compartidos en tiempo constante. timingSafeEqual con buffers de
// largo distinto tira, así que el único dato que se filtra por timing es el LARGO del
// header (no el secreto en sí). La carpeta empieza con `_` para que Vercel no la exponga
// como ruta (mismo criterio que api/hermes/_auth.ts).
export function secretoValido(header: string | string[] | undefined, secreto: string): boolean {
  const valor = Array.isArray(header) ? header[0] : header
  if (!valor) return false
  const provisto = Buffer.from(valor)
  const esperado = Buffer.from(secreto)
  if (provisto.length !== esperado.length) return false
  return timingSafeEqual(provisto, esperado)
}
