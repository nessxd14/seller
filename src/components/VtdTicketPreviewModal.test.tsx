// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VtdTicketPreviewModal } from './VtdTicketPreviewModal'
import type { VentaDirectaRecord } from '../application/shared/models'
const qa = vi.hoisted(() => ({ qr: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: qa.qr } }))
vi.mock('./Modal', () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../config/empresaStore', () => ({ empresaStore: { razonSocial: 'Empresa QA', direccion: 'Dirección QA', ciudad: 'Ciudad QA' } }))
const venta: VentaDirectaRecord = { id: '38', numero: 'VTD-2026-00038', estado: 'ABIERTA', modo: 'PRECOBRADO', ubicacionId: 4, sesionCajaId: '1', subtotalCents: 2000, discountCents: 0, totalCents: 2000, paidCents: 2000, cobroExigible: true, pagoPosterior: false, creadoEn: '2026-10-12T10:00:00Z', lines: [] }
beforeEach(() => { qa.qr.mockReset().mockResolvedValue('data:image/png;base64,cWE='); vi.spyOn(window, 'print').mockImplementation(() => {}) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('espera la imagen del QR antes de imprimir y conserva su zona de silencio', async () => {
  render(<VtdTicketPreviewModal venta={venta} onClose={() => {}} />)
  expect(screen.getByRole('button', { name: 'Preparando QR…' }).hasAttribute('disabled')).toBe(true)
  const qr = await screen.findByAltText('Código QR del documento')
  expect(qa.qr).toHaveBeenCalledWith(expect.stringContaining('/operaciones/vtd/38?escanear=1'), { margin: 4, width: 320, errorCorrectionLevel: 'M' })
  fireEvent.load(qr)
  const imprimir = screen.getByRole('button', { name: 'Imprimir' })
  expect(imprimir.hasAttribute('disabled')).toBe(false); fireEvent.click(imprimir)
  expect(window.print).toHaveBeenCalledOnce()
})
it('cambiar de ticket impide imprimir el QR anterior', async () => {
  const view = render(<VtdTicketPreviewModal venta={venta} onClose={() => {}} />)
  fireEvent.load(await screen.findByAltText('Código QR del documento'))
  let resolver: (src: string) => void = () => {}
  qa.qr.mockImplementationOnce(() => new Promise<string>(resolve => { resolver = resolve }))
  view.rerender(<VtdTicketPreviewModal venta={{ ...venta, id: '39', numero: 'VTD-2026-00039' }} onClose={() => {}} />)
  expect(screen.queryByAltText('Código QR del documento')).toBeNull()
  expect(screen.getByRole('button', { name: 'Preparando QR…' }).hasAttribute('disabled')).toBe(true)
  resolver('data:image/png;base64,bnVldm8=')
  fireEvent.load(await screen.findByAltText('Código QR del documento'))
  expect(screen.getByRole('button', { name: 'Imprimir' }).hasAttribute('disabled')).toBe(false)
})
it('un fallo del generador bloquea impresión y muestra cómo reintentar', async () => {
  qa.qr.mockRejectedValueOnce(new Error('QA fallo'))
  render(<VtdTicketPreviewModal venta={venta} onClose={() => {}} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('vuelve a abrir'))
  expect(screen.getByRole('button', { name: 'Preparando QR…' }).hasAttribute('disabled')).toBe(true)
  expect(window.print).not.toHaveBeenCalled()
})
