import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import registrarCargo from '../registrar-cargo'
import registrarPago from '../registrar-pago'
import imputarPago from '../imputar-pago'
import consultarSaldos from '../consultar-saldos'
import consultarSimilares from '../consultar-saldos-similares'

vi.mock('../_auth.js', () => ({
  verificarSesionPos: vi.fn().mockResolvedValue({ rol: 'admin', activo: true, email: 'caja@cation.test', userId: 'uid-1' }),
  puedeMoverSaldo: vi.fn().mockReturnValue(true),
}))

function makeRes() {
  const res = { _status: 0, _json: undefined as unknown, status(c: number) { this._status = c; return this }, json(p: unknown) { this._json = p; return this } }
  return res as unknown as VercelResponse & { _status: number; _json: unknown }
}
const post = (body: unknown) => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body }) as unknown as VercelRequest
const okFetch = (payload: unknown = [{}]) => vi.fn().mockResolvedValue({ ok: true, json: async () => payload })

beforeEach(() => {
  vi.stubEnv('HERMES_URL', 'https://hermes.example.invalid')
  vi.stubEnv('HERMES_SERVICE_ROLE_KEY', 'k')
  vi.stubEnv('HERMES_SCHEMA', 'hermes')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void
const call = async (h: Handler, body: unknown) => { const res = makeRes(); await h(post(body), res); return res }

describe('registrar-cargo', () => {
  const base = { clienteId: 1, monto: 10, ventaId: 7 }
  it.each([{ a: 1 }, [7], 0, -3, 1.5, 'abc', null, undefined, '7; drop'])('400 con ventaId %j', async (ventaId) => {
    const fetchMock = okFetch(); vi.stubGlobal('fetch', fetchMock)
    expect((await call(registrarCargo, { ...base, ventaId }))._status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('acepta ventaId entero o string de dígitos y manda identidad de sesión', async () => {
    const fetchMock = okFetch(); vi.stubGlobal('fetch', fetchMock)
    expect((await call(registrarCargo, { ...base, ventaId: '7', usuarioPos: 'ana' }))._status).toBe(200)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.p_venta_id).toBe('7')
    expect(body.p_usuario_pos).toBe('caja@cation.test (origen: ana)')
  })
})

describe('registrar-pago', () => {
  const base = { clienteId: 1, monto: 10, medio: 'EFECTIVO', movimientoCajaId: 55 }
  it.each([{ a: 1 }, [55], 0, -1, 'x', null, undefined])('400 con movimientoCajaId %j', async (movimientoCajaId) => {
    const fetchMock = okFetch(); vi.stubGlobal('fetch', fetchMock)
    expect((await call(registrarPago, { ...base, movimientoCajaId }))._status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['efectivo', 'BITCOIN', '', ['EFECTIVO'], { a: 1 }, 5])('400 con medio %j', async (medio) => {
    const fetchMock = okFetch(); vi.stubGlobal('fetch', fetchMock)
    expect((await call(registrarPago, { ...base, medio }))._status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['EFECTIVO', 'QR', 'DEPOSITO', 'TRANSFERENCIA', 'SIGEP', 'CHEQUE'])('acepta medio %s', async (medio) => {
    vi.stubGlobal('fetch', okFetch([{ pago_id: 1 }]))
    expect((await call(registrarPago, { ...base, medio, movimientoCajaId: '55' }))._status).toBe(200)
  })
  it('manda la identidad de sesión aunque usuarioPos intente suplantarla', async () => {
    const fetchMock = okFetch([{ pago_id: 1 }]); vi.stubGlobal('fetch', fetchMock)
    await call(registrarPago, { ...base, usuarioPos: 'admin@cation.test' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_usuario_pos).toBe('caja@cation.test (origen: admin@cation.test)')
  })
})

describe('imputar-pago', () => {
  const base = { pagoId: 3, aplicaciones: [{ partidaId: 9, monto: 5 }] }
  it.each([{ a: 1 }, [3], 0, -1, 1.5, 'x'])('400 con pagoId %j', async (pagoId) => {
    expect((await call(imputarPago, { ...base, pagoId }))._status).toBe(400)
  })
  it.each([{ a: 1 }, [9], 0, -2, 1.5, 'x', null])('400 con partidaId %j', async (partidaId) => {
    expect((await call(imputarPago, { ...base, aplicaciones: [{ partidaId, monto: 5 }] }))._status).toBe(400)
  })
  it('400 con más de 50 aplicaciones y acepta exactamente 50', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ partidaId: i + 1, monto: 1 }))
    expect((await call(imputarPago, { ...base, aplicaciones: mk(51) }))._status).toBe(400)
    const fetchMock = okFetch({}); vi.stubGlobal('fetch', fetchMock)
    expect((await call(imputarPago, { ...base, aplicaciones: mk(50), usuarioPos: 'ana' }))._status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_usuario).toBe('caja@cation.test (origen: ana)')
  })
})

describe.each([
  ['consultar-saldos', consultarSaldos, 'clienteIds'],
  ['consultar-saldos-similares', consultarSimilares, 'posIds'],
] as const)('%s', (_nombre, handler, campo) => {
  it.each([[[1, 'x']], [[0]], [[-1]], [[1.5]], [[[1]]], [[{ a: 1 }]], [['1']], ['1'], [{ a: 1 }]])('400 con %j', async (valor) => {
    const fetchMock = okFetch([]); vi.stubGlobal('fetch', fetchMock)
    expect((await call(handler, { [campo]: valor }))._status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('400 con más de 200 y acepta 200', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
    expect((await call(handler, { [campo]: mk(201) }))._status).toBe(400)
    vi.stubGlobal('fetch', okFetch([]))
    expect((await call(handler, { [campo]: mk(200) }))._status).toBe(200)
  })
  it('lista vacía sigue devolviendo 200 con saldos []', async () => {
    const res = await call(handler, { [campo]: [] })
    expect(res._status).toBe(200)
    expect(res._json).toEqual({ saldos: [] })
  })
})
