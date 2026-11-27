import { useEffect, useRef } from 'react'
import { usePos } from '../../context/PosContext'
import { useCashSession } from '../../context/CashSessionContext'
import type { MockRole } from '../../application/auth/AuthSessionProvider'
import { createUuid } from '../../application/shared/createUuid'
import { construirLineas, detectarCambio, type PantallaCambio, type PantallaFase, type PantallaLinea } from '../../domain/pantalla/pantallaCliente'
import { EmisorPantalla } from './EmisorPantalla'
import { usePantallaCliente } from './PantallaClienteContext'

export const PANTALLA_GRACIAS_MS = 6_000
const ROLES_EMISORES: readonly MockRole[] = ['cajero', 'gerente', 'supervisor', 'admin']

/**
 * Publica en la pantalla del cliente lo que pasa en Caja. Se monta UNA vez donde conviven
 * usePos() y useCashSession(). Solo emite con rol de caja, sesión de caja abierta y modo venta
 * (en traslado y venta directa manda reposo).
 */
export function usePantallaClienteEmisor(rol: MockRole | undefined): void {
  const { cart, subtotal, total, mode } = usePos()
  const { cajaId } = useCashSession()
  const { cobroEnCurso, gracias, limpiarGracias } = usePantallaCliente()
  const activo = !!rol && ROLES_EMISORES.includes(rol) && cajaId != null
  const emisorId = useRef<string>('')
  const emisor = useRef<EmisorPantalla | null>(null)
  const lineasPrevias = useRef<PantallaLinea[]>([])
  const cambio = useRef<{ ultimaKey: string; ultimoCambio: PantallaCambio } | null>(null)
  // Firma del carrito ya cobrado: mientras no cambie, tras los 6 s de «gracias» la tablet queda en reposo y no vuelve a mostrar lo pagado.
  const firmaCobrada = useRef<string | null>(null)

  // Canal: uno por caja; al cambiar de caja, cerrar la sesión o salir se manda reposo y se suelta.
  useEffect(() => {
    if (!activo || cajaId == null) return
    if (!emisorId.current) emisorId.current = createUuid()
    lineasPrevias.current = []
    cambio.current = null
    firmaCobrada.current = null
    const nuevo = new EmisorPantalla(cajaId, emisorId.current)
    emisor.current = nuevo
    return () => { nuevo.cerrar(); if (emisor.current === nuevo) emisor.current = null }
  }, [activo, cajaId])

  // Snapshot completo en cada cambio de carrito, descuento, cobro o gracias.
  useEffect(() => {
    if (!activo || !emisor.current) return
    const lineas = construirLineas(cart)
    const detectado = detectarCambio(lineasPrevias.current, lineas)
    lineasPrevias.current = lineas
    if (lineas.length === 0) cambio.current = null
    else if (detectado) cambio.current = detectado
    // Una línea nueva corta la pantalla de gracias antes de los 6 s.
    const graciasVigente = gracias && detectado?.ultimoCambio !== 'agregado' ? gracias : null
    if (gracias && !graciasVigente) window.setTimeout(limpiarGracias, 0)
    const firma = cart.map((item) => `${item.id}:${item.cantidad}`).join('|')
    if (graciasVigente) firmaCobrada.current = firma
    else if (firmaCobrada.current != null && (lineas.length === 0 || firma !== firmaCobrada.current)) firmaCobrada.current = null
    const yaCobrada = !graciasVigente && !cobroEnCurso && lineas.length > 0 && firmaCobrada.current === firma
    const enVenta = mode === 'venta' && !yaCobrada
    const fase: PantallaFase = !enVenta ? 'reposo' : graciasVigente ? 'gracias' : cobroEnCurso ? 'cobro' : lineas.length ? 'venta' : 'reposo'
    emisor.current.actualizar({
      fase,
      carrito: enVenta ? cart : [],
      subtotal: enVenta ? subtotal : 0,
      total: !enVenta ? 0 : graciasVigente ? graciasVigente.total : cobroEnCurso ? cobroEnCurso.total : total,
      ultimaKey: enVenta ? cambio.current?.ultimaKey ?? null : null,
      ultimoCambio: enVenta ? cambio.current?.ultimoCambio ?? null : null,
      cobro: fase === 'gracias' ? graciasVigente?.cobro : fase === 'cobro' ? cobroEnCurso?.cobro : undefined,
      ticket: fase === 'gracias' ? graciasVigente?.ticket : undefined,
    })
  }, [activo, cajaId, cart, subtotal, total, mode, cobroEnCurso, gracias, limpiarGracias])

  // «Gracias» dura 6 s.
  const graciasId = gracias?.id
  useEffect(() => {
    if (graciasId == null) return
    const id = window.setTimeout(limpiarGracias, PANTALLA_GRACIAS_MS)
    return () => window.clearTimeout(id)
  }, [graciasId, limpiarGracias])
}
