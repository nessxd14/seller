// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosProvider, usePos } from '../PosContext'
import { CajaAlmacenProvider, useCajaAlmacen } from '../CajaAlmacenContext'
import type { CajaAlmacenRecord } from '../../application/shared/cajaAlmacen'

const qa = vi.hoisted(() => ({ state: { operacion: null, vtds: [] } as CajaAlmacenRecord, fail: false, parked: null as CajaAlmacenRecord | null }))
vi.mock('../CashSessionContext', () => ({ useCashSession: () => ({ sessionId: '1' }) }))
vi.mock('../../infrastructure/services', () => ({ authSessionProvider: { getSession: async () => ({ user: { id: 'cajero', active: true, role: 'cajero' } }), subscribe: () => () => {} } }))
vi.mock('../../infrastructure/supabase/CajaAlmacen.supabase', () => ({ listarCajaAlmacenEnEspera: async () => ({ operaciones: qa.parked ? [qa.parked] : [] }), operarCajaAlmacen: async (action: string, id: string | null, _session: string, data: Record<string, unknown>) => {
  if (qa.fail) throw new Error('Sin conexión')
  if (action === 'vincular') qa.state = { operacion: { id: id!, cajero_id: 'cajero', sesion_id: 1, revision: 1, estado: 'ACTIVA', comprobante: null, cerrado_en: null, borrador: data.borrador as never }, vtds: [{ venta_id: 12, numero: 'VTD-QA', total: 120, estado: 'SOLICITADO', version: 0, cliente: null, cliente_id: null }] }
  if (action === 'guardar' && qa.state.operacion) { qa.state.operacion.borrador = data.borrador as never; qa.state.operacion.revision++ }
  if (action === 'aparcar') { qa.parked = structuredClone({ ...qa.state, operacion: { ...qa.state.operacion!, borrador: data.borrador as never } }); qa.state = { operacion: null, vtds: [] }; return structuredClone(qa.parked) }
  if (action === 'retomar') { qa.state = structuredClone(qa.parked!); qa.parked = null }
  if (action === 'completar' && qa.state.operacion) qa.state.operacion = { ...qa.state.operacion, estado: 'COMPLETADA', cerrado_en: '2026-10-17' }
  return structuredClone(qa.state)
} }))

function Probe() {
  const p = usePos(), w = useCajaAlmacen()
  return <><output data-testid="total">{p.total + p.vtdsEnCarrito.reduce((n,v) => n + v.totalBs, 0)}</output><output data-testid="id">{p.operationId}</output><output data-testid="locked">{String(p.warehouseLocked)}</output>
    <button onClick={() => p.addCustomItem({ descripcion: 'VTA', cantidad: 1, precio: 80 })}>Agregar VTA</button>
    <button onClick={() => p.addCustomItem({ descripcion: 'Otra VTA', cantidad: 1, precio: 20 })}>Agregar 20</button>
    <button onClick={() => void w.link([{ ventaId: '12', numero: 'VTD-QA', totalBs: 120, estado: 'ABIERTA', pagoPosterior: false, creadoEn: '' }])}>Agregar VTD</button>
    <button onClick={p.newOperation}>Nueva operación</button><button onClick={p.clearOperation}>Limpiar</button>
    <button onClick={() => void w.refresh().catch(() => {})}>Actualizar</button><button onClick={() => void w.resolve('completar')}>Completar</button>
    <button onClick={() => void w.park()}>Dejar en espera</button><button onClick={() => void w.resume(qa.parked!.operacion!.id)}>Retomar</button>
    <output data-testid="espera">{w.enEspera}</output><output data-testid="vtds">{p.vtdsEnCarrito.length}</output>
    <span>{w.error}</span>
  </>
}
const mount = () => render(<PosProvider><CajaAlmacenProvider><Probe /></CajaAlmacenProvider></PosProvider>)
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); qa.state = { operacion: null, vtds: [] }; qa.fail = false; qa.parked = null })
afterEach(cleanup)

describe('operación Caja–Almacén', () => {
  it('permite agregar y cobrar la VTA vinculada y bloquea pasar a otra operación', async () => {
    mount();fireEvent.click(screen.getByText('Agregar VTA'))
    const id=screen.getByTestId('id').textContent
    fireEvent.click(screen.getByText('Agregar VTD'))
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('200'))
    fireEvent.click(screen.getByText('Agregar 20'))
    expect(screen.getByTestId('total').textContent).toBe('220')
    fireEvent.click(screen.getByText('Nueva operación'));fireEvent.click(screen.getByText('Limpiar'))
    expect(screen.getByTestId('id').textContent).toBe(id)
    expect(screen.getByTestId('total').textContent).toBe('220')
  })
  it('recupera la operación del cajero al abrir otra pestaña y conserva el cobro', async () => {
    qa.state={ operacion:{id:'10000000-0000-0000-0000-000000000001',sesion_id:1,cajero_id:'cajero',revision:4,estado:'COBRADA',comprobante:{id:1,numero:'CJA-1',total:120},cerrado_en:null,borrador:{cart:[]}},vtds:[{venta_id:12,numero:'VTD-QA',total:120,estado:'EN_CAJA',version:2,cliente:null,cliente_id:null}] }
    mount();await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('true'))
    expect(screen.getByTestId('id').textContent).toBe(qa.state.operacion!.id)
    fireEvent.click(screen.getByText('Agregar VTA'));expect(screen.getByTestId('total').textContent).toBe('120')
    fireEvent.click(screen.getByText('Nueva operación'));expect(screen.getByTestId('locked').textContent).toBe('true')
    await act(async () => { fireEvent.click(screen.getByText('Completar')) })
    await waitFor(() => expect(screen.getByTestId('locked').textContent).toBe('false'))
    expect(screen.getByTestId('total').textContent).toBe('0')
  })
  it('un error de red conserva la VTA y exige comprobar el resultado antes de liberar', async () => {
    mount();fireEvent.click(screen.getByText('Agregar VTA'));qa.fail=true
    await act(async () => { fireEvent.click(screen.getByText('Agregar VTD')) })
    expect(screen.getByTestId('total').textContent).toBe('80')
    expect(screen.getByTestId('locked').textContent).toBe('true')
    expect(screen.getByText('Sin conexión')).toBeTruthy()
    qa.fail=false
    await act(async () => { fireEvent.click(screen.getByText('Actualizar')) })
    expect(screen.getByTestId('locked').textContent).toBe('false')
    expect(screen.getByTestId('total').textContent).toBe('80')
  })
})

describe('dejar en espera y retomar', () => {
  const conVtd = async () => {
    mount()
    fireEvent.click(screen.getByText('Agregar VTA'))
    fireEvent.click(screen.getByText('Agregar VTD'))
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('200'))
  }
  it('libera el carrito, avisa de la espera y permite otra venta', async () => {
    await conVtd()
    const id = screen.getByTestId('id').textContent
    fireEvent.click(screen.getByText('Dejar en espera'))
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('0'))
    await waitFor(() => expect(screen.getByTestId('espera').textContent).toBe('1'))
    expect(screen.getByTestId('id').textContent).not.toBe(id)
    fireEvent.click(screen.getByText('Agregar 20'))
    expect(screen.getByTestId('total').textContent).toBe('20')
  })
  it('retomar recupera borrador y VTD con el carrito vacío', async () => {
    await conVtd()
    fireEvent.click(screen.getByText('Dejar en espera'))
    await waitFor(() => expect(screen.getByTestId('espera').textContent).toBe('1'))
    fireEvent.click(screen.getByText('Retomar'))
    await waitFor(() => expect(screen.getByTestId('vtds').textContent).toBe('1'))
    expect(screen.getByTestId('total').textContent).toBe('200')
  })
  it('no pisa una venta en curso al retomar', async () => {
    await conVtd()
    fireEvent.click(screen.getByText('Dejar en espera'))
    await waitFor(() => expect(screen.getByTestId('espera').textContent).toBe('1'))
    fireEvent.click(screen.getByText('Agregar 20'))
    fireEvent.click(screen.getByText('Retomar'))
    await screen.findByText(/Cobra o suspende la venta actual/)
    expect(screen.getByTestId('total').textContent).toBe('20')
  })
})
