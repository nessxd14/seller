// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetalleCobroPedido } from '../DetalleCobroPedido'
import { DetalleCobroContenido } from '../DetalleCobroContenido'
import { leerDetalleCobro, rolActor, type DetalleCobro } from '../../domain/orders/detalleCobro'
import { detalleEjemplo } from './detalleCobro.fixture'
const { consultar } = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../../infrastructure/supabase/CobroPedido.supabase', () => ({ consultarDetalleCobroPedido: consultar }))
afterEach(cleanup)
beforeEach(() => { consultar.mockReset() })

describe('detalle de partidas y rastro de cobros', () => {
  it('muestra partidas saldadas y distingue cobrador, verificador y responsable del turno', () => {
    render(<DetalleCobroContenido data={detalleEjemplo} />)
    expect(screen.getByText('2 de 2 partidas saldadas')).toBeTruthy()
    expect(screen.getByText('Entrega 2 · partida hija · Ampliación del pedido')).toBeTruthy()
    expect(screen.getAllByText('Ana Rojas').length).toBeGreaterThan(0)
    expect(screen.getAllByText('María López').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Luis Herrera').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Responsable del turno')).toHaveLength(2)
    expect(screen.getAllByText(/Saldada el/)).toHaveLength(2)
  })
  it('no transforma el rol actual ni la fecha desconocida de un cobro histórico en datos auditados', () => {
    const data = structuredClone(detalleEjemplo)
    data.partidas[0].saldada_en = null; data.partidas[0].fecha_saldado_fuente = 'NO_REGISTRADA'
    data.pagos[0].cobrado_por = { ...data.pagos[0].cobrado_por, rol: null, rol_actual: 'gerente', historico: true }
    render(<DetalleCobroContenido data={data} />)
    expect(screen.getByText(/Fecha de saldado no registrada/)).toBeTruthy()
    expect(screen.getByText(/Rol actual: Gerente · rol histórico no registrado/)).toBeTruthy()
    expect(rolActor(data.pagos[0].cobrado_por)).not.toBe('Gerente')
  })
  it('rechaza una partida marcada saldada si aún tiene deuda o un conteo contradictorio', () => {
    const data = structuredClone(detalleEjemplo)
    data.partidas[0].pendiente = 10
    expect(() => leerDetalleCobro(data)).toThrow(/inconsistente/)
    data.partidas[0].pendiente = 0; data.resumen.saldadas = 1
    expect(() => leerDetalleCobro(data)).toThrow(/Conteo/)
  })
  it('una respuesta tardía de otro pedido no reemplaza al pedido seleccionado', async () => {
    let resolve!: (data: DetalleCobro) => void
    consultar.mockImplementationOnce(() => new Promise<DetalleCobro>(r => { resolve = r })).mockResolvedValueOnce({ ...detalleEjemplo, pedido: { ...detalleEjemplo.pedido!, id: 702 }, resumen: { vigentes: 1, saldadas: 0, anuladas: 0 }, partidas: [{ ...detalleEjemplo.partidas[0], saldada: false, pendiente: 100, saldada_en: null, fecha_saldado_fuente: 'NO_REGISTRADA' }] })
    const { rerender } = render(<DetalleCobroPedido pedidoId="701" />)
    rerender(<DetalleCobroPedido pedidoId="702" />)
    await screen.findByText('0 de 1 partidas saldadas')
    await act(async () => { resolve(detalleEjemplo) })
    expect(screen.queryByText('2 de 2 partidas saldadas')).toBeNull()
  })
  it('pagina con cursor y conserva los eventos ya cargados', async () => {
    consultar.mockResolvedValueOnce({ ...detalleEjemplo, historial: detalleEjemplo.historial.slice(0, 2), siguiente: 105 })
      .mockResolvedValueOnce({ ...detalleEjemplo, historial: detalleEjemplo.historial.slice(2), siguiente: null })
    render(<DetalleCobroPedido pedidoId="701" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver eventos anteriores' }))
    await waitFor(() => expect(consultar).toHaveBeenLastCalledWith('701', 105))
    await screen.findByText('6 de 6 eventos')
  })
  it('una consulta sin activar muestra una explicación y no inventa partidas saldadas', async () => {
    consultar.mockRejectedValue(new Error('Detalle pendiente de activar'))
    render(<DetalleCobroPedido pedidoId="701" />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Detalle pendiente de activar')
    expect(screen.queryByText('2 de 2 partidas saldadas')).toBeNull()
  })
})
