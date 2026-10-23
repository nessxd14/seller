// Los atajos de los avisos (T9) abren la sesión de edición ya encaminada. Viajan en la URL
// (?intento=…) para sobrevivir a un refresco y para que /pedidos/:id/editar siga siendo un
// enlace válido por sí solo.
export type IntentoEdicion =
  | { tipo: 'precio_propio'; itemId: number; lineaId: number | null }
  | { tipo: 'a_compra'; itemId: number }
  | { tipo: 'reemplazar'; itemId: number }

export const intentoAQuery = (intento: IntentoEdicion): string => {
  const params = new URLSearchParams({ intento: intento.tipo, item: String(intento.itemId) })
  if (intento.tipo === 'precio_propio' && intento.lineaId != null) params.set('linea', String(intento.lineaId))
  return `?${params.toString()}`
}

export const queryAIntento = (search: string): IntentoEdicion | null => {
  const params = new URLSearchParams(search)
  const tipo = params.get('intento')
  const itemId = Number(params.get('item'))
  if (!Number.isFinite(itemId) || params.get('item') == null) return null
  if (tipo === 'precio_propio') {
    const linea = params.get('linea')
    return { tipo, itemId, lineaId: linea != null && Number.isFinite(Number(linea)) ? Number(linea) : null }
  }
  if (tipo === 'a_compra' || tipo === 'reemplazar') return { tipo, itemId }
  return null
}
