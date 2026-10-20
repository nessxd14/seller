// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AuthSession } from '../../application/auth/AuthSessionProvider'
import type { TransferRecord } from '../../application/shared/models'

const mocks = vi.hoisted(() => ({ list: vi.fn(), getById: vi.fn(), dispatch: vi.fn(), receive: vi.fn(), recover: vi.fn(), create: vi.fn(), presentations: vi.fn() }))
vi.mock('../../infrastructure/services', () => ({ transferService: mocks, productRepository: { search: vi.fn() }, listPresentations: mocks.presentations }))
vi.mock('../../context/PosContext', () => ({ usePos: () => ({ loadTrasladoDraft: vi.fn() }) }))
vi.mock('../../components/TrasladoExportable', () => ({ TrasladoExportable: () => null }))
import { TransfersPage } from './TransfersPage'

const session = (role: AuthSession['user']['role'], sucursalId?: number): AuthSession => ({ user: { id: 'u', name: role, role, active: true, sucursalId }, expiresAt: '2999-01-01' })
const record: TransferRecord = { id: '1', numero: 'TRA-QA', motivo: 'REPOSICION', estado: 'SOLICITADO', sucursalOrigenId: 1, sucursalDestinoId: 2, solicitadoPor: 'QA', solicitadoEn: '2026-10-01', creadoEn: '2026-10-01', lines: [{ id: '11', productId: '1', name: 'Cajas QA', sku: 'QA', cantidadBase: 10, cantidadDespachada: 0, estado: 'POR_DESPACHAR' }] }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([record]); mocks.getById.mockResolvedValue(record); mocks.presentations.mockResolvedValue([]); vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: /TRA-QA/ })); await screen.findByRole('heading', { name: 'TRA-QA' }) }

it('el vendedor puede solicitar y consultar pero no despachar', async () => {
  render(<TransfersPage session={session('vendedor', 2)} notify={vi.fn()} />)
  await open()
  expect(screen.getByRole('button', { name: /Nueva solicitud/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Registrar salida/ })).toBeNull()
})

it('conserva y muestra el resultado sin envío y la tanda creada, sin anunciar despacho', async () => {
  const notify = vi.fn()
  mocks.dispatch.mockResolvedValue({ ...record, estado: 'CANCELADO', lines: record.lines.map((l) => ({ ...l, estado: 'CAMBIADA' })), resultadoDespacho: { estado: 'CANCELADO', cantidad_despachada: 0, bloqueadas_por_stock: [{ linea_id: 11, pedido: 10, disponible: 0 }], tanda_faltante_id: 2 } })
  render(<TransfersPage session={session('almacenero', 1)} notify={notify} />)
  await open(); fireEvent.click(screen.getByRole('button', { name: /Registrar salida/ }))
  await screen.findByText('No salió mercadería de este traslado')
  expect(screen.getByText(/no salió por stock/)).toBeTruthy()
  expect(screen.getByRole('button', { name: /Abrir nueva tanda/ })).toBeTruthy()
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('no salió mercadería'))
  expect(mocks.dispatch).toHaveBeenCalledWith('1', [{ lineaId: '11', accion: 'DESPACHAR', cantidadBase: 10 }])
})

it('muestra el error de recepción y no permite enviar dos veces mientras espera', async () => {
  const transit: TransferRecord = { ...record, estado: 'EN_TRANSITO', lines: [{ ...record.lines[0], estado: 'DESPACHADA', cantidadDespachada: 7 }, { ...record.lines[0], id: '12', name: 'Rechazada QA', estado: 'RECHAZADO', cantidadDespachada: 0 }] }
  mocks.list.mockResolvedValue([transit]); mocks.getById.mockResolvedValue(transit)
  let reject!: (reason: unknown) => void
  mocks.receive.mockImplementation(() => new Promise((_resolve, no) => { reject = no }))
  render(<TransfersPage session={session('vendedor', 2)} notify={vi.fn()} />)
  await open(); fireEvent.click(screen.getByRole('button', { name: /Confirmar recepción física/ }))
  await waitFor(() => expect(mocks.receive).toHaveBeenCalledOnce())
  expect(mocks.receive).toHaveBeenCalledWith('1', [{ lineaId: '11', cantidadBase: 7 }])
  expect((screen.getByRole('button', { name: /Registrando/ }) as HTMLButtonElement).disabled).toBe(true)
  reject({ message: 'Stock cambió. Reintenta.', code: '40001' })
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Stock cambió. Reintenta.')
})

it('exige recuperar las líneas antiguas antes de habilitar la recepción', async () => {
  const legacy = { ...record, estado: 'EN_TRANSITO' as const }
  mocks.list.mockResolvedValue([legacy]); mocks.getById.mockResolvedValue(legacy)
  render(<TransfersPage session={session('almacenero', 1)} notify={vi.fn()} />)
  await open()
  expect(screen.getByRole('button', { name: /Recuperar líneas sin salida/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Confirmar recepción física/ })).toBeNull()
})

it('los errores de creación quedan visibles en el formulario', async () => {
  mocks.create.mockRejectedValue({ message: 'No se pudo crear por conexión', code: 'PGRST' })
  render(<TransfersPage session={session('vendedor', 2)} initialRequest={{ productId: '1', productName: 'QA', productSku: 'QA', quantity: 1 }} notify={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Crear solicitud' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo crear por conexión')
})

it('una devolución nueva invierte la dirección y conserva las cantidades declaradas', async () => {
  mocks.create.mockResolvedValue(record)
  render(<TransfersPage session={session('vendedor', 2)} initialRequest={{ productId: '1', productName: 'QA', productSku: 'QA', quantity: 3 }} notify={vi.fn()} />)
  const direction = await screen.findByRole('combobox', { name: 'Dirección del traslado' })
  const reason = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'VENTA_DIRECTA')!
  fireEvent.change(reason, { target: { value: 'DEVOLUCION' } })
  expect((direction as HTMLSelectElement).value).toBe('reverse')
  fireEvent.click(screen.getByRole('button', { name: 'Crear solicitud' }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ motivo: 'DEVOLUCION', sucursalOrigenId: 2, sucursalDestinoId: 1, lines: [{ productId: '1', cantidadBase: 3, nota: undefined }] })))
})
