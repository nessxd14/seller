// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CajaAlmacenEnEsperaOperacion, CajaAlmacenVtd } from '../../application/shared/cajaAlmacen'

const mocks = vi.hoisted(() => ({ listar: vi.fn(), operar: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({ ventaDirectaService: { getById: vi.fn().mockResolvedValue({ id: '2861', lines: [{ id: '11', precioUnitarioCents: 4000 }], discountCents: 0 }) } }))
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

  it('rechazar no llama a completar: la base cierra la operación y desaparece al releer', async () => {
    mocks.listar.mockResolvedValueOnce({ operaciones: [op([vtd('SOLICITADO')])] }).mockResolvedValue({ operaciones: [] })
    mocks.operar.mockResolvedValue({})
    const { container } = render(<CajaAlmacenEnEspera />)
    await rechazar()
    click(screen.getByLabelText(/Confirmo que devolví/))
    type(screen.getByLabelText('Referencia de devolución'), 'QR-123')
    click(screen.getByRole('button', { name: 'Confirmar rechazo' }))
    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(mocks.operar).toHaveBeenCalledTimes(1)
    expect(mocks.operar).not.toHaveBeenCalledWith('completar', expect.anything(), expect.anything(), expect.anything())
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

  it('muestra el faltante reportado y ajusta con el payload exacto', async () => {
    const conFaltante = op([{ ...vtd('SOLICITADO'), lineas: [{ linea_id: 11, nombre: 'Cemento', presentacion: 'Bolsa', cantidad_presentacion: 6 }], faltante: [{ linea_id: 11, cantidad_presentacion_disponible: 5 }] }])
    mocks.listar.mockResolvedValue({ operaciones: [conFaltante] })
    mocks.operar.mockResolvedValue({})
    render(<CajaAlmacenEnEspera />)
    expect((await screen.findByRole('status')).textContent).toContain('Almacén tiene 5 de 6')
    click(screen.getByRole('button', { name: 'Ajustar' }))
    await waitFor(() => expect(screen.queryByText(/Calculando/)).toBeNull())
    type(screen.getByLabelText('Motivo'), 'Faltan bolsas')
    click(screen.getByLabelText(/Confirmo que devolví/))
    click(screen.getByRole('button', { name: 'Confirmar ajuste' }))
    await waitFor(() => expect(mocks.operar).toHaveBeenCalledWith('ajustar', 'op-1', '57', {
      venta_id: 2861, version: 1, motivo: 'Faltan bolsas', lineas: [{ linea_id: 11, cantidad_presentacion: 5 }], devolucion: { destino: 'EFECTIVO', realizada: true },
    }))
  })

  it('no ofrece ajustar una VTD que ya salió de Almacén', async () => {
    mocks.listar.mockResolvedValue({ operaciones: [op([vtd('EN_CAJA')])] })
    render(<CajaAlmacenEnEspera />)
    await screen.findByRole('button', { name: 'Rechazar' })
    expect(screen.queryByRole('button', { name: 'Ajustar' })).toBeNull()
  })
})
