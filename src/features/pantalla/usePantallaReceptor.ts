import { useEffect, useReducer, useRef } from 'react'
import { abrirReceptor } from './transporte'
import { PANTALLA_CORRECCION_MS, PANTALLA_SIN_CONEXION_MS, reducirVista, vistaInicial, type PantallaVista } from './pantallaVista'

/**
 * Escucha el canal de una caja y mantiene el último estado. Si no llega ningún mensaje en 35 s
 * (ni siquiera el latido del emisor) marca «sin conexión»; nunca muestra errores.
 */
export function usePantallaReceptor(cajaId: number | null): PantallaVista {
  const [vista, despachar] = useReducer(reducirVista, vistaInicial)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (cajaId == null) return
    let cancelado = false
    let receptor: { cerrar(): void } | null = null
    const armar = () => {
      if (temporizador.current) clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => despachar({ tipo: 'sin-conexion' }), PANTALLA_SIN_CONEXION_MS)
    }
    armar()
    abrirReceptor({
      cajaId,
      onEstado: (estado) => { armar(); despachar({ tipo: 'estado', estado }) },
    }).then((abierto) => {
      if (cancelado) abierto.cerrar()
      else receptor = abierto
    }).catch((error) => console.warn('[pantalla-cliente] no se pudo abrir el canal', error))
    return () => {
      cancelado = true
      receptor?.cerrar()
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [cajaId])

  const correccionId = vista.correccion?.id
  useEffect(() => {
    if (correccionId == null) return
    const id = setTimeout(() => despachar({ tipo: 'correccion-vencida', id: correccionId }), PANTALLA_CORRECCION_MS)
    return () => clearTimeout(id)
  }, [correccionId])

  return vista
}
