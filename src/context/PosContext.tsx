import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getPrice } from '../data/products'
import type { CartItem, Product, SalesChannel } from '../types'
import { ventaLineTotalCents } from '../domain/sales/ventaPricing'
import { moneyFromDecimal } from '../domain/common/money'
import type { TransferMotivo } from '../application/shared/models'
import { featureFlags } from '../config/featureFlags'
import { consultarSaldos } from '../infrastructure/hermes/client'

// Brief J: 1 = Almacén Central, 2 = Tienda (mismos ids que SUCURSAL_ALMACEN_ID/
// SUCURSAL_TIENDA_ID en infrastructure/supabase/mappers.ts — no se importan de ahí
// para no acoplar este contexto, backend-agnóstico, a la capa Supabase).
const SUCURSAL_ALMACEN = 1
const SUCURSAL_TIENDA = 2

// Brief VTD: mismo carrito/motor que 'traslado' — solo cambia el destino (abrir_venta vs
// registrar_venta/crear_solicitud_traslado) y qué se muestra (ver 2.1 del brief: "junto a
// la opción de traslado que ya existe").
export type PosMode = 'venta' | 'traslado' | 'ventaDirecta'

/**
 * TAREA 1 (Tanda 4): default de origen por línea. Retail sugiere Tienda; mayoreo/
 * institucional/corporativo sugieren Almacén (son ventas grandes, y ahí es donde vive el
 * volumen — ver el caso de Goma Eva Azul: 520 uds. en Almacén, 0 en Tienda). Un cliente
 * ACREEDOR (cuenta corriente en Hermes) siempre sugiere Tienda sin importar el canal —
 * es la ubicación desde la que efectivamente se le entrega. En todos los casos es una
 * SUGERENCIA: el selector queda visible y editable, nunca un candado.
 */
const defaultOrigenFor = (channel: SalesChannel, esAcreedor: boolean): 'Tienda' | 'Almacén' =>
  esAcreedor || channel === 'retail' ? 'Tienda' : 'Almacén'

// Corrección Tanda 2 Tarea 1: operationNumber vive solo en memoria y vuelve a su valor
// inicial en cada F5, así que no sirve como identidad de idempotencia (un cobro fallido
// + recarga reusaría la clave de una operación distinta). sessionStorage sobrevive a un
// F5 pero muere con la pestaña, y es independiente entre pestañas — dos cajeros en dos
// pestañas del mismo navegador no pueden compartir identidad de operación.
const OPERACION_ID_KEY = 'roari-operacion-id-v1'

const nuevoOperacionId = () => {
  const id = crypto.randomUUID()
  sessionStorage.setItem(OPERACION_ID_KEY, id)
  return id
}

// TAREA 8 (Tanda 3): operationNumber sale impreso en el ticket como "Operación #" — con
// useState(1048) puro, dos tickets del mismo día podían llevar el mismo número tras un
// F5. Ya no es crítico para idempotencia (ver corrección de Tanda 2 arriba), pero el
// número visible sigue siendo el mismo, así que se persiste junto a operationId.
const OPERACION_NUMERO_KEY = 'roari-operacion-numero-v1'
const OPERACION_NUMERO_INICIAL = 1048

const leerOperacionNumero = (): number => {
  const raw = sessionStorage.getItem(OPERACION_NUMERO_KEY)
  const parsed = raw != null ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : OPERACION_NUMERO_INICIAL
}

const guardarOperacionNumero = (numero: number): void => { sessionStorage.setItem(OPERACION_NUMERO_KEY, String(numero)) }

// TAREA 4: the cart's active customer. undefined/null id means "Cliente de mostrador"
// (anonymous, cliente_id = null at checkout) — the default and always-available state.
export interface CartCustomer {
  id?: string
  name: string
  documento?: string
}

interface PosState {
  channel: SalesChannel
  setChannel: (channel: SalesChannel) => void
  cart: CartItem[]
  addProduct: (product: Product) => void
  addCustomItem: (input: { descripcion: string; cantidad: number; precio: number }) => void
  updateQuantity: (id: number, quantity: number) => void
  updateItem: (id: number, values: Partial<CartItem>) => void
  removeItem: (id: number) => void
  clearCart: () => void
  discount: number
  setDiscount: (value: number) => void
  subtotal: number
  total: number
  operationNumber: number
  operationId: string
  newOperation: () => void
  // Deja el POS listo para la próxima venta SIN avanzar operationNumber/operationId — la
  // operación en curso no terminó, se guardó para después (suspender) o ya se resolvió por
  // otra vía (solicitud de traslado creada). Ver CartPanel.suspend/solicitarTraslado.
  clearOperation: () => void
  loadSuspendedSale: (sale: { channel: SalesChannel; cart: CartItem[]; discount: number; customer?: CartCustomer | null }) => void
  customer: CartCustomer | null
  selectCustomer: (customer: CartCustomer | null) => void
  // Brief J — modo traslado: mismo carrito, mismo motor de agregar productos; solo
  // cambia el destino (registrar_venta vs crear_solicitud_traslado) y qué se muestra.
  mode: PosMode
  setMode: (mode: PosMode) => void
  trasladoMotivo: TransferMotivo
  setTrasladoMotivo: (motivo: TransferMotivo) => void
  trasladoOrigenId: number
  trasladoDestinoId: number
  setTrasladoDireccion: (origenId: number, destinoId: number) => void
  loadTrasladoDraft: (draft: { cart: CartItem[]; trasladoMotivo: TransferMotivo; trasladoOrigenId: number; trasladoDestinoId: number }) => void
  // Brief VTD 2.1: ubicación de origen (obligatoria, sin default hardcodeado — el cajero
  // elige cuando Almacén Central tiene más de una) y modo de cobro (precobrado envía
  // p_pagos, postcobrado envía null — ver 2.2).
  vtdUbicacionId: number | null
  setVtdUbicacionId: (id: number | null) => void
  vtdPrecobrado: boolean
  setVtdPrecobrado: (value: boolean) => void
  loadVtdDraft: (draft: { cart: CartItem[]; vtdUbicacionId: number | null; vtdPrecobrado: boolean }) => void
}

const PosContext = createContext<PosState | null>(null)

export function PosProvider({ children }: { children: ReactNode }) {
  const [channel, setChannelState] = useState<SalesChannel>('retail')
  const [cart, setCart] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [operationNumber, setOperationNumberState] = useState(leerOperacionNumero)
  const setOperationNumber = (updater: (current: number) => number) => setOperationNumberState((current) => { const next = updater(current); guardarOperacionNumero(next); return next })
  const [operationId, setOperationId] = useState<string>(
    () => sessionStorage.getItem(OPERACION_ID_KEY) ?? nuevoOperacionId(),
  )
  const [customer, setCustomer] = useState<CartCustomer | null>(null)
  // TAREA 1 (Tanda 4): acreedor = tiene cuenta corriente en Hermes (aparece en la
  // respuesta de consultar_saldos), sin mirar el monto — un acreedor con saldo 0 sigue
  // siendo acreedor. Se consulta UNA vez al seleccionar el cliente (nunca por producto,
  // nunca en cada addProduct) y se cachea acá. Si Hermes no responde, consultarSaldos
  // devuelve null (no confundir con "sin cuenta", que es un Map sin esa entrada) — en
  // ese caso se trata como no-acreedor y se aplica la regla de canal, sin bloquear nada.
  const [esAcreedor, setEsAcreedor] = useState(false)
  // Refs para no cerrar sobre un `channel`/`esAcreedor` obsoleto dentro del .then() de
  // consultarSaldos, que resuelve después de que el componente ya pudo re-renderizar.
  const channelRef = useRef(channel)
  useEffect(() => { channelRef.current = channel }, [channel])
  const recomputeOrigenes = (nextChannel: SalesChannel, nextEsAcreedor: boolean) => {
    const origen = defaultOrigenFor(nextChannel, nextEsAcreedor)
    // Solo las líneas que el cajero NO tocó a mano (origenManual) — ver el campo en types.ts.
    setCart((items) => items.map((item) => item.origenManual ? item : { ...item, ubicacion: origen }))
  }
  const selectCustomer = (next: CartCustomer | null) => {
    setCustomer(next)
    const idNum = next?.id ? Number(next.id) : NaN
    if (!featureFlags.supabase || !Number.isFinite(idNum)) {
      setEsAcreedor(false)
      recomputeOrigenes(channelRef.current, false)
      return
    }
    void consultarSaldos([idNum]).then((mapa) => {
      const acreedor = mapa ? mapa.has(idNum) : false
      setEsAcreedor(acreedor)
      recomputeOrigenes(channelRef.current, acreedor)
    })
  }

  const [mode, setMode] = useState<PosMode>('venta')
  const [trasladoMotivo, setTrasladoMotivoState] = useState<TransferMotivo>('REPOSICION')
  const [trasladoOrigenId, setTrasladoOrigenId] = useState(SUCURSAL_ALMACEN)
  const [trasladoDestinoId, setTrasladoDestinoId] = useState(SUCURSAL_TIENDA)
  // El motivo Devolución preselecciona la dirección invertida (Tienda → Almacén);
  // los otros dos motivos vuelven al default Almacén → Tienda. El admin puede
  // corregirla después con setTrasladoDireccion — esa es la última palabra.
  const setTrasladoMotivo = (motivo: TransferMotivo) => {
    setTrasladoMotivoState(motivo)
    if (motivo === 'DEVOLUCION') { setTrasladoOrigenId(SUCURSAL_TIENDA); setTrasladoDestinoId(SUCURSAL_ALMACEN) }
    else { setTrasladoOrigenId(SUCURSAL_ALMACEN); setTrasladoDestinoId(SUCURSAL_TIENDA) }
  }
  const setTrasladoDireccion = (origenId: number, destinoId: number) => { setTrasladoOrigenId(origenId); setTrasladoDestinoId(destinoId) }
  const [vtdUbicacionId, setVtdUbicacionId] = useState<number | null>(null)
  const [vtdPrecobrado, setVtdPrecobrado] = useState(false)
  const loadVtdDraft = (draft: { cart: CartItem[]; vtdUbicacionId: number | null; vtdPrecobrado: boolean }) => {
    setMode('ventaDirecta')
    setCart(draft.cart)
    setVtdUbicacionId(draft.vtdUbicacionId)
    setVtdPrecobrado(draft.vtdPrecobrado)
  }
  const loadTrasladoDraft = (draft: { cart: CartItem[]; trasladoMotivo: TransferMotivo; trasladoOrigenId: number; trasladoDestinoId: number }) => {
    setMode('traslado')
    setCart(draft.cart)
    setTrasladoMotivoState(draft.trasladoMotivo)
    setTrasladoOrigenId(draft.trasladoOrigenId)
    setTrasladoDestinoId(draft.trasladoDestinoId)
  }

  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

  const setChannel = (next: SalesChannel) => {
    setChannelState(next)
    // Bug fix (brief TAREA 3): getPrice() always returns the product's PER-BASE-UNIT channel
    // price. A line with an active non-base presentation (e.g. "3 Caja") must multiply that
    // by its factorUnidadBase to get the per-presentation-unit price — otherwise switching
    // channels silently re-prices a "Caja" line as if it were a single loose unit. Mirrors
    // DraftOrderEditor's channel/presentation recompute: reset to the new channel's suggested
    // price (any manual override the seller made is discarded, same as changing presentation).
    // TAREA B: lines the seller already manually re-priced (precioModificado) are frozen —
    // "se respeta" applies to both the applied price and its discount, so neither is touched
    // by an automatic channel switch. Untouched lines keep the exact recompute above,
    // including the presentation-factor multiplication.
    setCart((items) => items.map((item) => {
      const priced = item.precioModificado
        ? item
        : { ...item, precioAplicado: roundMoney(getPrice(item, next) * (item.factorUnidadBase ?? 1)), descuento: 0 }
      // TAREA 1 (Tanda 4): recalcula el default de origen al cambiar de canal, pero
      // solo en las líneas que el cajero no ajustó a mano (origenManual).
      return priced.origenManual ? priced : { ...priced, ubicacion: defaultOrigenFor(next, esAcreedor) }
    }))
    setDiscount(0)
  }

  const addProduct = (product: Product) => setCart((items) => {
    const existing = items.find((item) => item.id === product.id)
    return existing
      ? items.map((item) => item.id === product.id ? { ...item, cantidad: item.cantidad + 1 } : item)
      : [...items, { ...product, cantidad: 1, precioAplicado: getPrice(product, channel), descuento: 0, ubicacion: defaultOrigenFor(channel, esAcreedor), origenManual: false, observacion: '', motivoPrecio: '' }]
  })

  // Brief S11 Bloque C: ítem sin producto de catálogo — sin SKU, sin stock, sin origen
  // (no tiene sentido validar stock de algo que no está en el catálogo). id negativo y
  // único por Date.now(), para que nunca choque con un id de producto real (siempre
  // positivo) y el resto del código que indexa el carrito por item.id (Maps de stock,
  // updateItem, removeItem) siga funcionando sin ramas nuevas. No se puede vender por
  // registrar_venta (no tiene producto_id) — CartPanel deshabilita Cobrar cuando hay uno;
  // sí se puede cotizar (crear_cotizacion/crear_pedido ya soportan es_personalizado).
  const addCustomItem = (input: { descripcion: string; cantidad: number; precio: number }) => {
    const id = -(Date.now() + Math.floor(Math.random() * 1000))
    const item: CartItem = {
      id, sku: '', codigoBarra: '', codigoFabrica: '', nombre: input.descripcion, descripcion: input.descripcion,
      categoria: '', imagen: '', color: '',
      precioRetail: input.precio, precioMayoreo: input.precio, precioInstitucional: input.precio, precioCorporativo: input.precio,
      stockTienda: 0, stockAlmacen: 0,
      cantidad: Math.max(1, Math.floor(input.cantidad)), precioAplicado: Math.max(0, input.precio), descuento: 0,
      ubicacion: 'Tienda', observacion: '', motivoPrecio: '', origenManual: true, precioModificado: true,
      isCustomItem: true,
    }
    setCart((items) => [...items, item])
  }

  // TAREA 7 (Tanda 3): verificado contra la base viva — el catálogo activo es 100%
  // unidades discretas (unidad/UNIDAD/Unidad, RESMA, PLIEGO, PZC x 1; ninguna continua
  // como metro o kilo). Math.floor es correcto hoy; si en algún momento se da de alta un
  // producto con unidad_base continua, esto y ventaLineTotalCents necesitan revisarse
  // juntos (ese redondeo es el que evita que registrar_venta rechace el cobro por
  // descuadre de centavos) — no tocar sin correr los tests de ventaPricing.
  const updateQuantity = (id: number, quantity: number) => setCart((items) => items.map((item) => item.id === id ? { ...item, cantidad: Math.max(1, Math.floor(quantity)) } : item))
  const updateItem = (id: number, values: Partial<CartItem>) => setCart((items) => items.map((item) => item.id === id ? { ...item, ...values, cantidad: Math.max(1, Math.floor(values.cantidad ?? item.cantidad)), precioAplicado: Math.max(0, roundMoney(values.precioAplicado ?? item.precioAplicado)), descuento: Math.min(100, Math.max(0, values.descuento ?? item.descuento)) } : item))
  const removeItem = (id: number) => setCart((items) => items.filter((item) => item.id !== id))
  const clearCart = () => { setCart([]); setDiscount(0) }
  // TAREA 5 (Tanda 3): newOperation reseteaba carrito/descuento/cliente pero no `mode`
  // ni los campos de traslado — después de solicitar un traslado seguías en modo
  // traslado sin darte cuenta, y el siguiente carrito se armaba para traslado en vez
  // de venta. Vuelve siempre a modo venta con la dirección default (Almacén → Tienda).
  // Brief S3: extraído de newOperation para que suspender (que no termina la operación,
  // solo la guarda) también pueda soltar cliente/canal sin avanzar operationNumber/
  // operationId — antes solo hacía clearCart(), y una venta suspendida con cliente
  // institucional dejaba al próximo carrito pegado a ese cliente y canal.
  const resetOperationState = () => {
    clearCart()
    setChannelState('retail')
    setCustomer(null)
    setEsAcreedor(false)
    setMode('venta')
    setTrasladoMotivoState('REPOSICION')
    setTrasladoOrigenId(SUCURSAL_ALMACEN)
    setTrasladoDestinoId(SUCURSAL_TIENDA)
    setVtdUbicacionId(null)
    setVtdPrecobrado(false)
  }
  const newOperation = () => {
    resetOperationState()
    setOperationNumber((number) => number + 1)
    setOperationId(nuevoOperacionId())
  }
  const totals = useMemo(() => {
    const subtotalCents = cart.reduce((sum, item) => sum + ventaLineTotalCents(item), 0)
    const discountCents = Math.min(subtotalCents, Math.max(0, moneyFromDecimal(discount).cents))
    return { subtotalDecimal: subtotalCents / 100, totalDecimal: (subtotalCents - discountCents) / 100 }
  }, [cart, discount])
  const subtotal = totals.subtotalDecimal
  const total = totals.totalDecimal
  const safeSetDiscount = (value: number) => setDiscount(roundMoney(Math.min(subtotal, Math.max(0, Number.isFinite(value) ? value : 0))))
  // TAREA 4 backward compatibility: `sale.customer` is absent on sales suspended before
  // this round (the v2 localStorage records didn't carry it yet). `?? null` mirrors the
  // same optional-field tolerance already established for CartItem's presentation fields
  // — a missing customer degrades to "Cliente de mostrador," never a crash.
  // TAREA 5 (Tanda 3): también vuelve a modo venta — restaurar una venta suspendida
  // mientras se estaba en modo traslado no debe dejar el modo a medio cambiar.
  const loadSuspendedSale = (sale: { channel: SalesChannel; cart: CartItem[]; discount: number; customer?: CartCustomer | null }) => {
    setMode('venta')
    setChannelState(sale.channel)
    setCart(sale.cart)
    setDiscount(Math.max(0, sale.discount))
    setCustomer(sale.customer ?? null)
    // Las líneas restauradas ya traen su propio `ubicacion`/`origenManual` de cuando se
    // suspendieron — no hay que recalcular nada, solo evitar que quede pegado el
    // `esAcreedor` de la sesión anterior.
    setEsAcreedor(false)
  }

  return <PosContext.Provider value={{ channel, setChannel, cart, addProduct, addCustomItem, updateQuantity, updateItem, removeItem, clearCart, discount, setDiscount: safeSetDiscount, subtotal, total, operationNumber, operationId, newOperation, clearOperation: resetOperationState, loadSuspendedSale, customer, selectCustomer, mode, setMode, trasladoMotivo, setTrasladoMotivo, trasladoOrigenId, trasladoDestinoId, setTrasladoDireccion, loadTrasladoDraft, vtdUbicacionId, setVtdUbicacionId, vtdPrecobrado, setVtdPrecobrado, loadVtdDraft }}>{children}</PosContext.Provider>
}

export const usePos = () => {
  const context = useContext(PosContext)
  if (!context) throw new Error('usePos debe usarse dentro de PosProvider')
  return context
}
