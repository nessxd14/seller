import { useCallback, useEffect, useRef, useState } from 'react'
import { createUuid } from '../../application/shared/createUuid'
import type { PedidoVendedorRecord } from '../../application/shared/models'
import { pedidoVendedorService } from '../../infrastructure/services'
import {
  CODIGO_PRECIO_MINIMO, aLineasPayload, agregarPersonalizado, agregarProducto, cambiarPresentacion, esErrorDeRed, fusionarRespuesta, hayCambiosSinGuardar,
  pedidoDesdeServidor, precioSugerido, puedeEnviar, round2, type PedidoLocal, type PresentacionPiso, type ProductoPiso,
} from '../../domain/sales/pedidoPiso'

const AUTOSAVE_MS = 1500
const POLL_MS = 5000
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30000
const ESTADOS_ABIERTOS = ['ARMANDO', 'ENVIADO', 'EN_CAJA']
const sinClave = (obj: Record<string, string>, clave: string): Record<string, string> => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== clave))
const storageKey = (userId: string) => `roari-piso-v1:${userId}`

interface Guardado { pedidos: PedidoLocal[]; activa: string | null }

const leer = (userId: string): Guardado => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || 'null') as Guardado | null
    if (parsed && Array.isArray(parsed.pedidos)) return { pedidos: parsed.pedidos, activa: parsed.activa ?? null }
  } catch { /* storage corrupto o bloqueado: se arranca vacío */ }
  return { pedidos: [], activa: null }
}
const escribir = (userId: string, valor: Guardado) => {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(valor)) } catch { /* sin storage: sigue funcionando en memoria */ }
}

export const pedidoVacio = (): PedidoLocal => ({
  clave: createUuid(), pedidoId: null, codigo: null, numeroDia: null, estado: 'ARMANDO', lineas: [], nota: null,
  revision: 0, guardadoRevision: 0, creadoEn: new Date().toISOString(), snapshot: null,
})

/** Marca un pedido como cambiado por el vendedor: nueva revisión, autosave reactivado. */
const tocar = (p: PedidoLocal, cambios: Partial<PedidoLocal>): PedidoLocal => ({ ...p, ...cambios, revision: p.revision + 1, pausado: false })

/**
 * Pedidos del vendedor en su teléfono. No usa PosContext (modela un solo carrito de escritorio): acá hay
 * varios pedidos abiertos a la vez, guardados en el teléfono y en el servidor (autosave).
 */
export function usePedidosPiso(userId: string) {
  const [estado, setEstado] = useState<Guardado>(() => {
    const guardado = leer(userId)
    if (guardado.pedidos.length) return guardado
    const nuevo = pedidoVacio()
    return { pedidos: [nuevo], activa: nuevo.clave }
  })
  const [cargando, setCargando] = useState(true)
  const [sinConexion, setSinConexion] = useState(false)
  const [errorPedido, setErrorPedido] = useState<Record<string, string>>({})
  const ref = useRef(estado)
  const timers = useRef(new Map<string, number>())
  const vuelos = useRef(new Map<string, Promise<void>>())
  const reintentos = useRef(new Map<string, number>())
  const flushRef = useRef<(clave: string) => Promise<void>>(async () => undefined)

  const aplicar = useCallback((fn: (prev: Guardado) => Guardado) => {
    const siguiente = fn(ref.current)
    ref.current = siguiente
    setEstado(siguiente)
  }, [])
  const mapPedido = useCallback((clave: string, fn: (p: PedidoLocal) => PedidoLocal) => {
    aplicar((prev) => ({ ...prev, pedidos: prev.pedidos.map((p) => (p.clave === clave ? fn(p) : p)) }))
  }, [aplicar])

  useEffect(() => { escribir(userId, estado) }, [userId, estado])

  const programar = useCallback((clave: string, ms: number) => {
    const previo = timers.current.get(clave)
    if (previo) window.clearTimeout(previo)
    timers.current.set(clave, window.setTimeout(() => { timers.current.delete(clave); void flushRef.current(clave) }, ms))
  }, [])

  // Guardado de un pedido en ARMANDO. Una sola petición en vuelo por pedido; si llegan cambios, se vuelve a mandar al terminar.
  const flush = useCallback(async (clave: string): Promise<void> => {
    const actual = ref.current.pedidos.find((p) => p.clave === clave)
    if (!actual || actual.estado !== 'ARMANDO' || actual.pausado || !hayCambiosSinGuardar(actual)) return
    if (!actual.pedidoId && !actual.lineas.length) return
    const enVuelo = vuelos.current.get(clave)
    if (enVuelo) { await enVuelo; return flushRef.current(clave) }
    const revision = actual.revision
    const tarea = (async () => {
      try {
        const respuesta = await pedidoVendedorService.guardar({ clave, lineas: aLineasPayload(actual.lineas), nota: actual.nota })
        reintentos.current.delete(clave)
        setSinConexion(false)
        setErrorPedido((e) => sinClave(e, clave))
        mapPedido(clave, (p) => fusionarRespuesta(p, respuesta, revision))
      } catch (error) {
        const code = (error as { code?: string }).code
        const mensaje = error instanceof Error ? error.message : 'No se pudo guardar el pedido'
        if (code === CODIGO_PRECIO_MINIMO) {
          // El servidor rechazó un precio bajo el mínimo: se muestra su mensaje en esa línea, se vuelve al precio anterior y no se reintenta solo.
          mapPedido(clave, (p) => {
            const objetivo = p.lineas.filter((l) => l.nombre && mensaje.includes(l.nombre))
            const marcadas = objetivo.length ? objetivo : p.lineas.filter((l) => l.precioUnitario !== l.precioGuardado)
            const ids = new Set(marcadas.map((l) => l.localId))
            return { ...p, pausado: true, revision: p.revision + 1, lineas: p.lineas.map((l) => ids.has(l.localId)
              ? { ...l, error: mensaje, precioUnitario: l.precioGuardado ?? precioSugerido(l.precioRetail, l.factor) } : l) }
          })
        } else if (esErrorDeRed(error)) {
          setSinConexion(true)
          const espera = Math.min(RETRY_MAX_MS, (reintentos.current.get(clave) ?? RETRY_MIN_MS / 2) * 2)
          reintentos.current.set(clave, espera)
          programar(clave, espera)
        } else {
          setErrorPedido((e) => ({ ...e, [clave]: mensaje }))
        }
      }
    })()
    vuelos.current.set(clave, tarea)
    try { await tarea } finally { vuelos.current.delete(clave) }
    // Cambios que llegaron mientras viajaba la petición: una vez más con el estado más reciente.
    const despues = ref.current.pedidos.find((p) => p.clave === clave)
    if (despues && despues.estado === 'ARMANDO' && !despues.pausado && hayCambiosSinGuardar(despues) && !timers.current.has(clave) && !reintentos.current.has(clave)) programar(clave, 0)
  }, [mapPedido, programar])
  useEffect(() => { flushRef.current = flush }, [flush])

  const editar = useCallback((clave: string, fn: (p: PedidoLocal) => PedidoLocal) => {
    mapPedido(clave, (p) => (p.estado === 'ARMANDO' ? fn(p) : p))
    programar(clave, AUTOSAVE_MS)
  }, [mapPedido, programar])

  // Al arrancar: reconcilia con el servidor (otro teléfono, storage borrado, avance de caja).
  const reconciliar = useCallback(async (conClaves: boolean) => {
    const remotos = await pedidoVendedorService.misPedidos()
    const claves = conClaves ? await pedidoVendedorService.clavesAbiertas(userId) : []
    const clavePorId = new Map(claves.map((c) => [c.pedidoId, c.clave]))
    aplicar((prev) => {
      const locales = [...prev.pedidos]
      for (const remoto of remotos) {
        const i = locales.findIndex((l) => l.pedidoId === remoto.pedidoId || (clavePorId.has(remoto.pedidoId) && l.clave === clavePorId.get(remoto.pedidoId)))
        if (i >= 0) locales[i] = reconciliarUno(locales[i], remoto)
        else {
          const clave = clavePorId.get(remoto.pedidoId)
          if (clave) locales.push(pedidoDesdeServidor(remoto, clave, createUuid))
        }
      }
      // Los que ya no están en el servidor y estaban cerrados salen de la lista; los no guardados todavía se conservan.
      const idsRemotos = new Set(remotos.map((r) => r.pedidoId))
      const vigentes = locales.filter((l) => !l.pedidoId || idsRemotos.has(l.pedidoId))
      const pedidos = vigentes.length ? vigentes : [pedidoVacio()]
      const activa = pedidos.some((p) => p.clave === prev.activa) ? prev.activa : pedidos[0].clave
      return { pedidos, activa }
    })
  }, [aplicar, userId])

  useEffect(() => {
    let cancelado = false
    void reconciliar(true).then(() => { setSinConexion(false) }).catch((error) => { if (esErrorDeRed(error)) setSinConexion(true) }).finally(() => { if (!cancelado) setCargando(false) })
    // Cambios locales que quedaron sin guardar en una sesión anterior.
    for (const p of ref.current.pedidos) if (p.estado === 'ARMANDO' && hayCambiosSinGuardar(p)) programar(p.clave, AUTOSAVE_MS)
    const temporizadores = timers.current
    return () => { cancelado = true; temporizadores.forEach((t) => window.clearTimeout(t)) }
  }, [reconciliar, programar])

  // Al ocultar la página (cambio de app, bloqueo) se guarda de inmediato todo lo pendiente.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      for (const p of ref.current.pedidos) {
        if (p.estado === 'ARMANDO' && hayCambiosSinGuardar(p)) {
          const t = timers.current.get(p.clave)
          if (t) { window.clearTimeout(t); timers.current.delete(p.clave) }
          void flushRef.current(p.clave)
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Avance de caja: mientras haya pedidos enviados o en caja y la página esté visible, cada 5 s.
  const siguiendo = estado.pedidos.some((p) => p.estado === 'ENVIADO' || p.estado === 'EN_CAJA')
  useEffect(() => {
    if (!siguiendo) return
    const tick = () => { if (document.visibilityState === 'visible') void reconciliar(false).then(() => setSinConexion(false)).catch((e) => { if (esErrorDeRed(e)) setSinConexion(true) }) }
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [siguiendo, reconciliar])

  const activo = estado.pedidos.find((p) => p.clave === estado.activa) ?? estado.pedidos[0]

  const accion = async (clave: string, fn: () => Promise<PedidoVendedorRecord>, vacio: string): Promise<boolean> => {
    setErrorPedido((e) => sinClave(e, clave))
    try {
      const respuesta = await fn()
      mapPedido(clave, (p) => ({ ...p, pedidoId: respuesta.pedidoId, codigo: respuesta.codigo, numeroDia: respuesta.numeroDia, estado: respuesta.estado, snapshot: respuesta }))
      return true
    } catch (error) {
      setErrorPedido((e) => ({ ...e, [clave]: error instanceof Error ? error.message : vacio }))
      return false
    }
  }

  return {
    pedidos: estado.pedidos, activo, cargando, sinConexion, errorPedido,
    activar: (clave: string) => aplicar((prev) => ({ ...prev, activa: clave })),
    nuevo: () => aplicar((prev) => {
      const vacio = prev.pedidos.find((p) => p.estado === 'ARMANDO' && !p.pedidoId && !p.lineas.length)
      if (vacio) return { ...prev, activa: vacio.clave }
      const p = pedidoVacio()
      return { pedidos: [...prev.pedidos, p], activa: p.clave }
    }),
    agregar: (product: ProductoPiso, presentation?: PresentacionPiso) => editar(activo.clave, (p) => tocar(p, { lineas: agregarProducto(p.lineas, product, presentation, createUuid()) })),
    agregarPersonalizado: (input: { descripcion: string; unidadMedida: string; cantidad: number; precio: number }) =>
      editar(activo.clave, (p) => tocar(p, { lineas: agregarPersonalizado(p.lineas, input, createUuid()) })),
    cambiarCantidad: (localId: string, cantidad: number) => editar(activo.clave, (p) => tocar(p, { lineas: p.lineas.map((l) => (l.localId === localId ? { ...l, cantidad } : l)) })),
    cambiarPrecio: (localId: string, precio: number) => editar(activo.clave, (p) => tocar(p, { lineas: p.lineas.map((l) => (l.localId === localId ? { ...l, precioUnitario: round2(precio), error: undefined } : l)) })),
    cambiarPresentacion: (localId: string, presentation: PresentacionPiso) => editar(activo.clave, (p) => tocar(p, { lineas: p.lineas.map((l) => (l.localId === localId ? cambiarPresentacion(l, presentation) : l)) })),
    quitar: (localId: string) => editar(activo.clave, (p) => tocar(p, { lineas: p.lineas.filter((l) => l.localId !== localId) })),
    setNota: (nota: string) => editar(activo.clave, (p) => tocar(p, { nota: nota || null })),
    guardarAhora: () => flush(activo.clave),

    /** Guarda con p_enviar = true (reemplaza todas las líneas) y deja de autoguardar este pedido. */
    enviar: async (): Promise<boolean> => {
      const p = ref.current.pedidos.find((x) => x.clave === activo.clave)
      if (!p || p.estado !== 'ARMANDO') return false
      if (!puedeEnviar(p.lineas)) { setErrorPedido((e) => ({ ...e, [p.clave]: 'Agrega al menos un producto y ponle precio a todas las líneas.' })); return false }
      const t = timers.current.get(p.clave)
      if (t) { window.clearTimeout(t); timers.current.delete(p.clave) }
      reintentos.current.delete(p.clave)
      await vuelos.current.get(p.clave)
      const revision = ref.current.pedidos.find((x) => x.clave === p.clave)!.revision
      const lineas = ref.current.pedidos.find((x) => x.clave === p.clave)!.lineas
      const ok = await accion(p.clave, () => pedidoVendedorService.guardar({ clave: p.clave, lineas: aLineasPayload(lineas), enviar: true, nota: p.nota }), 'No se pudo enviar el pedido')
      if (ok) mapPedido(p.clave, (x) => ({ ...fusionarRespuesta(x, x.snapshot as PedidoVendedorRecord, revision) }))
      return ok
    },
    retirar: async (): Promise<boolean> => {
      if (!activo.pedidoId) return false
      const id = activo.pedidoId
      const ok = await accion(activo.clave, () => pedidoVendedorService.retirar(id), 'No se pudo retirar el pedido')
      // Vuelve a ser editable: lo que está en pantalla ya coincide con lo guardado.
      if (ok) mapPedido(activo.clave, (p) => ({ ...p, guardadoRevision: p.revision, pausado: false }))
      return ok
    },
    anular: async (): Promise<boolean> => {
      if (!activo.pedidoId) {
        // Nunca llegó al servidor: se descarta localmente.
        aplicar((prev) => {
          const resto = prev.pedidos.filter((p) => p.clave !== activo.clave)
          const pedidos = resto.length ? resto : [pedidoVacio()]
          return { pedidos, activa: pedidos[0].clave }
        })
        return true
      }
      const id = activo.pedidoId
      return accion(activo.clave, () => pedidoVendedorService.anular(id), 'No se pudo anular el pedido')
    },
    abiertos: estado.pedidos.filter((p) => ESTADOS_ABIERTOS.includes(p.estado)).length,
  }
}

/** Aplica el estado del servidor a un pedido local sin pisar lo que el vendedor está editando. */
const reconciliarUno = (local: PedidoLocal, remoto: PedidoVendedorRecord): PedidoLocal => {
  const comun = { ...local, pedidoId: remoto.pedidoId, codigo: remoto.codigo, numeroDia: remoto.numeroDia, snapshot: remoto }
  if (local.estado === 'ARMANDO' && remoto.estado === 'ARMANDO' && hayCambiosSinGuardar(local)) return comun
  return { ...comun, estado: remoto.estado }
}
