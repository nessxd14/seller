// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  previa: vi.fn(), anotar: vi.fn(), subirFoto: vi.fn(), search: vi.fn(), stock: vi.fn(),
}))
vi.mock('../../../infrastructure/services', () => ({
  demandaRepository: { previa: mocks.previa, anotar: mocks.anotar, subirFoto: mocks.subirFoto },
  productRepository: { search: mocks.search },
  getStockBySucursalBatch: mocks.stock,
}))
import { HojaDemanda } from '../HojaDemanda'

const sinPrevia = { ideaId: null, titulo: null, estado: null, via: null, vecesSemana: 0, vecesTotal: 0 }
const resultado = { demandaId: 1, ideaId: 5, titulo: 'x', estado: 'ABIERTA', via: null, vecesSemana: 3, vecesTotal: 3 }
const resma = { id: 7, nombre: 'Hoja bond carta', sku: 'HB', precioRetail: 1 }

const abrir = (extra: Partial<Parameters<typeof HojaDemanda>[0]> = {}) => {
  const onClose = vi.fn()
  const onAnotado = vi.fn()
  render(<HojaDemanda onClose={onClose} onAnotado={onAnotado} {...extra} />)
  return { onClose, onAnotado }
}
const escribir = (texto: string) => fireEvent.change(screen.getByLabelText('¿Qué buscó?'), { target: { value: texto } })
const boton = () => screen.getByRole('button', { name: 'Anotar' }) as HTMLButtonElement

beforeEach(() => {
  mocks.previa.mockReset().mockResolvedValue(sinPrevia)
  mocks.anotar.mockReset().mockResolvedValue(resultado)
  mocks.subirFoto.mockReset().mockResolvedValue('uid/foto.jpg')
  mocks.search.mockReset().mockResolvedValue({ items: [resma], total: 1 })
  mocks.stock.mockReset().mockResolvedValue(new Map([[7, { tiendaVendible: 0, almacenVendible: 0 }]]))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('HojaDemanda', () => {
  it('texto libre: anota con productoId null y la descripción', async () => {
    const { onAnotado } = abrir()
    expect(boton().disabled).toBe(true)
    escribir('Cuaderno forrado')
    expect(boton().disabled).toBe(false)
    fireEvent.click(boton())
    await waitFor(() => expect(onAnotado).toHaveBeenCalledWith(3))
    expect(mocks.anotar).toHaveBeenCalledWith(expect.objectContaining({ productoId: null, descripcion: 'Cuaderno forrado', canal: 'TIENDA', unidad: 'UNIDADES', cantidadAprox: 1, fotoPath: null }))
  })

  it('producto del catálogo: manda el id, sin texto, y marca "Sin stock"', async () => {
    abrir()
    escribir('hoja')
    const opcion = await screen.findByRole('button', { name: /Hoja bond carta/ })
    await waitFor(() => expect(screen.getByText('Sin stock')).toBeTruthy())
    expect(screen.getByText('sin stock en Tienda ni Almacén')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Anotar «hoja» como producto que no tenemos/ })).toBeTruthy()
    fireEvent.click(opcion)
    fireEvent.click(boton())
    await waitFor(() => expect(mocks.anotar).toHaveBeenCalled())
    expect(mocks.anotar).toHaveBeenCalledWith(expect.objectContaining({ productoId: 7, descripcion: null }))
  })

  it('"Quiere que le avisen" sin teléfono bloquea Anotar', () => {
    abrir()
    escribir('Tijeras')
    fireEvent.click(screen.getByLabelText('Quiere que le avisen cuando llegue'))
    expect(boton().disabled).toBe(true)
    expect(screen.getByText(/hace falta su teléfono/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '71234567' } })
    expect(boton().disabled).toBe(false)
  })

  it('muestra el aviso de repetición desde previa', async () => {
    mocks.previa.mockResolvedValue({ ...sinPrevia, ideaId: 2, estado: 'TRAER', vecesSemana: 3, vecesTotal: 4 })
    abrir({ textoInicial: 'Tijeras' })
    expect(await screen.findByText('Ya la pidieron 3 veces esta semana. Tu anotación se suma a esas.')).toBeTruthy()
    expect(screen.getByText('Ya se está trayendo.')).toBeTruthy()
    expect(mocks.previa).toHaveBeenCalledWith(null, 'Tijeras')
  })

  it('sube la foto antes de anotar y pasa el path', async () => {
    const orden: string[] = []
    mocks.subirFoto.mockImplementation(async () => { orden.push('foto'); return 'uid/foto.jpg' })
    mocks.anotar.mockImplementation(async () => { orden.push('anotar'); return resultado })
    abrir({ textoInicial: 'Tijeras' })
    const archivo = new File(['x'], 'f.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Foto de referencia (opcional)'), { target: { files: [archivo] } })
    expect(await screen.findByRole('button', { name: 'Quitar foto' })).toBeTruthy()
    fireEvent.click(boton())
    await waitFor(() => expect(mocks.anotar).toHaveBeenCalled())
    expect(orden).toEqual(['foto', 'anotar'])
    expect(mocks.anotar).toHaveBeenCalledWith(expect.objectContaining({ fotoPath: 'uid/foto.jpg' }))
  })

  it('error: conserva el formulario y muestra el mensaje; sin conexión usa el texto fijo', async () => {
    mocks.anotar.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'))
    const { onAnotado } = abrir({ textoInicial: 'Tijeras' })
    fireEvent.click(boton())
    expect((await screen.findByRole('alert')).textContent).toBe('Sin conexión: no se pudo anotar. Inténtalo de nuevo.')
    expect(onAnotado).not.toHaveBeenCalled()
    expect((screen.getByLabelText('¿Qué buscó?') as HTMLInputElement).value).toBe('Tijeras')
  })
})
