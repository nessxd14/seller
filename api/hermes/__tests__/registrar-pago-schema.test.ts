import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../registrar-pago'

vi.mock('../_auth.js', () => ({
  verificarSesionPos: vi.fn().mockResolvedValue({ rol: 'admin', activo: true, email: 'test@example.invalid', userId: 'test-user' }),
  puedeMoverSaldo: vi.fn().mockReturnValue(true),
}))

function response() {
  const res = { status: vi.fn(), json: vi.fn() }
  res.status.mockReturnValue(res)
  return res as unknown as VercelResponse & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}
beforeEach(() => {
  vi.stubEnv('HERMES_URL', 'https://zxoxougwgstrarwymlvd.supabase.co')
  vi.stubEnv('HERMES_SERVICE_ROLE_KEY', 'test-only-server-key')
  vi.stubEnv('HERMES_SCHEMA', 'hermes')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('puente de pago hacia el esquema hermes', () => {
  it('envía propuesta y marca de anticipo a la misma cartera', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ pago_id: 42, saldo_provisional: '10.00' }] })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const req = { method: 'POST', headers: { authorization: 'Bearer test' }, body: { clienteId: 83, monto: 350, medio: 'EFECTIVO', movimientoCajaId: 55, pedidoId: 344, noImputar: true } } as VercelRequest
    const res = response()
    await handler(req, res)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers['Content-Profile']).toBe('hermes')
      expect(options.headers['Accept-Profile']).toBe('hermes')
    }
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_movimiento_caja_id).toBe('55')
    expect(res.status).toHaveBeenCalledWith(200)
  })
  it('falla antes de enviar un pago si Cation quedó configurado como public', async () => {
    vi.stubEnv('HERMES_SCHEMA', 'public')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = response()
    await handler({ method: 'POST', headers: {}, body: { clienteId: 83, monto: 350, medio: 'EFECTIVO', movimientoCajaId: 55 } } as VercelRequest, res)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(502)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cation requiere HERMES_SCHEMA=hermes' })
  })
})
