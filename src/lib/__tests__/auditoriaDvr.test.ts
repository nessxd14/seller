import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditEnd, auditStart } from '../auditoriaDvr'

describe('auditoriaDvr', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('es un no-op sin VITE_AUDIT_API_URL: nunca llama a fetch', () => {
    vi.stubEnv('VITE_AUDIT_API_URL', '')
    auditStart({ transactionId: 't1' })
    auditEnd({ transactionId: 't1', reason: 'completada' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con VITE_AUDIT_API_URL configurada, hace POST a /start con keepalive y AbortController', () => {
    vi.stubEnv('VITE_AUDIT_API_URL', 'http://localhost:8787')
    fetchMock.mockResolvedValueOnce({ ok: true })
    auditStart({ transactionId: 't1', cajeroId: 'cajero@example.com' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8787/start')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body)).toMatchObject({ transactionId: 't1', cajeroId: 'cajero@example.com' })
  })

  it('nunca lanza cuando fetch rechaza — el error va a console.debug', async () => {
    vi.stubEnv('VITE_AUDIT_API_URL', 'http://localhost:8787')
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(() => auditEnd({ transactionId: 't1', reason: 'cancelada' })).not.toThrow()
    await vi.waitFor(() => expect(debugSpy).toHaveBeenCalled())
    debugSpy.mockRestore()
  })

  it('nunca lanza cuando fetch cuelga (nunca resuelve) — no espera la respuesta', () => {
    vi.stubEnv('VITE_AUDIT_API_URL', 'http://localhost:8787')
    fetchMock.mockReturnValueOnce(new Promise(() => {}))
    expect(() => auditStart({ transactionId: 't1' })).not.toThrow()
  })

  it('manda reason/totalBs/numero en /end solo cuando vienen presentes', () => {
    vi.stubEnv('VITE_AUDIT_API_URL', 'http://localhost:8787')
    fetchMock.mockResolvedValueOnce({ ok: true })
    auditEnd({ transactionId: 't2', reason: 'completada', totalBs: 150.5, numero: 'VTA-2026-00001' })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ transactionId: 't2', reason: 'completada', totalBs: 150.5, numero: 'VTA-2026-00001' })
  })

  it('manda los Bs por método de pago en /end (contexto para CATION VLM)', () => {
    vi.stubEnv('VITE_AUDIT_API_URL', 'http://localhost:8787')
    fetchMock.mockResolvedValueOnce({ ok: true })
    auditEnd({ transactionId: 't3', reason: 'completada', totalBs: 80, numero: 'VTA-2026-00002', metodos: { cash: 30, qr: 50 } })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ transactionId: 't3', totalBs: 80, metodos: { cash: 30, qr: 50 } })
  })
})
