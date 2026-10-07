// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CartPanel } from '../CartPanel'
import { PosProvider, usePos } from '../../context/PosContext'
import { CashSessionProvider } from '../../context/CashSessionContext'
import type { VtdPorCobrar } from '../../application/shared/models'

// El carrito permite cobrar una VTD sola o junto a productos de mostrador.
// La prueba usa un turno propio y stock suficiente; el bloqueo viene de mezclar VTD.
const listPorCobrar = vi.fn()
const cobrarVtd = vi.fn()
const vtdSeleccionable: VtdPorCobrar = { ventaId: '1', numero: 'VTD-2026-00001', estado: 'ABIERTA', clienteNombre: 'Juan Pérez', totalBs: 150, pagoPosterior: false, creadoEn: new Date().toISOString() }

vi.mock('../../infrastructure/services', () => ({
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', role: 'cajero', active: true }, expiresAt: '2099-01-01' }) },
  turnoService: { getSesionAbierta: vi.fn().mockResolvedValue({ id: '1', cajeroId: 'u1' }) },
  cashService: { getOpenSession: vi.fn().mockResolvedValue({ id: '1', register: 'Caja Tienda', openedAt: new Date().toISOString(), openingCents: 0, status: 'open', movements: [] }) },
  transferService: { create: vi.fn() },
  ventaDirectaService: {
    getUbicacionVentasDirectas: vi.fn().mockResolvedValue(1),
    listAbiertas: vi.fn().mockResolvedValue([]),
    listPorCobrar: (...args: unknown[]) => listPorCobrar(...args),
    cobrarVtd: (...args: unknown[]) => cobrarVtd(...args),
    getById: vi.fn().mockResolvedValue(null),
  },
  borradorOperacionService: { save: vi.fn() },
  getStockBySucursalBatch: vi.fn().mockResolvedValue(new Map([[999, { tienda: 100, almacen: 100, tiendaLibre: false, almacenLibre: false, tiendaVendible: 100, almacenVendible: 100, tiendaReservado: 0, almacenReservado: 0, tiendaMotivo: null, almacenMotivo: null }]])),
  configService: { listSucursales: vi.fn().mockResolvedValue([]) },
  listPresentations: vi.fn().mockResolvedValue([]),
}))

beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(cleanup)

// Agrega un producto de catálogo al carrito antes de que se monte CartPanel, usando el
// mismo PosProvider real (sin mockear usePos) — más fiel que reimplementar el estado.
function Wrapper({ withCatalogItem }: { withCatalogItem: boolean }) {
  return <PosProvider>
    <CashSessionProvider>
      <SeedCart withCatalogItem={withCatalogItem} />
      <CartPanel notify={() => {}} onOpenDraftOrder={() => {}} onGoToCash={() => {}} />
    </CashSessionProvider>
  </PosProvider>
}

function SeedCustom({ precio }: { precio: number }) {
  const { addCustomItem } = usePos()
  useEffect(() => { addCustomItem({ descripcion: 'SELLO AUTOMATICO', cantidad: 2, precio, unidadMedida: 'JUEGO' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function SeedCart({ withCatalogItem }: { withCatalogItem: boolean }) {
  const { addProduct } = usePos()
  useEffect(() => {
    if (!withCatalogItem) return
    addProduct({
      id: 999, sku: 'SKU-999', codigoBarra: '', codigoFabrica: '', nombre: 'Producto de prueba', descripcion: '',
      categoria: '', imagen: '', color: '', precioRetail: 10, precioMayoreo: 10, precioInstitucional: 10, precioCorporativo: 10,
      stockTienda: 100, stockAlmacen: 100,
    } as never)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('CartPanel — cobro de VTD desde el carrito (Brief Caja VTD)', () => {
  it('agregar una VTD con el carrito vacío habilita "Cobrar VTD"', async () => {
    listPorCobrar.mockResolvedValue([vtdSeleccionable])
    render(<Wrapper withCatalogItem={false} />)

    fireEvent.click(await screen.findByRole('button', { name: '+ Agregar VTD' }))
    await waitFor(() => expect(screen.getByText('VTD-2026-00001')).toBeTruthy())
    fireEvent.click(screen.getByText('VTD-2026-00001').closest('label')!.querySelector('input[type="checkbox"]')!)
    fireEvent.click(screen.getByRole('button', { name: /Agregar \(1\)/ }))

    await waitFor(() => expect(screen.getByText(/VTD-2026-00001/)).toBeTruthy())
    expect((screen.getByRole('button',{name:/Cobrar todo/}) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(/Por ahora la VTD se cobra sola/)).toBeNull()
  })

  it('mezclar catálogo + VTD habilita un cobro único con el total combinado', async () => {
    listPorCobrar.mockResolvedValue([vtdSeleccionable])
    render(<Wrapper withCatalogItem />)

    fireEvent.click(await screen.findByRole('button', { name: '+ Agregar VTD' }))
    await waitFor(() => expect(screen.getByText('VTD-2026-00001')).toBeTruthy())
    fireEvent.click(screen.getByText('VTD-2026-00001').closest('label')!.querySelector('input[type="checkbox"]')!)
    fireEvent.click(screen.getByRole('button', { name: /Agregar \(1\)/ }))

    await waitFor(() => expect((screen.getByRole('button', {name:/Cobrar todo/}) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText(/Por ahora la VTD/)).toBeNull()
    expect(screen.getByRole('button', {name:/Cobrar todo/}).textContent).toMatch(/160/)

  })
})

describe('CartPanel — ítems personalizados se pueden cobrar', () => {
  const renderCustom = (precio: number) => render(<PosProvider><CashSessionProvider><SeedCustom precio={precio} /><CartPanel notify={() => {}} onOpenDraftOrder={() => {}} onGoToCash={() => {}} /></CashSessionProvider></PosProvider>)

  it('con precio > 0, Cobrar queda habilitado y no hay aviso de "solo cotizar"', async () => {
    renderCustom(15)
    const cobrar = await screen.findByRole('button', { name: /^Cobrar/ }) as HTMLButtonElement
    await waitFor(() => expect(cobrar.disabled).toBe(false))
    expect(screen.queryByText(/solo se pueden cotizar/)).toBeNull()
  })

  it('con precio 0, Cobrar queda deshabilitado (línea sin precio)', async () => {
    renderCustom(0)
    const cobrar = await screen.findByRole('button', { name: /^Cobrar/ }) as HTMLButtonElement
    expect(cobrar.disabled).toBe(true)
  })
})

describe('CartPanel — "+ Pedido de vendedor" (Brief Caja pedido de vendedor)', () => {
  const renderPanel = (props: { pedidosVendedorEnEspera?: number; onOpenPedidosVendedor?: () => void }) => render(
    <PosProvider><CashSessionProvider><CartPanel notify={() => {}} onOpenDraftOrder={() => {}} onGoToCash={() => {}} {...props} /></CashSessionProvider></PosProvider>,
  )

  it('muestra el enlace con el contador de pedidos en espera y lo abre', async () => {
    const abrir = vi.fn()
    renderPanel({ pedidosVendedorEnEspera: 3, onOpenPedidosVendedor: abrir })
    const link = await screen.findByRole('button', { name: /\+ Pedido de vendedor/ }) as HTMLButtonElement
    expect(link.dataset.posAction).toBe('pedido-vendedor')
    expect(screen.getByLabelText('3 en espera')).toBeTruthy()
    await waitFor(() => expect(link.disabled).toBe(false))
    fireEvent.click(link)
    expect(abrir).toHaveBeenCalledOnce()
  })

  it('sin contador no hay badge; sin callback (rol sin caja) no hay enlace', async () => {
    renderPanel({ onOpenPedidosVendedor: () => {} })
    await screen.findByRole('button', { name: /\+ Pedido de vendedor/ })
    expect(screen.queryByLabelText(/en espera/)).toBeNull()
    cleanup()
    renderPanel({})
    await screen.findByRole('button', { name: '+ Agregar VTD' })
    expect(screen.queryByText(/Pedido de vendedor/)).toBeNull()
  })
})
