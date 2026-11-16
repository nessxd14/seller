// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRefreshGate } from './refreshGate'

const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
}

beforeEach(() => { vi.useFakeTimers(); setVisibility('visible') })
afterEach(() => { vi.useRealTimers(); setVisibility('visible') })

describe('createRefreshGate', () => {
  it('ejecuta la primera y salta las que llegan dentro de minGapMs', () => {
    const fn = vi.fn()
    const trigger = createRefreshGate(15_000)
    trigger(fn); trigger(fn)
    vi.advanceTimersByTime(14_999); trigger(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1); trigger(fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('no ejecuta con la pestaña oculta y no consume la ventana', () => {
    const fn = vi.fn()
    const trigger = createRefreshGate(15_000)
    setVisibility('hidden'); trigger(fn)
    expect(fn).not.toHaveBeenCalled()
    setVisibility('visible'); trigger(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
