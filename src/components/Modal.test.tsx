// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Modal } from './Modal'

beforeEach(() => {
  // JSDOM no calcula geometría; estos controles representan elementos visibles.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 32)] as unknown as DOMRectList)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function Example() {
  const [open, setOpen] = useState(false)
  const [nested, setNested] = useState(false)
  return <>
    <button onClick={() => setOpen(true)}>Abrir prueba</button>
    <button>Acción de fondo</button>
    {open && <Modal title="Principal" onClose={() => setOpen(false)} escapeToClose={!nested}>
      <input aria-label="Importe" autoFocus />
      <button onClick={() => setNested(true)}>Abrir secundaria</button>
      {nested && <Modal title="Secundaria" onClose={() => setNested(false)}><input aria-label="Detalle" autoFocus /></Modal>}
    </Modal>}
  </>
}

describe('Modal: navegación con teclado', () => {
  it('contiene Tab en ambos sentidos y devuelve el foco al disparador aunque haya autoFocus', async () => {
    render(<StrictMode><Example /></StrictMode>)
    const trigger = screen.getByText('Abrir prueba')
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Principal' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: i % 2 === 0 })
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('cierra solo la ventana superior y recupera el foco de la ventana anterior', async () => {
    render(<Example />)
    screen.getByText('Abrir prueba').focus()
    fireEvent.click(screen.getByText('Abrir prueba'))
    const nestedTrigger = screen.getByText('Abrir secundaria')
    nestedTrigger.focus()
    fireEvent.click(nestedTrigger)
    const nestedDialog = screen.getByRole('dialog', { name: 'Secundaria' })
    await waitFor(() => expect(nestedDialog.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Secundaria' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Principal' })).toBeTruthy()
    expect(document.activeElement).toBe(nestedTrigger)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('respeta escapeToClose=false y permite actualizarlo sin reiniciar el foco', async () => {
    const close = vi.fn()
    const { rerender } = render(<Modal title="Protegida" onClose={close} escapeToClose={false}><input aria-label="Dato" /></Modal>)
    screen.getByLabelText('Dato').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    rerender(<Modal title="Protegida" onClose={close}><input aria-label="Dato" /></Modal>)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Dato')))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })
})
