// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ previa: vi.fn(), subirFoto: vi.fn(), registrar: vi.fn(), search: vi.fn(), stock: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  demandaRepository: { previa: mocks.previa, subirFoto: mocks.subirFoto },
  pisoRepository: { registrarNoRealizada: mocks.registrar },
  productRepository: { search: mocks.search },
  getStockBySucursalBatch: mocks.stock,
}))
import { HojaNoRealizada } from '../HojaNoRealizada'

const sinPrevia = { ideaId: null, titulo: null, estado: null, via: null, vecesSemana: 0, vecesTotal: 0 }
const resma = { id: 7, nombre: 'Hoja bond carta', sku: 'HB', precioRetail: 1 }

const abrir = (extra: Partial<Parameters<typeof HojaNoRealizada>[0]> = {}) => {
  const onClose = vi.fn()
  const onGuardado = vi.fn()
  render(<HojaNoRealizada onClose={onClose} onGuardado={onGuardado} {...extra} />)
  return { onClose, onGuardado }
}
const guardar = () => screen.getByRole('button', { name: 'Guardar venta no realizada' }) as HTMLButtonElement
const escribir = (n: number, texto: string) => fireEvent.change(screen.getByLabelText(`Producto ${n}`), { target: { value: texto } })
const motivo = (n: number, texto: string) => fireEvent.click(within(screen.getByRole('group', { name: `Por qué no lo llevó, producto ${n}` })).getByRole('button', { name: texto }))

beforeEach(() => {
  mocks.previa.mockReset().mockResolvedValue(sinPrevia)
  mocks.subirFoto.mockReset().mockResolvedValue('uid/foto.jpg')
  mocks.registrar.mockReset().mockResolvedValue({ visita: 'v1', lineas: [{ demandaId: 1, motivo: 'NO_HAY', ideaId: 5, vecesSemana: 3 }] })
  mocks.search.mockReset().mockResolvedValue({ items: [resma], total: 1 })
  mocks.stock.mockReset().mockResolvedValue(new Map([[7, { tiendaVendible: 0, almacenVendible: 0 }]]))
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('HojaNoRealizada', () => {
  it('cada producto necesita un motivo antes de poder guardar', () => {
    abrir({ textoInicial: 'Cuaderno forrado' })
    expect(guardar().disabled).toBe(true)
    motivo(1, 'Muy caro')
    expect(guardar().disabled).toBe(false)
  })

  it('"Otro" exige un texto de máximo 60 caracteres', () => {
    abrir({ textoInicial: 'Mochila' })
    motivo(1, 'Otro')
    expect(guardar().disabled).toBe(true)
    const texto = screen.getByLabelText('Motivo en una palabra, producto 1') as HTMLInputElement
    expect(texto.maxLength).toBe(60)
    fireEvent.change(texto, { target: { value: 'color' } })
    expect(guardar().disabled).toBe(false)
  })

  it('el aviso al cliente está desactivado sin una línea "No hay"', () => {
    abrir({ textoInicial: 'Tijeras' })
    const boton = screen.getByRole('button', { name: /Avisar al cliente cuando llegue/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    motivo(1, 'Muy caro')
    expect(boton.disabled).toBe(true)
    motivo(1, 'No hay')
    expect(boton.disabled).toBe(false)
    fireEvent.click(boton)
    fireEvent.click(screen.getByLabelText('Quiere que le avisen cuando llegue'))
    expect(guardar().disabled).toBe(true)
    expect(screen.getByText(/hace falta su teléfono/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '71234567' } })
    expect(guardar().disabled).toBe(false)
  })

  it('manda al repositorio un payload por línea con su motivo, y avisa las veces de la semana', async () => {
    const { onGuardado } = abrir({ textoInicial: 'Cartulina dorada' })
    motivo(1, 'No hay')
    fireEvent.click(screen.getByRole('button', { name: /Agregar otro producto/ }))
    escribir(2, 'hoja')
    fireEvent.click(await screen.findByRole('button', { name: /Hoja bond carta/ }))
    motivo(2, 'Muy caro')
    fireEvent.click(screen.getByRole('button', { name: /Agregar otro producto/ }))
    escribir(3, 'Mochila')
    motivo(3, 'Otro')
    fireEvent.change(screen.getByLabelText('Motivo en una palabra, producto 3'), { target: { value: ' color ' } })
    fireEvent.change(screen.getByLabelText('Cantidad 1'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Unidad 1'), { target: { value: 'HOJAS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Por mayor' }))
    fireEvent.click(screen.getByRole('button', { name: /Avisar al cliente cuando llegue/ }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '70000001' } })
    fireEvent.click(screen.getByLabelText('Quiere que le avisen cuando llegue'))
    fireEvent.click(guardar())
    await waitFor(() => expect(onGuardado).toHaveBeenCalledWith(3))
    expect(mocks.registrar).toHaveBeenCalledWith({
      lineas: [
        { productoId: null, descripcion: 'Cartulina dorada', cantidad: 20, unidad: 'HOJAS', motivo: 'NO_HAY', motivoTexto: null },
        { productoId: 7, descripcion: null, cantidad: 1, unidad: 'UNIDADES', motivo: 'MUY_CARO', motivoTexto: null },
        { productoId: null, descripcion: 'Mochila', cantidad: 1, unidad: 'UNIDADES', motivo: 'OTRO', motivoTexto: 'color' },
      ],
      canal: 'MAYOR', contactoNombre: 'Ana', contactoTel: '70000001', quiereAviso: true, fotoPath: null,
    })
  })

  it('sin línea "No hay" no manda contacto, aviso ni foto aunque se hayan llenado antes', async () => {
    const { onGuardado } = abrir({ textoInicial: 'Tijeras' })
    motivo(1, 'No hay')
    fireEvent.click(screen.getByRole('button', { name: /Avisar al cliente cuando llegue/ }))
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '71234567' } })
    fireEvent.click(screen.getByLabelText('Quiere que le avisen cuando llegue'))
    motivo(1, 'Muy caro')
    fireEvent.click(guardar())
    await waitFor(() => expect(onGuardado).toHaveBeenCalled())
    expect(mocks.registrar).toHaveBeenCalledWith(expect.objectContaining({ contactoNombre: null, contactoTel: null, quiereAviso: false, fotoPath: null }))
  })

  it('sube la foto antes de guardar y pasa el path', async () => {
    const orden: string[] = []
    mocks.subirFoto.mockImplementation(async () => { orden.push('foto'); return 'uid/foto.jpg' })
    mocks.registrar.mockImplementation(async () => { orden.push('guardar'); return { visita: 'v', lineas: [] } })
    abrir({ textoInicial: 'Tijeras' })
    motivo(1, 'No hay')
    fireEvent.click(screen.getByRole('button', { name: /Avisar al cliente cuando llegue/ }))
    fireEvent.change(screen.getByLabelText('Foto de referencia (opcional)'), { target: { files: [new File(['x'], 'f.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('button', { name: 'Quitar foto' })
    fireEvent.click(guardar())
    await waitFor(() => expect(mocks.registrar).toHaveBeenCalled())
    expect(orden).toEqual(['foto', 'guardar'])
    expect(mocks.registrar).toHaveBeenCalledWith(expect.objectContaining({ fotoPath: 'uid/foto.jpg' }))
  })

  it('"No hay" muestra el aviso de repetición de demanda_previa', async () => {
    mocks.previa.mockResolvedValue({ ...sinPrevia, ideaId: 2, estado: 'TRAER', vecesSemana: 3, vecesTotal: 4 })
    abrir({ textoInicial: 'Tijeras' })
    motivo(1, 'No hay')
    expect(await screen.findByText('Ya la pidieron 3 veces esta semana. Tu anotación se suma a esas.')).toBeTruthy()
    expect(mocks.previa).toHaveBeenCalledWith(null, 'Tijeras')
  })

  it('producto del catálogo: manda el id y marca "Sin stock"', async () => {
    abrir()
    escribir(1, 'hoja')
    await waitFor(() => expect(screen.getByText('Sin stock')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Hoja bond carta/ }))
    motivo(1, 'Muy caro')
    fireEvent.click(guardar())
    await waitFor(() => expect(mocks.registrar).toHaveBeenCalled())
    expect(mocks.registrar.mock.calls[0][0].lineas[0]).toMatchObject({ productoId: 7, descripcion: null })
  })

  it('error: conserva el formulario; sin conexión usa el texto fijo', async () => {
    mocks.registrar.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'))
    const { onGuardado } = abrir({ textoInicial: 'Tijeras' })
    motivo(1, 'Muy caro')
    fireEvent.click(guardar())
    expect((await screen.findByRole('alert')).textContent).toBe('Sin conexión: no se pudo guardar.')
    expect(onGuardado).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Producto 1') as HTMLInputElement).value).toBe('Tijeras')
  })

  it('se pueden quitar líneas pero siempre queda una', () => {
    abrir({ textoInicial: 'A' })
    expect(screen.queryByLabelText('Quitar producto 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Agregar otro producto/ }))
    fireEvent.click(screen.getByLabelText('Quitar producto 1'))
    expect(screen.queryByLabelText('Producto 2')).toBeNull()
    expect(screen.getByLabelText('Producto 1')).toBeTruthy()
  })
})
