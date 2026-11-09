// PostgREST corta cada respuesta en 1000 filas (db-max-rows) sin avisar. Estos helpers
// leen todo en páginas con .range() y lanzan ante cualquier error: nunca devuelven []
// para tapar una falla.

export const TAMANO_PAGINA = 1000

interface RespuestaPagina<T> { data: T[] | null; error: unknown }

/**
 * Lee todas las filas de una consulta, página a página con `.range(desde, hasta)`, hasta
 * que una página llega más corta que `tamano`.
 *
 * REQUISITO: la consulta que arma `pagina` DEBE llevar `.order()` sobre una columna única
 * (o una combinación única). Sin un orden total, Postgres puede devolver las filas en otro
 * orden entre una página y la siguiente y el resultado repite o se salta filas sin error.
 * Si la vista no tiene clave única, se ordena por todas las columnas seleccionadas: filas
 * idénticas son intercambiables, así que el resultado sigue siendo correcto.
 *
 * `tamano` no puede superar el tope del servidor (1000): con un valor mayor la primera
 * página volvería más corta que `tamano` y la lectura terminaría truncada.
 *
 * Lanza el `error` de PostgREST tal cual si cualquier página falla, aunque ya haya leído
 * otras.
 */
export async function leerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<RespuestaPagina<T>>,
  tamano: number = TAMANO_PAGINA,
): Promise<T[]> {
  if (!Number.isInteger(tamano) || tamano < 1 || tamano > TAMANO_PAGINA) {
    throw new RangeError(`leerTodo: tamano debe ser un entero entre 1 y ${TAMANO_PAGINA}`)
  }
  const filas: T[] = []
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await pagina(desde, desde + tamano - 1)
    if (error) throw error
    const lote = data ?? []
    filas.push(...lote)
    if (lote.length < tamano) return filas
  }
}

/**
 * Parte `ids` en lotes de `tamano` y concatena lo que devuelve `leer` para cada uno, en
 * orden y de a uno (no en paralelo). Sirve para `.in(...)` y para endpoints con tope de
 * ids. Si un lote falla, la promesa se rechaza y no se leen los siguientes.
 */
export async function porLotes<I, T>(
  ids: readonly I[],
  tamano: number,
  leer: (lote: I[]) => Promise<T[]>,
): Promise<T[]> {
  if (!Number.isInteger(tamano) || tamano < 1) throw new RangeError('porLotes: tamano debe ser un entero positivo')
  const resultado: T[] = []
  for (let i = 0; i < ids.length; i += tamano) {
    resultado.push(...(await leer(ids.slice(i, i + tamano))))
  }
  return resultado
}
