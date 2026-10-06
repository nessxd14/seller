// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PedidoVendedorLinea, PedidoVendedorRecord } from '../../../application/shared/models'

const svc = vi.hoisted(() => ({ cola: vi.fn(), tomar: vi.fn(), devolver: vi.fn(), anular: vi.fn(), cobrar: vi.fn() }))
const prod = vi.hoisted(() => ({ resolveScannedCode: vi.fn(), search: vi.fn() }))
const turno = vi.hoisted(() => ({ estadoBancoQr: vi.fn(), estadoPagoQr: vi.fn() }))
vi.mock('../../../infrastructure/services', () => ({
  pedidoVendedorService: svc,
  turnoService: turno,
  productRepository: prod,
  authSessionProvider: { getSession: vi.fn().mockResolvedValue({ user: { id: 'c1', email: 'caja@x.com' } }) },
  listPresentations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../lib/auditoriaDvr', () => ({ auditStart: vi.fn(), auditEnd: vi.fn() }))
vi.mock('../../../components/VentaTicket', () => ({ VentaTicket: ({ id }: { id: string }) => <div role="dialog" aria-label="ticket">ticket {id}</div> }))
vi.mock('../../../components/AmbiguousScanPicker', () => ({ AmbiguousScanPicker: () => <div data-testid="ambiguo" /> }))
import { auditEnd, auditStart } from '../../../lib/auditoriaDvr'
import { PedidoVendedorCobro } from '../PedidoVendedorCobro'

const lin = (over: Partial<PedidoVendedorLinea>): PedidoVendedorLinea => ({
  lineaId: '31', orden: 1, productoId: 49, nombre: 'Resma carta', sku: 'RC', presentacionId: 47, presentacion: 'Unidad', esBase: true, factor: 1, esPersonalizado: false,
  unidadMedida: null, cantidad: 2, precioLista: 15, precioMinimo: 13.5, precioUnitario: 14, subtotal: 28, resultado: null, cantidadFinal: null, precioFinal: null, motivoCaja: null, ...over,
})
const pedido: PedidoVendedorRecord = {
  pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, fecha: '2026-10-06', estado: 'EN_CAJA', vendedor: 'Ana', nota: 'Para el cumple', total: 43, enviadoEn: new Date().toISOString(), tomadoPor: 'Rony',
  ventaNumero: null, anuladoOrigen: null, anuladoMotivo: null, reintento: false,
  lineas: [lin({}), lin({ lineaId: '32', orden: 2, productoId: 51, nombre: 'Marcador', cantidad: 1, precioLista: 15, precioMinimo: 13.5, precioUnitario: 15, subtotal: 15 })],
}
const colaFila = { pedidoId: '9', codigo: 'PDV-9', numeroDia: 3, estado: 'ENVIADO' as const, vendedor: 'Ana', enviadoEn: new Date().toISOString(), total: 43, lineas: 2, tomadoPor: null, sesionCajaId: null }

const montar = (props: Partial<Parameters<typeof PedidoVendedorCobro>[0]> = {}) => render(<PedidoVendedorCobro sessionId="4" onClose={vi.fn()} notify={vi.fn()} {...props} />)
const cobrar = () => screen.getByRole('button', { name: /^Cobrar Bs/ }) as HTMLButtonElement
const verificar = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Verificar: ${nombre}`) }))
const entrarAVerificar = async () => {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
  await screen.findByText(/Verifica cada línea|Nota del vendedor/)
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.cola.mockResolvedValue([colaFila])
  svc.tomar.mockResolvedValue(pedido)
  prod.search.mockResolvedValue({ items: [], page: 1, pageSize: 12, total: 0 })
})
afterEach(cleanup)

describe('Cola', () => {
  it('lista el pedido, filtra, y los de otra caja quedan deshabilitados; el propio dice "En tu caja"', async () => {
    svc.cola.mockResolvedValue([colaFila, { ...colaFila, pedidoId: '10', numeroDia: 4, vendedor: 'Luis', estado: 'EN_CAJA', tomadoPor: 'Rony', sesionCajaId: '7' }, { ...colaFila, pedidoId: '11', numeroDia: 5, vendedor: 'Eva', estado: 'EN_CAJA', tomadoPor: 'Yo', sesionCajaId: '4' }])
    montar()
    await screen.findByText('Ana')
    expect(screen.getByText('En caja con Rony')).toBeTruthy()
    expect(screen.getByText('En tu caja')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Luis/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Eva/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Filtrar pedidos'), { target: { value: 'ana' } })
    expect(screen.queryByText('Luis')).toBeNull()
  })

  it('sin pedidos: "No hay pedidos esperando"', async () => {
    svc.cola.mockResolvedValue([])
    montar()
    await screen.findByText('No hay pedidos esperando')
  })

  it('abierto desde el QR toma ese pedido directamente', async () => {
    montar({ initialPedidoId: '9' })
    await screen.findByText(/Nota del vendedor: Para el cumple/)
    expect(svc.tomar).toHaveBeenCalledWith('9', '4')
    expect(auditStart).toHaveBeenCalledWith({ transactionId: 'pdv-9', cajeroId: 'caja@x.com' })
  })

  it('si tomar falla muestra el mensaje de la base y se queda en la cola', async () => {
    svc.tomar.mockRejectedValue(new Error('El pedido ya lo tiene otra caja'))
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('El pedido ya lo tiene otra caja')
  })
})

describe('Verificación — el botón de cobrar', () => {
  it('queda deshabilitado hasta que cada línea esté verificada o quitada, con la primera razón como título', async () => {
    await entrarAVerificar()
    expect(cobrar().disabled).toBe(true)
    expect(cobrar().title).toMatch(/Faltan 2 líneas por verificar o quitar/)
    expect(screen.getByText('0 de 2 verificadas')).toBeTruthy()
    verificar('Resma carta')
    expect(cobrar().disabled).toBe(true)
    expect(cobrar().title).toMatch(/Faltan 1 línea/)
    fireEvent.click(screen.getByRole('button', { name: 'No lo lleva: Marcador' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sin stock' }))
    expect(cobrar().disabled).toBe(false)
    expect(cobrar().textContent).toBe('Cobrar Bs 28,00')
  })

  it('no hay "verificar todo", y editar cantidad o precio verifica la línea', async () => {
    await entrarAVerificar()
    expect(screen.queryByRole('button', { name: /todas|todo/i })).toBeNull()
    const cantidad = screen.getByLabelText('Cantidad de Resma carta')
    fireEvent.change(cantidad, { target: { value: '3' } })
    fireEvent.blur(cantidad)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verificada: Resma carta' })).toBeTruthy())
  })

  it('un precio bajo el mínimo exige elegir un motivo antes de cobrar', async () => {
    await entrarAVerificar()
    verificar('Marcador')
    const precio = screen.getByLabelText('Precio de Resma carta')
    fireEvent.change(precio, { target: { value: '10' } })
    fireEvent.blur(precio)
    await screen.findByText('Motivo del descuento (obligatorio)')
    expect(cobrar().disabled).toBe(true)
    expect(cobrar().title).toMatch(/Falta el motivo del descuento/)
    fireEvent.click(screen.getByRole('button', { name: 'Cliente frecuente' }))
    expect(cobrar().disabled).toBe(false)
  })

  it('"Otro" exige escribir el motivo', async () => {
    await entrarAVerificar()
    verificar('Marcador')
    const precio = screen.getByLabelText('Precio de Resma carta')
    fireEvent.change(precio, { target: { value: '10' } })
    fireEvent.blur(precio)
    fireEvent.click(await screen.findByRole('button', { name: 'Otro' }))
    expect(cobrar().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Otro motivo'), { target: { value: 'Pidió rebaja' } })
    expect(cobrar().disabled).toBe(false)
  })

  it('escanear un producto del pedido lo verifica; repetirlo avisa; uno ajeno ofrece agregarlo', async () => {
    const notify = vi.fn()
    montar({ notify })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    const campo = await screen.findByLabelText('Escanear o buscar producto')
    prod.resolveScannedCode.mockResolvedValue({ kind: 'found', product: { id: 49, nombre: 'Resma carta', sku: 'RC', precioRetail: 15 } })
    fireEvent.change(campo, { target: { value: '7701' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verificada: Resma carta' })).toBeTruthy())
    fireEvent.change(campo, { target: { value: '7701' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Ya verificado'))
    prod.resolveScannedCode.mockResolvedValue({ kind: 'found', product: { id: 99, nombre: 'Tijera', sku: 'T', precioRetail: 8 } })
    fireEvent.change(campo, { target: { value: '9999' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No está en el pedido'))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await screen.findByText('Agregado en caja')
    expect(screen.getByText('2 de 3 verificadas')).toBeTruthy()
  })
})

describe('Cobro', () => {
  const listoParaCobrar = async () => {
    await entrarAVerificar()
    verificar('Resma carta'); verificar('Marcador')
    fireEvent.click(cobrar())
    await screen.findByText('Cobrar pedido 3')
  }

  it('cobra un solo pedido con el payload completo, muestra el ticket y refresca el contador', async () => {
    svc.cobrar.mockResolvedValue({ ventaId: '1300', numero: 'VTA-2026-00633', subtotal: 43, descuentoTotal: 0, total: 43, reintento: false, pedidos: ['9'] })
    const onChanged = vi.fn()
    montar({ onChanged })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    await screen.findByText(/Nota del vendedor/)
    verificar('Resma carta'); verificar('Marcador')
    fireEvent.click(cobrar())
    await screen.findByText('Cobrar pedido 3')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    await screen.findByText('ticket 1300')
    expect(svc.cobrar).toHaveBeenCalledOnce()
    expect(svc.cobrar.mock.calls[0][0]).toMatchObject({
      pedidoId: '9', sesionCajaId: '4', quitadas: [], pagos: [{ method: 'cash', amountCents: 4300 }],
      lineas: [{ producto_id: 49, cantidad_base: 2, precio_unitario: 14, sucursal_origen_id: 2, pedido_linea_id: 31, verificada: true }, { producto_id: 51, pedido_linea_id: 32 }],
    })
    expect(auditEnd).toHaveBeenCalledWith({ transactionId: 'pdv-9', reason: 'completada', numero: 'VTA-2026-00633', totalBs: 43 })
    expect(onChanged).toHaveBeenCalled()
  })

  it('un error del servidor se muestra en el pago y el mismo intento se puede repetir', async () => {
    svc.cobrar.mockRejectedValueOnce(new Error('Producto 49 está reservado para otro pedido'))
    svc.cobrar.mockResolvedValueOnce({ ventaId: '1300', numero: 'V', subtotal: 43, descuentoTotal: 0, total: 43, reintento: true, pedidos: ['9'] })
    const notify = vi.fn()
    montar({ notify })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    await screen.findByText(/Nota del vendedor/)
    verificar('Resma carta'); verificar('Marcador')
    fireEvent.click(cobrar())
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cobro' }))
    await screen.findByText('Producto 49 está reservado para otro pedido')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    await screen.findByText('ticket 1300')
    expect(svc.cobrar).toHaveBeenCalledTimes(2)
    expect(svc.cobrar.mock.calls[1][0]).toEqual(svc.cobrar.mock.calls[0][0])
    expect(notify).toHaveBeenCalledWith('Este cobro ya estaba registrado. No se cobró dos veces.')
  })

  const cobrarConQr = async () => {
    svc.cobrar.mockResolvedValue({ ventaId: '1300', numero: 'VTA-2026-00633', subtotal: 43, descuentoTotal: 0, total: 43, reintento: false, pedidos: ['9'] })
    const notify = vi.fn()
    montar({ notify })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    await screen.findByText(/Nota del vendedor/)
    verificar('Resma carta'); verificar('Marcador')
    fireEvent.click(cobrar())
    await screen.findByText('Cobrar pedido 3')
    fireEvent.click(screen.getByRole('button', { name: 'QR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    return notify
  }

  it('con QR y el banco en línea retiene el cobro esperando VERIFICADO (y se puede dejar retenida)', async () => {
    turno.estadoBancoQr.mockResolvedValue({ enLinea: true })
    await cobrarConQr()
    await screen.findByText('Esperando confirmación del QR…')
    expect(screen.getByText('Monto QR: Bs 43,00')).toBeTruthy()
    expect(svc.cobrar.mock.calls[0][0].pagos).toEqual([{ method: 'qr', amountCents: 4300 }])
    expect(screen.queryByText('ticket 1300')).toBeNull()
    expect(screen.getByRole('button', { name: 'Dejar retenida' })).toBeTruthy()
  })

  it('con QR y el banco fuera de línea no frena: ticket directo y aviso', async () => {
    turno.estadoBancoQr.mockResolvedValue({ enLinea: false })
    const notify = await cobrarConQr()
    await screen.findByText('ticket 1300')
    expect(notify).toHaveBeenCalledWith('Banco sin conexión: el QR queda pendiente y lo verifica el gerente.')
  })

  it('cerrar el pago vuelve a la verificación sin perder lo verificado', async () => {
    await listoParaCobrar()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await screen.findByText('2 de 2 verificadas')
    expect(svc.cobrar).not.toHaveBeenCalled()
  })
})

describe('Salir sin cobrar', () => {
  it('por defecto devuelve el pedido a la cola y lo audita como cancelado', async () => {
    svc.devolver.mockResolvedValue(undefined)
    const onClose = vi.fn()
    montar({ onClose })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    await screen.findByText(/Nota del vendedor/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Devolver a la cola' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(svc.devolver).toHaveBeenCalledWith('9')
    expect(auditEnd).toHaveBeenCalledWith({ transactionId: 'pdv-9', reason: 'cancelada' })
  })

  it('anular exige un motivo', async () => {
    svc.anular.mockResolvedValue(pedido)
    const onClose = vi.fn()
    montar({ onClose })
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }))
    await screen.findByText(/Nota del vendedor/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Anular pedido' }))
    const dialogo = screen.getByRole('dialog', { name: 'Salir del pedido' })
    const confirmar = within(dialogo).getByRole('button', { name: 'Anular pedido' }) as HTMLButtonElement
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: 'El cliente se fue' } })
    fireEvent.click(confirmar)
    await waitFor(() => expect(svc.anular).toHaveBeenCalledWith('9', 'El cliente se fue'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('"Seguir cobrando" cierra el menú sin llamar a nada', async () => {
    await entrarAVerificar()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir cobrando' }))
    expect(screen.queryByRole('dialog', { name: 'Salir del pedido' })).toBeNull()
    expect(svc.devolver).not.toHaveBeenCalled()
    expect(svc.anular).not.toHaveBeenCalled()
  })
})
