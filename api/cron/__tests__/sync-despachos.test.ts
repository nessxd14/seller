import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../sync-despachos'

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

function makeRes() {
  const res = { _status: 0, _json: undefined as unknown, status(c: number) { this._status = c; return this }, json(p: unknown) { this._json = p; return this } }
  return res as unknown as VercelResponse & { _status: number; _json: unknown }
}
const req = (authorization?: string | string[]) => ({ method: 'GET', headers: { authorization } }) as unknown as VercelRequest

beforeEach(() => { createClientMock.mockReset() })
afterEach(() => { vi.unstubAllEnvs() })

describe('GET /api/cron/sync-despachos — autenticación', () => {
  it('503 si CRON_SECRET no está configurado', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = makeRes()
    await handler(req('Bearer x'), res)
    expect(res._status).toBe(503)
  })
  it('401 sin header, con secreto equivocado o de otro largo', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    for (const header of [undefined, 'Bearer otro', 'Bearer s3cre', 's3cret']) {
      const res = makeRes()
      await handler(req(header), res)
      expect(res._status).toBe(401)
    }
  })
  it('acepta el header correcto (también como array) y avanza a la config de Hermes', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('HERMES_URL', '')
    for (const header of ['Bearer s3cret', ['Bearer s3cret']]) {
      const res = makeRes()
      await handler(req(header), res)
      expect(res._status).toBe(500)
      expect(res._json).toEqual({ error: 'Hermes no está configurado en el servidor' })
    }
  })
})
