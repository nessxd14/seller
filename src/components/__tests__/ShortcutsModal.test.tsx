// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ShortcutsModal } from '../ShortcutsModal'
import { shortcuts } from '../../config/shortcuts'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 32)] as unknown as DOMRectList)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ShortcutsModal — panel de atajos (F1)', () => {
  it('renderiza cada entrada de src/config/shortcuts.ts, agrupada, con sus teclas y su etiqueta', () => {
    render(<ShortcutsModal onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Atajos de teclado' })).toBeTruthy()
    for (const shortcut of shortcuts) {
      expect(screen.getByText(shortcut.label)).toBeTruthy()
      for (const key of shortcut.keys) {
        expect(screen.getAllByText(key).length).toBeGreaterThan(0)
      }
    }
  })

  it('muestra la nota de que los atajos no saltan validaciones', () => {
    render(<ShortcutsModal onClose={() => {}} />)
    expect(screen.getByText(/no saltan validaciones/)).toBeTruthy()
  })
})
