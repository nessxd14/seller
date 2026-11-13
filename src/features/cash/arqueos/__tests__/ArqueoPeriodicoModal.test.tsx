// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ArqueoPeriodicoModal, type ArqueoPeriodicoModalProps } from '../ArqueoPeriodicoModal'

afterEach(cleanup)

const montar = (over: Partial<ArqueoPeriodicoModalProps> = {}) => {
  const props = {
    numero: 2,
    total: 3,
    fueraDeHora: false,
    // Respuesta falsa con dinero "filtrado": la UI jamás debe pintarlo.
    registrar: vi.fn().mockResolvedValue({ numero: 2, estado: 'CUMPLIDO', esperado: 1280.5, diferencia: -100 }),
    refrescar: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<ArqueoPeriodicoModal {...props} />)
  return props
}
const contar100 = () => {
  const input = screen.getByLabelText('Cantidad de billetes/monedas de 100')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: '3' } })
  fireEvent.blur(input)
}
const registrarClick = () => fireEvent.click(screen.getByRole('button', { name: 'Registrar arqueo' }))

describe('ArqueoPeriodicoModal', () => {
  it('muestra título, subtítulo y botones, y nunca esperado ni diferencia', async () => {
    const p = montar()
    expect(screen.getByRole('dialog', { name: /Arqueo 2 de 3/ })).toBeTruthy()
    expect(screen.getByText(/Cuenta todo el efectivo del cajón, billete por billete\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Más tarde' })).toBeTruthy()
    contar100()
    registrarClick()
    await waitFor(() => expect(p.notify).toHaveBeenCalled())
    expect(document.body.textContent ?? '').not.toMatch(/esperado|diferencia/i)
    expect(document.body.textContent ?? '').not.toContain('1280')
  })

  it('usa el mismo aspecto que el conteo del cierre y muestra el total contado', () => {
    montar()
    const dialogo = screen.getByRole('dialog', { name: /Arqueo 2 de 3/ })
    expect(dialogo.className).toContain('cash-dialog')
    expect(dialogo.className).toContain('cierre-dialog')
    expect(dialogo.querySelector('footer.modal-actions')).toBeTruthy()
    const pie = dialogo.querySelector('footer.modal-actions') as HTMLElement
    expect(pie.textContent).toContain('Total contado')
    expect(pie.textContent).toContain('Bs 0,00')
    contar100()
    expect(pie.textContent).toContain('Bs 300,00')
    expect(pie.querySelector('[aria-live="polite"]')).toBeTruthy()
  })

  it('la nota de fuera de hora es una insignia', () => {
    montar({ fueraDeHora: true })
    expect(screen.getByText('Fuera de hora — igual queda registrado.').className).toContain('arqueo-badge-tarde')
  })

  it('registra el conteo sin ceros, avisa y cierra', async () => {
    const p = montar()
    contar100()
    registrarClick()
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
    expect(p.registrar).toHaveBeenCalledWith({ '100': 3 })
    expect(p.notify).toHaveBeenCalledWith('Arqueo 2 registrado')
  })

  it('agrega "fuera de hora" cuando el servidor lo registra tarde', async () => {
    const p = montar({ fueraDeHora: true, registrar: vi.fn().mockResolvedValue({ numero: 2, estado: 'CUMPLIDO_TARDE' }) })
    expect(screen.getByText('Fuera de hora — igual queda registrado.')).toBeTruthy()
    contar100()
    registrarClick()
    await waitFor(() => expect(p.notify).toHaveBeenCalledWith('Arqueo 2 registrado · fuera de hora'))
  })

  it('un cajón vacío exige marcar "El cajón está en cero"', () => {
    montar()
    const boton = screen.getByRole('button', { name: 'Registrar arqueo' }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('El cajón está en cero'))
    expect(boton.disabled).toBe(false)
  })

  it('no envía dos veces mientras se registra', async () => {
    let resolver: (v: { numero: number; estado: 'CUMPLIDO' }) => void = () => {}
    const registrar = vi.fn().mockImplementation(() => new Promise((r) => { resolver = r }))
    const p = montar({ registrar })
    contar100()
    const boton = screen.getByRole('button', { name: 'Registrar arqueo' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(registrar).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Registrando…' }) as HTMLButtonElement).disabled).toBe(true)
    resolver({ numero: 2, estado: 'CUMPLIDO' })
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
  })

  it('si ya no hay arqueo pendiente, refresca en silencio y cierra', async () => {
    const p = montar({ registrar: vi.fn().mockRejectedValue(new Error('No tienes un arqueo pendiente en este momento')) })
    contar100()
    registrarClick()
    await waitFor(() => expect(p.onClose).toHaveBeenCalled())
    expect(p.refrescar).toHaveBeenCalled()
    expect(p.notify).not.toHaveBeenCalled()
  })

  it('"Más tarde" cierra sin registrar', () => {
    const p = montar()
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }))
    expect(p.onClose).toHaveBeenCalled()
    expect(p.registrar).not.toHaveBeenCalled()
  })
})
