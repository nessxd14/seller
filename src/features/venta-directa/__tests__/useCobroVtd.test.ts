// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useCobroVtd } from '../useCobroVtd'

const mocks = vi.hoisted(() => ({ cobrarVtd: vi.fn(), getById: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ ventaDirectaService: mocks }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('dos confirmaciones en el mismo instante envían un solo cobro', async () => {
  let resolver!: (value: { totalBs: number; cambioBs: number }) => void
  mocks.cobrarVtd.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
  mocks.getById.mockResolvedValue(null)
  const { result } = renderHook(() => useCobroVtd({ sessionId: '1', notify: vi.fn() }))
  let primera!: Promise<boolean>
  let segunda!: Promise<boolean>
  act(() => {
    primera = result.current.cobrar(['1'], [{ method: 'cash', amountCents: 3000 }])
    segunda = result.current.cobrar(['1'], [{ method: 'cash', amountCents: 3000 }])
  })
  expect(await segunda).toBe(false)
  expect(mocks.cobrarVtd).toHaveBeenCalledOnce()
  await act(async () => { resolver({ totalBs: 30, cambioBs: 0 }); expect(await primera).toBe(true) })
  expect(result.current.submitting).toBe(false)
})
