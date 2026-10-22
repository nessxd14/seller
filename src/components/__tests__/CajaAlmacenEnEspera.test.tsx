// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CajaAlmacenEnEsperaOperacion, CajaAlmacenVtd } from '../../application/shared/cajaAlmacen'

const mocks = vi.hoisted(() => ({ listar: vi.fn(), operar: vi.fn() }))
vi.mock('../../infrastructure/supabase/CajaAlmacen.supabase', () => ({ listarCajaAlmacenEnEspera: mocks.listar, operarCajaAlmacen: mocks.operar }))
import { CajaAlmacenEnEspera } from '../CajaAlmacenEnEspera'

const click = (el: HTMLElement) => fireEvent.click(el)
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const vtd = (estado: CajaAlmacenVtd['estado'], id = 2861): CajaAlmacenVtd => ({ venta_id: id, numero: `VTD-${id}`, total: 240, cliente_id: null, cliente: null, estado, version: 1 })
const op = (vtds: CajaAlmacenVtd[], paid = true): CajaAlmacenEnEsperaOperacion => ({
  turno_cerrado: false, vtds,
  operacion: { id: 'op-1', sesion_id: 57, cajero_id: 'c1', estado: 'COBRADA', revision: 1, borrador: {}, comprobante: paid ? { id: 9, numero: 'VTA-9', total: 240 } : null, cerrado_en: null },
})

async function rechazar() {
  click(await screen.findByRole('button', { name: 'Rechazar' }))
  type(screen.getByLabelText('Motivo'), 'Cliente desistió')
}

describe('CajaAlmacenEnEspera', () => {
  afterEach(cleanup)
  beforeEach(() => { mocks.listar.mockReset(); mocks.operar.mockReset() })

  it('no renderiza nada cuando no hay operaciones', async () => {
    mocks.listar.mockResolvedValue({ operaciones: [] })
    const { container } = render(<CajaAlmacenEnEspera />)
    await waitFor(() => expect(mocks.listar).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('exige devolución y referencia en operaciones cobradas y envía el payload exacto', async () => {
    mocks.listar.mockResolvedValueOnce({ operaciones: [op([vtd('SOLICITADO')])] }).mockResolvedValue({ operaciones: [op([vtd('SOLICITADO')])] })
    mocks.operar.mockResolvedValue({})
    render(<CajaAlmacenEnEspera />)
    await rechazar()
    const confirm = screen.getByRole('button', { name: 'Confirmar rechazo' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    click(screen.getByLabelText(/Confirmo que devolví/))
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    type(screen.getByLabelText('Referencia de devolución'), 'QR-123')
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    click(confirm)
    await waitFor(() => expect(mocks.operar).toHaveBeenCalledWith('rechazar', 'op-1', '57', { venta_id: 2861, motivo: 'Cliente desistió', devolucion_realizada: true, referencia: 'QR-123' }))
    expect(mocks.operar).toHaveBeenCalledTimes(1)
  })

  it('completa automáticamente cuando todas las VTD quedan resueltas', async () => {
    mocks.listar.mockResolvedValueOnce({ operaciones: [op([vtd('SOLICITADO')])] }).mockResolvedValue({ operaciones: [op([vtd('CANCELADO')])] })
    mocks.operar.mockResolvedValue({})
    render(<CajaAlmacenEnEspera />)
    await rechazar()
    click(screen.getByLabelText(/Confirmo que devolví/))
    type(screen.getByLabelText('Referencia de devolución'), 'QR-123')
    click(screen.getByRole('button', { name: 'Confirmar rechazo' }))
    await waitFor(() => expect(mocks.operar).toHaveBeenCalledWith('completar', 'op-1', '57', {}))
  })

  it('no completa si queda una VTD EN_CAJA y ofrece completar manualmente', async () => {
    const pendiente = op([vtd('SOLICITADO'), vtd('EN_CAJA', 2862)])
    mocks.listar.mockResolvedValueOnce({ operaciones: [pendiente] }).mockResolvedValue({ operaciones: [op([vtd('CANCELADO'), vtd('EN_CAJA', 2862)])] })
    mocks.operar.mockResolvedValue({})
    render(<CajaAlmacenEnEspera />)
    click((await screen.findAllByRole('button', { name: 'Rechazar' }))[0])
    type(screen.getByLabelText('Motivo'), 'Cliente desistió')
    click(screen.getByLabelText(/Confirmo que devolví/))
    type(screen.getByLabelText('Referencia de devolución'), 'QR-123')
    click(screen.getByRole('button', { name: 'Confirmar rechazo' }))
    await screen.findByRole('button', { name: 'Completar entrega y operación' })
    expect(mocks.operar).toHaveBeenCalledTimes(1)
    expect(mocks.operar).not.toHaveBeenCalledWith('completar', expect.anything(), expect.anything(), expect.anything())
  })
})
