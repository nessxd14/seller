// Brief T2 Tarea 3: buscar "jose perez" tiene que encontrar "José Pérez" — que no lo
// encuentre es justamente lo que hace que el vendedor no reconozca al cliente que ya
// existe y cree un duplicado. `ilike` en Postgres es case-insensitive pero NO ignora
// acentos, así que la normalización tiene que pasar por acá antes de comparar.
export const normalizarBusqueda = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const coincideBusqueda = (haystack: string, query: string): boolean => {
  const q = normalizarBusqueda(query)
  if (!q) return true
  return normalizarBusqueda(haystack).includes(q)
}
