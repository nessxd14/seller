// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TransferRecord } from '../../../application/shared/models'

const mocks = vi.hoisted(() => ({ receive: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({ transferService: mocks, productRepository: { resolveScannedCode: vi.fn() } }))
vi.mock('../EscanerContinuo', () => ({ EscanerContinuo: () => null, vibrarDesconocido: vi.fn() }))
import { RecibirTrasladoPiso } from '../RecibirTrasladoPiso'

const t: TransferRecord = {
  id: '1', numero: 'TRA-2026-00088', motivo: 'REPOSICION', estado: 'EN_TRANSITO', sucursalOrigenId: 1, sucursalDestinoId: 2, solicitadoPor: 'x',
  solicitadoEn: '2026-11-16T10:00:00Z', creadoEn: '2026-11-16T10:00:00Z', despachadoEn: '2026-11-16T12:00:00Z',
  lines: [{ id: '11', productId: '1', name: 'Cinta', sku: 'C', presentacionId: 5, presentacionNombre: 'Caja', cantidadPresentacion: 2, cantidadBase: 24, cantidadDespachada: 24, estado: 'DESPACHADA' }],
}
const abrir = (onRecibido = vi.fn()) => render(<RecibirTrasladoPiso traslado={t} onVolver={vi.fn()} onRecibido={onRecibido} aviso={vi.fn()} />)
beforeEach(() => { vi.clearAllMocks(); mocks.receive.mockResolvedValue(t) })
afterEach(cleanup)
const boton = () => screen.getByRole('button', { name: /Confirmar recepción/ }) as HTMLButtonElement

it('confirmar está desactivado hasta marcar la casilla; llegada completa manda null', async () => {
  const onRecibido = vi.fn()
  abrir(onRecibido)
  expect(boton().disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('Conté todo con mis manos'))
  expect(boton().disabled).toBe(false)
  fireEvent.click(boton())
  await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith('1', null))
  await waitFor(() => expect(onRecibido).toHaveBeenCalled())
})

it('un faltante manda cantidades base y avisa en ámbar', async () => {
  abrir()
  fireEvent.click(screen.getByRole('button', { name: 'Menos Llegaron Cinta' }))
  expect(screen.getByText(/Faltan 1: quedan como faltante/)).toBeTruthy()
  fireEvent.click(screen.getByLabelText('Conté todo con mis manos'))
  expect(boton().textContent).toContain('1 faltante')
  fireEvent.click(boton())
  await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith('1', [{ lineaId: '11', cantidadBase: 12 }]))
})

it('muestra el error del servidor', async () => {
  mocks.receive.mockRejectedValue({ message: 'Stock cambió' })
  abrir()
  fireEvent.click(screen.getByLabelText('Conté todo con mis manos'))
  fireEvent.click(boton())
  expect((await screen.findByRole('alert')).textContent).toBe('Stock cambió')
})
