import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

const SECRET = 'test-secret-value'

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return { method: 'POST', headers: { 'x-ingest-secret': SECRET }, body: { fuente: 'bnb-qr', movimientos: [] }, ...overrides } as VercelRequest
}

function makeRes(): VercelResponse & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { this._status = code; return this },
    json(payload: unknown) { this._json = payload; return this },
  }
  return res as unknown as VercelResponse & { _status: number; _json: unknown }
}

describe('POST /api/caja/ingestar-pagos-qr', () => {
  beforeEach(() => {
    process.env.QR_INGEST_SECRET = SECRET
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.CATION_SERVICE_ROLE_KEY = 'service-role-key'
    rpcMock.mockReset().mockResolvedValue({ data: { recibidos: 0, nuevos: 0, verificados: 0 }, error: null })
    createClientMock.mockReset().mockReturnValue({ rpc: rpcMock })
  })

  afterEach(() => {
    vi.resetModules()
    delete process.env.QR_INGEST_SECRET
    delete process.env.CATION_SERVICE_ROLE_KEY
  })

  const importHandler = async () => (await import('../ingestar-pagos-qr')).default

  it('rechaza con 405 un método distinto de POST', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(res._status).toBe(405)
  })

  it('rechaza con 401 sin header x-ingest-secret', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ headers: {} }), res)
    expect(res._status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rechaza con 401 con un secreto incorrecto', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ headers: { 'x-ingest-secret': 'wrong' } }), res)
    expect(res._status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rechaza con 401 un secreto del mismo largo pero distinto contenido', async () => {
    const handler = await importHandler()
    const res = makeRes()
    const mismoLargo = SECRET.slice(0, -1) + (SECRET.at(-1) === 'x' ? 'y' : 'x')
    await handler(makeReq({ headers: { 'x-ingest-secret': mismoLargo } }), res)
    expect(res._status).toBe(401)
  })

  it('rechaza con 400 cuando fuente no es bnb-qr', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ body: { fuente: 'otra-cosa', movimientos: [] } }), res)
    expect(res._status).toBe(400)
  })

  it('rechaza con 400 cuando movimientos no es un array', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ body: { fuente: 'bnb-qr', movimientos: 'no-array' } }), res)
    expect(res._status).toBe(400)
  })

  it('rechaza con 400 una fila con shape inválido (falta banco_id)', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ body: { fuente: 'bnb-qr', movimientos: [{ importe: 100, fecha_transaccion: '2026-09-28T10:00:00-04:00', estado: 'Pagado' }] } }), res)
    expect(res._status).toBe(400)
  })

  it('rechaza con 400 una fecha_transaccion sin offset', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ body: { fuente: 'bnb-qr', movimientos: [{ banco_id: 'X1', importe: 100, fecha_transaccion: '2026-09-28 10:00:00', estado: 'Pagado' }] } }), res)
    expect(res._status).toBe(400)
  })

  it('rechaza con 400 más de 500 filas', async () => {
    const handler = await importHandler()
    const res = makeRes()
    const movimientos = Array.from({ length: 501 }, (_, i) => ({ banco_id: `X${i}`, importe: 10, fecha_transaccion: '2026-09-28T10:00:00-04:00', estado: 'Pagado' }))
    await handler(makeReq({ body: { fuente: 'bnb-qr', movimientos } }), res)
    expect(res._status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('acepta un batch vacío (latido) y llama a la RPC', async () => {
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq({ body: { fuente: 'bnb-qr', movimientos: [] } }), res)
    expect(res._status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('ingestar_pagos_qr', { p_movimientos: [], p_version: null })
  })

  it('pasa movimientos válidos a la RPC y devuelve su resultado', async () => {
    rpcMock.mockResolvedValue({ data: { recibidos: 1, nuevos: 1, verificados: 1 }, error: null })
    const handler = await importHandler()
    const res = makeRes()
    const movimientos = [{ banco_id: 'X1', importe: 150.5, fecha_transaccion: '2026-09-28T10:00:00-04:00', estado: 'Pagado' }]
    await handler(makeReq({ body: { fuente: 'bnb-qr', version: 'v1', movimientos } }), res)
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ recibidos: 1, nuevos: 1, verificados: 1 })
    expect(rpcMock).toHaveBeenCalledWith('ingestar_pagos_qr', { p_movimientos: movimientos, p_version: 'v1' })
  })

  it('devuelve 500 cuando la RPC falla', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(500)
  })

  it('devuelve 500 sin QR_INGEST_SECRET configurado', async () => {
    delete process.env.QR_INGEST_SECRET
    const handler = await importHandler()
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res._status).toBe(500)
  })
})
