// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InfoHint } from '../InfoHint'

afterEach(cleanup)

const trigger = () => screen.getByRole('button', { name: 'Qué es Remesa' })
const renderHint = (onParentClick = vi.fn()) => render(
  <details onClick={onParentClick}><summary onClick={onParentClick}>Remesas <InfoHint title="Remesa" text="Efectivo que entregas al gerente." /></summary></details>,
)

describe('InfoHint', () => {
  it('abre con clic, expone aria-expanded y no dispara el padre', () => {
    const parent = vi.fn()
    renderHint(parent)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Remesa' }).textContent).toContain('Efectivo que entregas al gerente.')
    expect(parent).not.toHaveBeenCalled()
  })

  it('abre y cierra con Enter y con Espacio', () => {
    renderHint()
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(trigger(), { key: ' ' })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(trigger(), { key: ' ' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('se cierra con Escape y con clic fuera, pero no con clic dentro', () => {
    renderHint()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger())
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
