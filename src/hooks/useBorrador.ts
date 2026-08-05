import { useCallback, useEffect, useRef, useState } from 'react'

export interface BorradorPendiente<T> {
  datos: T
  guardadoEn: number
}

export interface UseBorradorOptions {
  /** default true; permite desactivar el autosave sin desmontar el hook. */
  activo?: boolean
  /** default 500 */
  debounceMs?: number
  /** default 24 */
  ttlHoras?: number
  /**
   * TAREA 12 (Tanda 3): pasado a JSON.stringify al autoguardar, para excluir campos que
   * no tiene sentido persistir (p. ej. el carrito en modo Supabase arrastra
   * stockTienda/stockAlmacen siempre en 0 — rowToProduct nunca los llena ahí, el stock
   * real vive en un batch aparte — así que guardarlos sería un dato falso, no un dato
   * viejo). No afecta la comparación de "sin cambios" (initialSerializedRef usa el mismo
   * replacer) para que ese chequeo siga viendo el mismo shape.
   */
  replacer?: (key: string, value: unknown) => unknown
}

export interface UseBorradorResult<T> {
  borradorPendiente: BorradorPendiente<T> | null
  descartar: () => void
  limpiar: () => void
}

/** `cation:borrador:v1:<usuarioId>:<formulario>` — ver Brief H. El id de usuario evita
 * que en un equipo de mostrador compartido a alguien le aparezca el borrador ajeno. */
export const borradorKey = (formulario: string, usuarioId: string): string =>
  `cation:borrador:v1:${usuarioId}:${formulario}`

// Todo acceso a localStorage pasa por acá: en modo privado de Safari `setItem` tira
// excepción, y no puede tumbar el formulario que lo llama.
const safeGet = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const safeSet = (key: string, value: string): void => { try { localStorage.setItem(key, value) } catch { /* cuota llena / modo privado — ignorar */ } }
const safeRemove = (key: string): void => { try { localStorage.removeItem(key) } catch { /* ver arriba */ } }

/**
 * Autosave transversal de formularios (Brief H). Serializa `estado` a localStorage con
 * debounce; no persiste nada mientras `estado` siga igual al valor con el que se montó
 * el hook (formulario "vacío"/sin tocar). Nunca restaura solo — el llamador decide qué
 * hacer con `borradorPendiente` (mostrar un banner, etc).
 */
export function useBorrador<T>(clave: string, estado: T, opciones: UseBorradorOptions = {}): UseBorradorResult<T> {
  const { activo = true, debounceMs = 500, ttlHoras = 24, replacer } = opciones
  const [borradorPendiente, setBorradorPendiente] = useState<BorradorPendiente<T> | null>(null)
  const claveRef = useRef(clave)
  // Serialización del estado con el que arrancó este formulario para esta clave — hasta
  // que `estado` no se aparte de esto, no hay nada que guardar. Comparar por valor
  // (JSON.stringify), no por referencia: la mayoría de los llamadores reconstruyen el
  // objeto de estado en cada render aunque su contenido no haya cambiado.
  const initialSerializedRef = useRef<string>(JSON.stringify(estado, replacer))
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Al montar, o si cambia la clave (p. ej. se pasó de editar un borrador a otro): leer
  // lo que haya guardado y ofrecerlo si no venció el TTL. También resetea la línea base
  // de "sin cambios" para la nueva clave.
  useEffect(() => {
    claveRef.current = clave
    initialSerializedRef.current = JSON.stringify(estado, replacer)
    const raw = safeGet(clave)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage once per mount/clave change, not a derived-state sync
    if (!raw) { setBorradorPendiente(null); return }
    try {
      const parsed = JSON.parse(raw) as BorradorPendiente<T>
      if (Date.now() - parsed.guardadoEn > ttlHoras * 3_600_000) {
        safeRemove(clave)
        setBorradorPendiente(null)
        return
      }
      setBorradorPendiente(parsed)
    } catch {
      safeRemove(clave)
      setBorradorPendiente(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  useEffect(() => {
    if (!activo) return
    if (JSON.stringify(estado, replacer) === initialSerializedRef.current) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      safeSet(clave, JSON.stringify({ datos: estado, guardadoEn: Date.now() } satisfies BorradorPendiente<T>, replacer))
    }, debounceMs)
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, activo, clave, debounceMs])

  const descartar = useCallback(() => {
    safeRemove(claveRef.current)
    setBorradorPendiente(null)
  }, [])

  // Llamar tras un envío exitoso: borra la clave para que no se ofrezca de nuevo.
  const limpiar = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    safeRemove(claveRef.current)
    setBorradorPendiente(null)
  }, [])

  return { borradorPendiente, descartar, limpiar }
}
