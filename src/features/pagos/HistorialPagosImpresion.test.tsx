// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { consultarHistorialPagosMock } from '../../infrastructure/mock/historialPagos'
import { cargarPagosParaImpresion, HistorialPagosImpresion } from './HistorialPagosImpresion'

const mocks = vi.hoisted(() => ({ consultar: vi.fn() }))
vi.mock('../../infrastructure/hermes/client', () => ({ consultarHistorialPagos: mocks.consultar }))
vi.mock('../../infrastructure/services', () => ({ authSessionProvider: { getSession: async () => ({ user: { name: 'Ana', email: 'a@x', role: 'cajero' } }) } }))
vi.mock('../../config/empresaStore', () => ({ empresaStore: { razonSocial: 'Cation', direccion: 'Calle 1', ciudad: 'Trinidad', celular: '1', correo: 'c@x', nit: '123', logoSrc: '' }, loadEmpresaConfig: async () => undefined }))
vi.mock('../../components/DocumentoExportable', () => ({ DocBrand: () => <div>Cation</div> }))

const RANGO = { desde: '2020-01-01', hasta: '2099-12-31' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.consultar.mockImplementation((p: Parameters<typeof consultarHistorialPagosMock>[0]) => Promise.resolve(consultarHistorialPagosMock({ ...p, ...RANGO }, 'cajero')))
})
afterEach(cleanup)

describe('Impresión del historial', () => {
  it('pide solo confirmados y devuelve únicamente filas confirmadas', async () => {
    const filas = await cargarPagosParaImpresion(44, RANGO.desde, RANGO.hasta)
    expect(mocks.consultar).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 44, soloConfirmados: true }))
    expect(filas.length).toBe(4)
    expect(filas.every(f => f.estado === 'CONFIRMADO')).toBe(true)
  })

  it('imprime la referencia bancaria (referenciaImpresion) y deja SALDO con "—" en Recibido', async () => {
    render(<HistorialPagosImpresion cliente={{ id: 44, nombre: 'BNB', documento: '1016253021', categoria: 'Corporativo' }} desde={RANGO.desde} hasta={RANGO.hasta} formato="carta" onClose={() => {}} />)
    expect(await screen.findByText('HISTORIAL DE PAGOS')).toBeTruthy()
    expect(screen.getByText(/5976098039/)).toBeTruthy()
    expect(screen.queryByText(/Transferencia 5976098039/)).toBeNull()
    const saldo = screen.getAllByRole('row').find(r => r.textContent?.includes('Aplicación de saldo'))!
    expect(saldo.lastElementChild?.textContent).toBe('—')
    expect(screen.getByText(/Por: Ana/)).toBeTruthy()
  })
})
