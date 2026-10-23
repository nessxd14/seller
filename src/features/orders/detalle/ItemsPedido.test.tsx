// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PedidoItem } from '../../../domain/orders/pedidoEdicion.types'
import { ItemsPedido } from './ItemsPedido'

const item = (parcial: Partial<PedidoItem>): PedidoItem => ({
  id: 2879, producto_id: 10, presentacion_id: null, presentacion_nombre: 'Paquete (12)', sku: 'TRJ-07', descripcion: 'Trijet Digno 0.7 azul', es_personalizado: false, unidad_medida: null,
  cantidad_presentacion: 39, cantidad_despachada: 39, cantidad_sin_cubrir: 0, precio_unitario: 1, descuento_pct: 0, subtotal: 39, estado: 'VIGENTE', origen_item_id: null,
  precio_bloqueado: false, precio_bloqueado_motivo: null, lineas: [], ...parcial,
})

afterEach(cleanup)

describe('ItemsPedido', () => {
  it('oculta las líneas muertas, resume cuántas se reemplazaron y muestra el sustituto en su línea', () => {
    render(<ItemsPedido items={[item({
      lineas: [
        { id: 4803, producto_id: 10, descripcion: 'Trijet Digno 0.7 azul', cantidad_presentacion: 39, cubre: 39, estado: 'CAMBIADA', tipo_surtido: 'ORIGINAL', ubicacion: null, alistada: false, nota: null },
        { id: 4810, producto_id: 99, descripcion: 'Wenao Colle', cantidad_presentacion: 39, cubre: 39, despachado: 39, estado: 'DESPACHADA', tipo_surtido: 'SUSTITUTO', ubicacion: 'Almacén', alistada: true, nota: null },
      ],
    })]} />)
    expect(screen.queryByText('Cambiada')).toBeNull()
    expect(screen.getByText('Wenao Colle')).toBeTruthy()
    expect(screen.getByText('1 línea reemplazada por almacén')).toBeTruthy()
    expect(screen.getByText('TRJ-07 · Paquete (12)')).toBeTruthy()
  })

  it('no repite el nombre del ítem en líneas del mismo producto y muestra el estado COMPRADO_DIRECTO', () => {
    render(<ItemsPedido items={[item({
      descripcion: 'Fixocola', cantidad_sin_cubrir: 2, presentacion_nombre: null, unidad_medida: null,
      lineas: [{ id: 1, producto_id: 10, descripcion: 'Fixocola', cantidad_presentacion: 5, estado: 'COMPRADO_DIRECTO', tipo_surtido: 'COMPRA', ubicacion: null, alistada: false, nota: null }],
    })]} />)
    expect(screen.getAllByText('Fixocola')).toHaveLength(1)
    expect(screen.getByText('Comprado directo')).toBeTruthy()
    expect(screen.getByText('2 sin cubrir · se sigue cobrando')).toBeTruthy()
    expect(within(screen.getByRole('table')).queryByText(/^u$/)).toBeNull()
  })
})
