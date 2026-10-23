export type AppRoute =
  | { kind: 'pedido'; id: string }
  | { kind: 'pedidoEditar'; id: string }
  | { kind: 'cotizacion'; id: string }
  | { kind: 'venta'; id: string }
  | { kind: 'piso' }
  | { kind: 'none' }

/** Brief S3: solo estas tres rutas de detalle — el resto de la app sigue navegando por
 * `activeModule` como siempre. */
export const parseRoute = (pathname: string): AppRoute => {
  const editar = pathname.match(/^\/pedidos\/([^/]+)\/editar\/?$/)
  if (editar) return { kind: 'pedidoEditar', id: decodeURIComponent(editar[1]) }
  const pedido = pathname.match(/^\/pedidos\/([^/]+)\/?$/)
  if (pedido) return { kind: 'pedido', id: decodeURIComponent(pedido[1]) }
  const cotizacion = pathname.match(/^\/cotizaciones\/([^/]+)\/?$/)
  if (cotizacion) return { kind: 'cotizacion', id: decodeURIComponent(cotizacion[1]) }
  const venta = pathname.match(/^\/ventas\/([^/]+)\/?$/)
  if (venta) return { kind: 'venta', id: decodeURIComponent(venta[1]) }
  if (/^\/piso\/?$/.test(pathname)) return { kind: 'piso' }
  return { kind: 'none' }
}

export const pedidoPath = (id: string): string => `/pedidos/${encodeURIComponent(id)}`
export const pedidoEditarPath = (id: string): string => `/pedidos/${encodeURIComponent(id)}/editar`
export const cotizacionPath = (id: string): string => `/cotizaciones/${encodeURIComponent(id)}`
export const ventaPath = (id: string): string => `/ventas/${encodeURIComponent(id)}`
export const pisoPath = '/piso'
