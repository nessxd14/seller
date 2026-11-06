// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONSULTA_CELULAR, useEsCelular } from '../useEsCelular'

const original = window.matchMedia

afterEach(() => { window.matchMedia = original })

describe('useEsCelular', () => {
  it('sin matchMedia (escritorio en pruebas) es false', () => {
    // @ts-expect-error simulamos un entorno sin matchMedia
    window.matchMedia = undefined
    expect(renderHook(() => useEsCelular()).result.current).toBe(false)
  })

  it('sigue el ancho de la pantalla', () => {
    let coincide = true
    const oyentes = new Set<() => void>()
    window.matchMedia = vi.fn((q: string) => ({ media: q, get matches() { return coincide }, addEventListener: (_: string, f: () => void) => oyentes.add(f), removeEventListener: (_: string, f: () => void) => oyentes.delete(f) })) as unknown as typeof window.matchMedia
    const { result } = renderHook(() => useEsCelular())
    expect(window.matchMedia).toHaveBeenCalledWith(CONSULTA_CELULAR)
    expect(result.current).toBe(true)
    act(() => { coincide = false; oyentes.forEach((f) => f()) })
    expect(result.current).toBe(false)
  })
})
