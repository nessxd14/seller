// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const turno = vi.hoisted(() => ({ estadoBancoQr: vi.fn(), estadoPagoQr: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({ turnoService: turno }))
import { useQrHold } from '../useQrHold'

const ms = (n: number) => act(async () => { await vi.advanceTimersByTimeAsync(n) })

beforeEach(() => { vi.useFakeTimers(); turno.estadoBancoQr.mockReset(); turno.estadoPagoQr.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useQrHold (retención de venta con QR)', () => {
  it('banco en línea: queda esperando, consulta cada 3 s y avisa al llegar VERIFICADO', async () => {
    turno.estadoBancoQr.mockResolvedValue({ enLinea: true })
    turno.estadoPagoQr.mockResolvedValueOnce('PENDIENTE').mockResolvedValue('VERIFICADO')
    const onVerified = vi.fn()
    const { result } = renderHook(() => useQrHold({ saleId: '77', onVerified }))
    let retenida = false
    await act(async () => { retenida = await result.current.iniciar(5000) })
    expect(retenida).toBe(true)
    expect(result.current).toMatchObject({ phase: 'esperando', qrAmountCents: 5000, bankOfflineNotice: false })
    await ms(2900)
    expect(turno.estadoPagoQr).not.toHaveBeenCalled()
    await ms(200)
    expect(turno.estadoPagoQr).toHaveBeenCalledWith('77')
    expect(onVerified).not.toHaveBeenCalled()
    await ms(3000)
    expect(onVerified).toHaveBeenCalledOnce()
    expect(result.current.phase).toBeNull()
  })

  it('a los 90 s sin confirmación pasa a "vencida" y "seguir esperando" reinicia la espera', async () => {
    turno.estadoBancoQr.mockResolvedValue({ enLinea: true })
    turno.estadoPagoQr.mockResolvedValue('PENDIENTE')
    const { result } = renderHook(() => useQrHold({ saleId: '77', onVerified: vi.fn() }))
    await act(async () => { await result.current.iniciar(100) })
    await ms(90_000)
    expect(result.current.phase).toBe('vencida')
    act(() => result.current.seguirEsperando())
    expect(result.current).toMatchObject({ phase: 'esperando', elapsedS: 0 })
  })

  it('banco fuera de línea (o sin estado): no retiene y deja el aviso', async () => {
    turno.estadoBancoQr.mockResolvedValueOnce({ enLinea: false })
    const { result } = renderHook(() => useQrHold({ saleId: '77', onVerified: vi.fn() }))
    let retenida = true
    await act(async () => { retenida = await result.current.iniciar(100) })
    expect(retenida).toBe(false)
    expect(result.current).toMatchObject({ phase: null, bankOfflineNotice: true })
    turno.estadoBancoQr.mockRejectedValueOnce(new Error('caído'))
    await act(async () => { retenida = await result.current.iniciar(100) })
    expect(retenida).toBe(false)
  })

  it('una red caída durante la espera no la corta', async () => {
    turno.estadoBancoQr.mockResolvedValue({ enLinea: true })
    turno.estadoPagoQr.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('VERIFICADO')
    const onVerified = vi.fn()
    const { result } = renderHook(() => useQrHold({ saleId: '77', onVerified }))
    await act(async () => { await result.current.iniciar(100) })
    await ms(3000)
    expect(onVerified).not.toHaveBeenCalled()
    await ms(3000)
    expect(onVerified).toHaveBeenCalledOnce()
  })
})
