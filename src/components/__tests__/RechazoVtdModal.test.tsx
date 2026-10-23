// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RechazoVtdModal } from '../RechazoVtdModal'

const confirmButton = () => screen.getByRole('button', { name: 'Confirmar rechazo' }) as HTMLButtonElement
const montar = (props: { paid: boolean; error?: string }) => {
  const onConfirm = vi.fn()
  render(<RechazoVtdModal ventaNumero="VTD-1" busy={false} onCancel={() => {}} onConfirm={onConfirm} {...props} />)
  fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Almacén sin stock' } })
  return onConfirm
}

describe('RechazoVtdModal', () => {
  afterEach(cleanup)

  it('sin cobro solo pide el motivo', () => {
    const onConfirm = montar({ paid: false })
    expect(screen.queryByLabelText(/rechazado por el banco/)).toBeNull()
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith({ motivo: 'Almacén sin stock', devolucion_realizada: false, referencia: '' })
  })

  it('pago rechazado por el banco: habilita confirmar sin referencia y envía devolucion_realizada false', () => {
    const onConfirm = montar({ paid: true })
    expect(confirmButton().disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/rechazado por el banco — no hay nada que devolver/))
    expect(screen.queryByLabelText('Referencia de devolución')).toBeNull()
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith({ motivo: 'Almacén sin stock', devolucion_realizada: false, referencia: '' })
  })

  it('las dos opciones son excluyentes: volver a "devolví" exige la referencia otra vez', () => {
    const onConfirm = montar({ paid: true })
    fireEvent.click(screen.getByLabelText(/rechazado por el banco/))
    fireEvent.click(screen.getByLabelText(/Confirmo que devolví/))
    expect((screen.getByLabelText(/rechazado por el banco/) as HTMLInputElement).checked).toBe(false)
    expect(confirmButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Referencia de devolución'), { target: { value: 'QR-77' } })
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith({ motivo: 'Almacén sin stock', devolucion_realizada: true, referencia: 'QR-77' })
  })

  it('muestra el error de la base cuando el pago no estaba rechazado', () => {
    montar({ paid: true, error: 'Confirma la devolución realizada antes de rechazar.' })
    expect(screen.getByRole('alert').textContent).toBe('Confirma la devolución realizada antes de rechazar.')
  })
})
