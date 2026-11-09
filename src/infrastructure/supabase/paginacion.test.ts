import { describe, expect, it, vi } from 'vitest'
import { leerTodo, porLotes } from './paginacion'

const paginasDe = (total: number) => {
  const filas = Array.from({ length: total }, (_, i) => ({ id: i + 1 }))
  const llamadas: Array<[number, number]> = []
  const pagina = vi.fn(async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta])
    return { data: filas.slice(desde, hasta + 1), error: null }
  })
  return { filas, llamadas, pagina }
}

describe('leerTodo', () => {
  it('une varias páginas en orden', async () => {
    const { filas, llamadas, pagina } = paginasDe(25)
    expect(await leerTodo(pagina, 10)).toEqual(filas)
    expect(llamadas).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('con una sola página corta no pide más', async () => {
    const { filas, pagina } = paginasDe(3)
    expect(await leerTodo(pagina, 10)).toEqual(filas)
    expect(pagina).toHaveBeenCalledTimes(1)
  })

  it('múltiplo exacto de tamano: pide una página vacía extra para confirmar el final', async () => {
    const { filas, llamadas, pagina } = paginasDe(20)
    expect(await leerTodo(pagina, 10)).toEqual(filas)
    expect(llamadas).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('sin filas devuelve [] con una sola llamada', async () => {
    const { pagina } = paginasDe(0)
    expect(await leerTodo(pagina, 10)).toEqual([])
    expect(pagina).toHaveBeenCalledTimes(1)
  })

  it('tolera data null cuando no hay error', async () => {
    expect(await leerTodo(async () => ({ data: null, error: null }))).toEqual([])
  })

  it('usa 1000 por defecto', async () => {
    const { filas, llamadas, pagina } = paginasDe(1500)
    expect(await leerTodo(pagina)).toEqual(filas)
    expect(llamadas).toEqual([[0, 999], [1000, 1999]])
  })

  it('un error a mitad de camino lanza el error original, nunca devuelve lo leído', async () => {
    const falla = { message: 'boom', code: '57014' }
    const pagina = vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 10 }, (_, i) => ({ id: i })), error: null })
      .mockResolvedValueOnce({ data: null, error: falla })
    await expect(leerTodo(pagina, 10)).rejects.toBe(falla)
    expect(pagina).toHaveBeenCalledTimes(2)
  })

  it('un error en la primera página también lanza', async () => {
    const falla = new Error('sin permiso')
    await expect(leerTodo(async () => ({ data: null, error: falla }))).rejects.toBe(falla)
  })

  it.each([0, -1, 1.5, 1001])('rechaza tamano inválido (%s)', async (tamano) => {
    await expect(leerTodo(async () => ({ data: [], error: null }), tamano)).rejects.toBeInstanceOf(RangeError)
  })
})

describe('porLotes', () => {
  it('parte los ids en lotes y concatena en orden', async () => {
    const lotes: number[][] = []
    const resultado = await porLotes([1, 2, 3, 4, 5], 2, async (lote) => { lotes.push(lote); return lote.map((n) => n * 10) })
    expect(lotes).toEqual([[1, 2], [3, 4], [5]])
    expect(resultado).toEqual([10, 20, 30, 40, 50])
  })

  it('sin ids no llama a leer', async () => {
    const leer = vi.fn()
    expect(await porLotes([], 200, leer)).toEqual([])
    expect(leer).not.toHaveBeenCalled()
  })

  it('lee los lotes de a uno, no en paralelo', async () => {
    let enCurso = 0
    let maximo = 0
    await porLotes([1, 2, 3, 4], 1, async (lote) => {
      enCurso += 1; maximo = Math.max(maximo, enCurso)
      await Promise.resolve()
      enCurso -= 1
      return lote
    })
    expect(maximo).toBe(1)
  })

  it('si un lote falla se rechaza y no lee los siguientes', async () => {
    const leer = vi.fn().mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error('falló')).mockResolvedValue([3])
    await expect(porLotes([1, 2, 3], 1, leer)).rejects.toThrow('falló')
    expect(leer).toHaveBeenCalledTimes(2)
  })

  it('no modifica el arreglo de entrada', async () => {
    const ids = [1, 2, 3]
    await porLotes(ids, 2, async (l) => l)
    expect(ids).toEqual([1, 2, 3])
  })

  it('rechaza tamano inválido', async () => {
    await expect(porLotes([1], 0, async (l) => l)).rejects.toBeInstanceOf(RangeError)
  })
})
