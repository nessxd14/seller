// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnoMovimiento } from '../../../application/shared/models'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), cajaReclamos: vi.fn(), cajaVendedoresPiso: vi.fn(), cajaAsignarVendedor: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  authSessionProvider: { getSession: mocks.getSession },
  pisoRepository: { cajaReclamos: mocks.cajaReclamos, cajaVendedoresPiso: mocks.cajaVendedoresPiso, cajaAsignarVendedor: mocks.cajaAsignarVendedor },
}))
import { VendedorDeVenta } from '../VendedorDeVenta'
import { ActividadTurno } from '../ActividadTurno'

const sesion = (role: string) => ({ user: { id: 'u', name: 'x', role, active: true }, expiresAt: '2999-01-01' })
const ana = { ventaId: 5, perfilId: 'p-ana', nombre: 'Ana', origen: 'RECLAMO', reclamadoEn: '2026-11-12T15:00:00Z' }
const vendedores = [{ perfilId: 'p-ana', nombre: 'Ana', enTurno: true }, { perfilId: 'p-luis', nombre: 'Luis', enTurno: false }]

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.getSession.mockResolvedValue(sesion('cajero'))
  mocks.cajaReclamos.mockResolvedValue([])
  mocks.cajaVendedoresPiso.mockResolvedValue(vendedores)
  mocks.cajaAsignarVendedor.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('VendedorDeVenta (detalle de venta en caja)', () => {
  it('un rol sin acceso (reponedor, vendedor) no ve la fila ni consulta nada', async () => {
    mocks.getSession.mockResolvedValue(sesion('vendedor'))
    const { container } = render(<VendedorDeVenta ventaId="5" />)
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    expect(mocks.cajaReclamos).not.toHaveBeenCalled()
  })

  it('muestra "sin vendedor" y asignar a una venta sin dueño no pide motivo', async () => {
    const onChanged = vi.fn()
    render(<VendedorDeVenta ventaId="5" onChanged={onChanged} />)
    await screen.findByText('sin vendedor')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    const select = await screen.findByLabelText('Vendedor')
    await screen.findByRole('option', { name: 'Ana · en turno' })
    fireEvent.change(select, { target: { value: 'p-luis' } })
    expect(screen.queryByLabelText('Motivo')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.cajaAsignarVendedor).toHaveBeenCalledWith(5, 'p-luis', undefined))
    expect(onChanged).toHaveBeenCalled()
    expect(await screen.findByText('Luis')).toBeTruthy()
  })

  it('reemplazar un dueño sin motivo queda bloqueado; con motivo llama a la RPC', async () => {
    mocks.cajaReclamos.mockResolvedValue([ana])
    render(<VendedorDeVenta ventaId="5" />)
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    await screen.findByRole('option', { name: 'Luis' })
    const guardar = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Vendedor'), { target: { value: 'p-luis' } })
    expect(guardar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: '   ' } })
    expect(guardar.disabled).toBe(true)
    fireEvent.click(guardar)
    expect(mocks.cajaAsignarVendedor).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Lo atendió Luis' } })
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    await waitFor(() => expect(mocks.cajaAsignarVendedor).toHaveBeenCalledWith(5, 'p-luis', 'Lo atendió Luis'))
  })

  it('"Sin vendedor" sobre una venta con dueño también pide motivo; si la base rechaza, muestra su mensaje', async () => {
    mocks.cajaReclamos.mockResolvedValue([ana])
    mocks.cajaAsignarVendedor.mockRejectedValue(new Error('Esta venta vino de un pedido de vendedor: ya tiene dueño'))
    render(<VendedorDeVenta ventaId="5" />)
    await screen.findByText('Ana')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }))
    await screen.findByRole('option', { name: 'Luis' })
    fireEvent.change(screen.getByLabelText('Vendedor'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Error de caja' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/vino de un pedido de vendedor/)
  })
})

const venta = (id: string, ventaId?: string): TurnoMovimiento => ({ id, tipo: 'VENTA', metodo: 'EFECTIVO', montoBs: 10, detalle: '', documento: `VTA-${id}`, creadoEn: '2026-11-12T15:00:00Z', fueraDeArqueo: false, ventaId })

describe('ActividadTurno — chip "Es de …"', () => {
  const hints = { anulacion: { title: 'a', text: 'a' }, fueraArqueo: { title: 'f', text: 'f' } }
  const abrir = (movimientos: TurnoMovimiento[]) => render(<ActividadTurno movimientos={movimientos} tickets={[]} puedeMoverArqueo={false} hints={hints} onVerProductos={vi.fn()} onReimprimir={vi.fn()} onVerComprobante={vi.fn()} onAlternarArqueo={vi.fn()} />)

  it('pide los dueños de las ventas visibles en un solo lote y muestra el chip solo donde hay', async () => {
    mocks.cajaReclamos.mockResolvedValue([ana])
    abrir([venta('1', '5'), venta('2', '6'), { ...venta('3'), tipo: 'GASTO' }])
    expect(await screen.findByText('Es de Ana')).toBeTruthy()
    expect(mocks.cajaReclamos).toHaveBeenCalledTimes(1)
    expect(mocks.cajaReclamos).toHaveBeenCalledWith([5, 6])
    expect(screen.getAllByText(/^Es de /)).toHaveLength(1)
  })

  it('si la consulta falla, la actividad se muestra igual sin chips', async () => {
    mocks.cajaReclamos.mockRejectedValue(new Error('Solo caja y gerencia ven los reclamos'))
    abrir([venta('1', '5')])
    await waitFor(() => expect(mocks.cajaReclamos).toHaveBeenCalled())
    expect(screen.getByText('VTA-1')).toBeTruthy()
    expect(screen.queryByText(/^Es de /)).toBeNull()
  })
})
