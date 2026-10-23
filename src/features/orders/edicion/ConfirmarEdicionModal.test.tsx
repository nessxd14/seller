// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crearDetalleEscenario } from '../../../infrastructure/mock/PedidoEdicion.escenario'

const previsualizar = vi.fn()
vi.mock('../../../infrastructure/services', () => ({
  pedidoEdicionService: { previsualizar: (...args: unknown[]) => previsualizar(...args), editar: vi.fn() },
  sensitiveOperations: { ejecutarIdempotente: vi.fn() },
  simularCambioDeAlmacen: vi.fn(),
}))

import { ConfirmarEdicionModal } from './ConfirmarEdicionModal'

afterEach(cleanup)

describe('ConfirmarEdicionModal', () => {
  it('con ok:false (cuenta y totales en null) muestra solo los errores y no confirma', async () => {
    previsualizar.mockResolvedValue({
      ok: false, version: 4, total_anterior: null, total_nuevo: null, delta: null, cuenta: null, cambios: [], almacen: [], advertencias: [],
      errores: [{ codigo: 'REDUCCION_BAJO_PAGADO', texto: 'La edición dejaría el pedido por debajo de lo pagado.' }],
    })
    render(<ConfirmarEdicionModal base={crearDetalleEscenario()} cambios={[{ op: 'cerrar_saldo', item_id: 904 }]} resumen={[]} onClose={() => {}} onRecargar={async () => []} onGuardado={() => {}} />)
    await waitFor(() => expect(screen.getByText(/por debajo de lo pagado/)).toBeTruthy())
    expect(screen.queryByText('Cuenta del cliente (Hermes)')).toBeNull()
    expect((screen.getByRole('button', { name: 'Confirmar cambios' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
