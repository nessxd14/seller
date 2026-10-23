// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { PedidoDetalle } from '../../../domain/orders/pedidoEdicion.types'
import { crearDetalleEscenario } from '../../../infrastructure/mock/PedidoEdicion.escenario'

const detalle = vi.fn<() => Promise<PedidoDetalle>>()
vi.mock('../../../infrastructure/services', () => ({
  pedidoEdicionService: { detalle: () => detalle(), previsualizar: vi.fn(), editar: vi.fn() },
  sensitiveOperations: { ejecutarIdempotente: vi.fn() },
  simularCambioDeAlmacen: vi.fn(),
  getDisponibilidadPedido: async () => ({}),
  listPresentations: async () => [],
  productRepository: { search: async () => ({ items: [], total: 0 }) },
}))

import { EditarPedidoView } from './EditarPedidoView'

afterEach(() => { cleanup(); window.history.replaceState({}, '', '/') })

// Pedido 808, ítem 2879: la línea ORIGINAL quedó CAMBIADA (muerta, aún con cubre 39) y el sustituto despachado cubre todo.
const detalle808 = (): PedidoDetalle => {
  const base = crearDetalleEscenario()
  base.items = [{
    ...base.items[0], id: 2879, descripcion: 'Trijet Digno 0.7 azul', cantidad_presentacion: 39, cantidad_despachada: 39, cantidad_sin_cubrir: 0, precio_unitario: 1, subtotal: 39, precio_bloqueado: false, precio_bloqueado_motivo: null,
    lineas: [
      { id: 4803, producto_id: 4410, descripcion: 'Trijet Digno 0.7 azul', cantidad_presentacion: 39, cubre: 39, estado: 'CAMBIADA', tipo_surtido: 'ORIGINAL', ubicacion: null, alistada: false, nota: null },
      { id: 4810, producto_id: 850, descripcion: 'Wenao Colle', cantidad_presentacion: 39, cubre: 39, despachado: 39, estado: 'DESPACHADA', tipo_surtido: 'SUSTITUTO', ubicacion: 'Almacén', alistada: true, nota: null },
    ],
  }]
  base.avisos = []
  base.pedido.total = 39
  base.cuenta = { ...base.cuenta, partida_total: 39, pagado: 0, saldo: 39 }
  return base
}

describe('atajo "Ponerle precio propio"', () => {
  it('con el sustituto cubriendo todo (y la línea original muerta) enfoca el Precio y no abre Partir', async () => {
    detalle.mockResolvedValue(detalle808())
    window.history.replaceState({}, '', '/pedidos/1/editar?intento=precio_propio&item=2879&linea=4810')
    const notify = vi.fn()
    render(<EditarPedidoView pedidoId={1} notify={notify} onGuardado={() => {}} />)
    const campo = await screen.findByLabelText('Precio de Trijet Digno 0.7 azul')
    await waitFor(() => expect(document.activeElement).toBe(campo))
    expect(screen.queryByRole('dialog', { name: /Partir ítem/ })).toBeNull()
    expect(screen.queryByText('Partir ítem')).toBeNull()
    expect(notify).toHaveBeenCalledWith('El sustituto cubre todo el ítem: se cambia el precio del ítem.')
    expect(screen.getByRole('button', { name: /Revisar cambios \(0\)/ })).toBeTruthy()
  })
})
