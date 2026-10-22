// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CajaAlmacenVtd } from '../../application/shared/cajaAlmacen'

const mocks = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({ ventaDirectaService: { getById: mocks.getById } }))
import { AjusteVtdModal } from '../AjusteVtdModal'

// 6 × Bs 40 con descuento de Bs 10 → total Bs 230.
const venta = { id: '2861', lines: [{ id: '11', precioUnitarioCents: 4000 }], discountCents: 1000 }
const vtd = (extra: Partial<CajaAlmacenVtd> = {}): CajaAlmacenVtd => ({
  venta_id: 2861, numero: 'VTD-2026-00784', total: 230, cliente_id: null, cliente: null, estado: 'SOLICITADO', version: 3,
  lineas: [{ linea_id: 11, nombre: 'Cemento', presentacion: 'Bolsa', cantidad_presentacion: 6 }], faltante: null, ...extra,
})
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const cantidad = () => screen.getByLabelText('Cantidad de Cemento') as HTMLInputElement
const confirmar = () => screen.getByRole('button', { name: 'Confirmar ajuste' }) as HTMLButtonElement

async function abrir(props: { vtd?: CajaAlmacenVtd; paid?: boolean; onConfirm?: (p: unknown) => void } = {}) {
  const onConfirm = props.onConfirm ?? vi.fn()
  render(<AjusteVtdModal vtd={props.vtd ?? vtd()} paid={props.paid ?? true} busy={false} onCancel={() => {}} onConfirm={onConfirm} />)
  await waitFor(() => expect(screen.queryByText(/Calculando/)).toBeNull())
  return onConfirm
}

describe('AjusteVtdModal', () => {
  beforeEach(() => { mocks.getById.mockReset(); mocks.getById.mockResolvedValue(venta) })
  afterEach(cleanup)

  it('no permite subir la cantidad ni dejar la VTD en cero', async () => {
    await abrir()
    type(cantidad(), '7'); expect(confirmar().disabled).toBe(true)
    type(cantidad(), '0'); expect(confirmar().disabled).toBe(true)
    type(cantidad(), '5'); type(screen.getByLabelText('Motivo'), 'Faltan bolsas')
    fireEvent.click(screen.getByLabelText(/Confirmo que devolví/)); expect(confirmar().disabled).toBe(false)
  })

  it('calcula el nuevo total con el descuento de la venta', async () => {
    await abrir()
    type(cantidad(), '5')
    // 5 × 40 − 10 = Bs 190; se devuelve 230 − 190 = Bs 40.
    expect(screen.getByText(/Bs 190,00/)).toBeTruthy()
    expect(screen.getByText(/Bs 40,00/)).toBeTruthy()
  })

  it('exige confirmación y referencia según el destino de la devolución', async () => {
    await abrir()
    type(cantidad(), '5'); type(screen.getByLabelText('Motivo'), 'Faltan bolsas')
    expect(confirmar().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/Confirmo que devolví/)); expect(confirmar().disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Devolver por'), { target: { value: 'QR' } })
    expect(confirmar().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/Confirmo que devolví/)); expect(confirmar().disabled).toBe(true)
    type(screen.getByLabelText('Referencia de devolución'), 'QR-778'); expect(confirmar().disabled).toBe(false)
  })

  it('envía el payload exacto', async () => {
    const onConfirm = await abrir()
    type(cantidad(), '5'); type(screen.getByLabelText('Motivo'), ' Faltan bolsas ')
    fireEvent.change(screen.getByLabelText('Devolver por'), { target: { value: 'QR' } })
    fireEvent.click(screen.getByLabelText(/Confirmo que devolví/)); type(screen.getByLabelText('Referencia de devolución'), 'QR-778')
    fireEvent.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith({
      venta_id: 2861, version: 3, motivo: 'Faltan bolsas', lineas: [{ linea_id: 11, cantidad_presentacion: 5 }],
      devolucion: { destino: 'QR', referencia: 'QR-778', realizada: true },
    })
  })

  it('saldo a favor sólo aparece si la VTD tiene cliente y no pide checkbox', async () => {
    await abrir()
    expect(screen.queryByRole('option', { name: 'Saldo a favor' })).toBeNull()
    cleanup()
    const onConfirm = await abrir({ vtd: vtd({ cliente_id: 7, cliente: 'Cliente' }) })
    type(cantidad(), '5'); type(screen.getByLabelText('Motivo'), 'Faltan bolsas')
    fireEvent.change(screen.getByLabelText('Devolver por'), { target: { value: 'SALDO_FAVOR' } })
    expect(screen.queryByLabelText(/Confirmo que devolví/)).toBeNull()
    fireEvent.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ devolucion: { destino: 'SALDO_FAVOR', realizada: true } }))
  })

  it('precarga la cantidad disponible reportada por Almacén', async () => {
    await abrir({ vtd: vtd({ faltante: [{ linea_id: 11, cantidad_presentacion_disponible: 5 }] }) })
    expect(cantidad().value).toBe('5')
    expect((screen.getByLabelText('Motivo') as HTMLTextAreaElement).value).not.toBe('')
  })

  it('sin cobro no pide devolución', async () => {
    const onConfirm = await abrir({ paid: false })
    type(cantidad(), '5'); type(screen.getByLabelText('Motivo'), 'Faltan bolsas')
    expect(screen.queryByLabelText('Devolver por')).toBeNull()
    fireEvent.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith({ venta_id: 2861, version: 3, motivo: 'Faltan bolsas', lineas: [{ linea_id: 11, cantidad_presentacion: 5 }] })
  })
})
