export type AppRoute =
  | { kind: 'pedido'; id: string }
  | { kind: 'cotizacion'; id: string }
  | { kind: 'venta'; id: string }
  | { kind: 'none' }

/** Brief S3: solo estas tres rutas de detalle — el resto de la app sigue navegando por
 * `activeModule` como siempre. */
export const parseRoute = (pathname: string): AppRoute => {
  const pedido = pathname.match(/^\/pedidos\/([^/]+)\/?$/)
  if (pedido) return { kind: 'pedido', id: decodeURIComponent(pedido[1]) }
  const cotizacion = pathname.match(/^\/cotizaciones\/([^/]+)\/?$/)
  if (cotizacion) return { kind: 'cotizacion', id: decodeURIComponent(cotizacion[1]) }
  const venta = pathname.match(/^\/ventas\/([^/]+)\/?$/)
  if (venta) return { kind: 'venta', id: decodeURIComponent(venta[1]) }
  return { kind: 'none' }
}

export const pedidoPath = (id: string): string => `/pedidos/${encodeURIComponent(id)}`
export const cotizacionPath = (id: string): string => `/cotizaciones/${encodeURIComponent(id)}`
export const ventaPath = (id: string): string => `/ventas/${encodeURIComponent(id)}`
