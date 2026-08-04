/**
 * Huella estable de un intento de cobro. Dos llamadas con el mismo contenido dan la misma
 * huella (y por lo tanto reusan la clave de idempotencia: eso es un reintento legítimo);
 * cualquier cambio en lo que se cobra da una huella distinta (y por lo tanto una venta nueva).
 *
 * Se ordenan las líneas antes de concatenar: reordenar el carrito no cambia lo que se cobra.
 * Se usa el precio unitario NETO en centavos —el mismo que viaja a registrar_venta— para que
 * un cambio de descuento de línea cuente como contenido distinto.
 */
export interface CheckoutFingerprintInput {
  lines: Array<{
    productId: string
    quantity: number
    unitPriceCents: number
    presentacionId?: number
    sourceLocation?: string
  }>
  discountCents: number
  customerId?: string
  cashSessionId: string
}

// cyrb53: hash no criptográfico, 53 bits, síncrono. No hace falta crypto.subtle (que es
// asíncrono y obligaría a volver async toda la cadena). El riesgo de colisión solo importa
// entre intentos de una MISMA operación —un puñado de valores—, así que 53 bits sobran.
const cyrb53 = (texto: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const checkoutFingerprint = (input: CheckoutFingerprintInput): string => {
  const lineas = input.lines
    .map((l) => [l.productId, l.quantity, l.unitPriceCents, l.presentacionId ?? '', l.sourceLocation ?? ''].join('|'))
    .sort()
    .join(';')
  return cyrb53(`${input.cashSessionId}#${input.customerId ?? ''}#${input.discountCents}#${lineas}`)
}
