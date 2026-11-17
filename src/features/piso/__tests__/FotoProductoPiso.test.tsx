// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const catalogo = vi.hoisted(() => ({ productos: new Map<number, { imagenUrl?: string; imagenMiniaturaUrl?: string }>() }))
vi.mock('../../../infrastructure/supabase/CatalogoLocal.supabase', () => ({ catalogoLocal: { indice: () => ({ productos: catalogo.productos }) } }))
import { FotoProductoPiso, fotosDeProducto, urlCompleta, urlMiniatura } from '../FotoProductoPiso'
import { ProductVisual } from '../../../components/ProductVisual'

beforeEach(() => { catalogo.productos.clear() })
afterEach(cleanup)

describe('fotos de producto', () => {
  it('la miniatura cae a imagenUrl; la vista grande siempre usa la completa', () => {
    expect(urlMiniatura({ miniaturaUrl: 'm.jpg', imagenUrl: 'f.jpg' })).toBe('m.jpg')
    expect(urlMiniatura({ imagenUrl: 'f.jpg' })).toBe('f.jpg')
    expect(urlCompleta({ miniaturaUrl: 'm.jpg', imagenUrl: 'f.jpg' })).toBe('f.jpg')
  })

  it('busca la foto de una línea por producto_id en el catálogo en memoria', () => {
    catalogo.productos.set(7, { imagenUrl: 'f7.jpg', imagenMiniaturaUrl: 'm7.jpg' })
    expect(fotosDeProducto(7)).toEqual({ imagenUrl: 'f7.jpg', miniaturaUrl: 'm7.jpg' })
    expect(fotosDeProducto('7')).toEqual({ imagenUrl: 'f7.jpg', miniaturaUrl: 'm7.jpg' })
    expect(fotosDeProducto(99)).toEqual({})
    expect(fotosDeProducto(null)).toEqual({})
  })

  it('línea restaurada: miniatura por producto_id y foto completa al tocar', () => {
    catalogo.productos.set(7, { imagenUrl: 'f7.jpg', imagenMiniaturaUrl: 'm7.jpg' })
    render(<FotoProductoPiso nombre="Resma" sku="R-1" precio={25} productoId={7} />)
    const boton = screen.getByRole('button', { name: 'Ver foto de Resma' })
    expect(boton.querySelector('img')?.getAttribute('src')).toBe('m7.jpg')
    fireEvent.click(boton)
    expect(screen.getByRole('dialog', { name: 'Foto de Resma' })).toBeTruthy()
    expect(screen.getByAltText('Resma').getAttribute('src')).toBe('f7.jpg')
    expect(screen.getByText(/R-1 · Bs 25,00/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Listo, es este' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sin miniatura usa la foto completa en la lista', () => {
    render(<FotoProductoPiso nombre="Cinta" imagenUrl="f.jpg" />)
    expect(screen.getByRole('button', { name: 'Ver foto de Cinta' }).querySelector('img')?.getAttribute('src')).toBe('f.jpg')
  })

  it('sin foto: marcador neutro y sin botón', () => {
    render(<FotoProductoPiso nombre="Sin foto" productoId={5} />)
    expect(screen.queryByRole('button', { name: /Ver foto/ })).toBeNull()
  })

  it('desde un resultado de búsqueda, «Agregar a la venta» agrega y cierra', () => {
    const agregar = vi.fn()
    render(<FotoProductoPiso nombre="Resma" imagenUrl="f.jpg" miniaturaUrl="m.jpg" textoAccion="Agregar a la venta" onAccion={agregar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Resma' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar a la venta' }))
    expect(agregar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tocar fuera o la «×» cierra sin agregar', () => {
    const agregar = vi.fn()
    render(<FotoProductoPiso nombre="Resma" imagenUrl="f.jpg" textoAccion="Agregar a la venta" onAccion={agregar} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Resma' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver foto de Resma' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar foto' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(agregar).not.toHaveBeenCalled()
  })
})

describe('ProductVisual', () => {
  it('lista con miniatura (lazy, async); al agrandar abre la foto completa', () => {
    const { container } = render(<ProductVisual type="x" color="#000" imagenUrl="full.jpg" miniaturaUrl="mini.jpg" expandable name="Resma" />)
    const img = container.querySelector('img.product-visual-img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('mini.jpg')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    fireEvent.click(screen.getByRole('button', { name: 'Agrandar imagen de Resma' }))
    expect(screen.getByAltText('Resma').getAttribute('src')).toBe('full.jpg')
  })

  it('sin miniatura usa imagenUrl; sin ninguna, el marcador', () => {
    const a = render(<ProductVisual type="x" color="#000" imagenUrl="full.jpg" />)
    expect(a.container.querySelector('img')?.getAttribute('src')).toBe('full.jpg')
    a.unmount()
    const b = render(<ProductVisual type="x" color="#000" />)
    expect(b.container.querySelector('img')).toBeNull()
  })

  it('si la miniatura falla se cae a la foto completa', () => {
    const { container } = render(<ProductVisual type="x" color="#000" imagenUrl="full.jpg" miniaturaUrl="roto.jpg" />)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('full.jpg')
  })
})
