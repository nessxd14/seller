import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePos } from './PosContext'
import { useCashSession } from './CashSessionContext'
import { featureFlags } from '../config/featureFlags'
import { authSessionProvider } from '../infrastructure/services'
import { operarCajaAlmacen } from '../infrastructure/supabase/CajaAlmacen.supabase'
import { draftFingerprint, vtdVigente, type CajaAlmacenDraft, type CajaAlmacenRecord } from '../application/shared/cajaAlmacen'
import type { VtdPorCobrar } from '../application/shared/models'

interface WarehouseContext {
  managed: boolean
  record: CajaAlmacenRecord | null
  error: string
  busy: boolean
  link: (vtds: VtdPorCobrar[]) => Promise<boolean>
  createRequest: (solicitud: object) => Promise<boolean>
  refresh: (recover?: boolean) => Promise<void>
  flush: () => Promise<void>
  resolve: (action: 'completar' | 'rechazar' | 'cerrar_rechazo' | 'ajustar', data?: object) => Promise<boolean>
}
const Context = createContext<WarehouseContext | null>(null)
const inactive: WarehouseContext = { managed: false, record: null, error: '', busy: false, link: async () => true, createRequest: async () => false, refresh: async () => {}, flush: async () => {}, resolve: async () => false }
export const useCajaAlmacen = () => useContext(Context) ?? inactive

export function CajaAlmacenProvider({ children }: { children: ReactNode }) {
  const pos = usePos()
  const { sessionId } = useCashSession()
  const [record, setRecord] = useState<CajaAlmacenRecord | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useRef<CajaAlmacenRecord | null>(null)
  const loadedId = useRef<string | null>(null)
  const actorId = useRef<string | null>(null)
  const pending = useRef(false)
  const uncertain = useRef(false)
  const epoch = useRef(0)
  const serial = useRef<Promise<void>>(Promise.resolve())
  const posRef = useRef(pos)
  const saved = useRef('')
  const draft: CajaAlmacenDraft = useMemo(() => ({ cart: pos.cart, channel: pos.channel, discount: pos.discount, customer: pos.customer, pedido: pos.pedidoEnCarrito, vendedorId: pos.vendedorId }), [pos.cart,pos.channel,pos.discount,pos.customer,pos.pedidoEnCarrito,pos.vendedorId])
  const draftJson = draftFingerprint(draft)
  const draftRef = useRef(draft)
  useEffect(() => { posRef.current = pos; draftRef.current = draft }, [pos, draft])

  const apply = useCallback((next: CajaAlmacenRecord, recover = false) => {
    uncertain.current = false
    const op = next.operacion
    if (op?.cerrado_en || (!op && loadedId.current)) {
      loadedId.current = null
      current.current = null
      setRecord(null)
      saved.current = ''
      posRef.current.finishWarehouseOperation()
      return
    }
    current.current = next
    setRecord(op ? next : null)
    posRef.current.setWarehouseLock(!!op, !!op?.comprobante)
    if (!op) return
    const vtds: VtdPorCobrar[] = next.vtds.filter(vtdVigente).map(v => ({ ventaId: String(v.venta_id), numero: v.numero, totalBs: Number(v.total), estado: 'ABIERTA', pagoPosterior: false, clienteId: v.cliente_id ? String(v.cliente_id) : undefined, clienteNombre: v.cliente ?? undefined, creadoEn: '' }))
    if (loadedId.current !== op.id || recover) {
      loadedId.current = op.id
      saved.current = draftFingerprint(op.borrador)
      posRef.current.recoverWarehouseOperation(op.id, op.borrador, vtds)
    } else {
      posRef.current.setVtdsEnCarrito(vtds)
    }
  }, [])
  const refresh = useCallback(async (recover = false) => {
    if (!featureFlags.supabase || !actorId.current || pending.current) return
    const requestActor = actorId.current
    await serial.current.catch(() => {})
    if (pending.current) return
    const requestEpoch = epoch.current
    const next = await operarCajaAlmacen('actual')
    if (actorId.current !== requestActor || requestEpoch !== epoch.current) return
    const previous = current.current?.operacion
    if (!recover && previous && next.operacion?.id === previous.id && !next.operacion.comprobante && draftFingerprint(next.operacion.borrador) !== saved.current) {
      throw new Error('La operación cambió en otra pestaña. Recupera el estado guardado antes de continuar.')
    }
    apply(next, recover)
    setError('')
  }, [apply])

  const flush = useCallback(async () => {
    const work = serial.current.catch(() => {}).then(async () => {
      const op = current.current?.operacion
      const body = draftFingerprint(draftRef.current)
      if (!op || op.comprobante || body === saved.current) return
      epoch.current++
      const next = await operarCajaAlmacen('guardar', op.id, String(op.sesion_id), { revision: op.revision, borrador: draftRef.current })
      saved.current = body
      apply(next)
    })
    serial.current = work
    return work
  }, [apply])

  const hasOperation = !!record?.operacion
  const canSave = !!record?.operacion && !record.operacion.comprobante
  useEffect(() => {
    let disposed = false
    const update = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const session = await authSessionProvider.getSession()
        if (disposed) return
        const nextActor = session?.user.active && ['cajero','admin','gerente'].includes(session.user.role) ? session.user.id : null
        if (actorId.current && actorId.current !== nextActor) {
          current.current = null; loadedId.current = null; saved.current = ''
          setRecord(null); posRef.current.finishWarehouseOperation()
        }
        actorId.current = nextActor
        await refresh()
      } catch (e) { if (!disposed && (current.current?.operacion || (e as { code?: string }).code !== 'PGRST202')) setError(e instanceof Error ? e.message : 'No se pudo consultar la operación.') }
    }
    if (featureFlags.supabase) void update()
    const tick = () => { void update() }
    const unsubscribe = featureFlags.supabase ? authSessionProvider.subscribe?.(tick) : undefined
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    const timer = window.setInterval(tick, hasOperation ? 15_000 : 60_000)
    return () => { disposed = true; unsubscribe?.(); clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [refresh, hasOperation])

  useEffect(() => {
    if (!canSave) return
    const timer = window.setTimeout(() => { void flush().catch(e => setError(e instanceof Error ? e.message : 'No se pudo guardar la operación.')) }, 700)
    return () => clearTimeout(timer)
  }, [draftJson, canSave, flush])

  const link = async (vtds: VtdPorCobrar[]) => {
    if (pending.current) return false
    pending.current = true; setBusy(true); setError('')
    epoch.current++
    posRef.current.setWarehouseLock(true, false)
    let attempted = false
    try {
      if (!sessionId) throw new Error('Abre tu turno antes de agregar la VTD.')
      await flush()
      attempted = true
      const next = await operarCajaAlmacen('vincular', posRef.current.operationId, sessionId, { vtd_ids: vtds.map(v => Number(v.ventaId)), borrador: draftRef.current, revision: current.current?.operacion?.revision ?? 0 })
      saved.current = draftFingerprint(next.operacion?.borrador)
      loadedId.current = next.operacion?.id ?? null
      apply(next)
      return true
    } catch (e) { uncertain.current = attempted && !(e as {code?: string}).code; setError(e instanceof Error ? e.message : 'No se pudo vincular la VTD.'); return false }
    finally { pending.current = false; setBusy(false); posRef.current.setWarehouseLock(!!current.current?.operacion || uncertain.current, !!current.current?.operacion?.comprobante || uncertain.current) }
  }
  const resolve = async (action: 'completar' | 'rechazar' | 'cerrar_rechazo' | 'ajustar', data: object = {}) => {
    const op = current.current?.operacion
    if (!op || pending.current) return false
    pending.current = true; setBusy(true); setError('')
    epoch.current++
    try {
      await flush()
      const next = await operarCajaAlmacen(action, op.id, String(op.sesion_id), data)
      apply(next)
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo resolver la operación.'); return false }
    finally { pending.current = false; setBusy(false) }
  }
  const createRequest = async (solicitud: object) => {
    if (pending.current) return false
    pending.current = true; setBusy(true); setError('')
    epoch.current++
    posRef.current.setWarehouseLock(true, false)
    let attempted = false
    try {
      if (!sessionId) throw new Error('Abre tu turno antes de solicitar material.')
      const emptyDraft = { ...draftRef.current, cart: [], discount: 0 }
      attempted = true
      const next = await operarCajaAlmacen('crear_vtd', posRef.current.operationId, sessionId, { solicitud, borrador: emptyDraft })
      apply(next, true)
      return true
    } catch (e) { uncertain.current = attempted && !(e as {code?: string}).code; setError(e instanceof Error ? e.message : 'No se pudo solicitar el material.'); return false }
    finally { pending.current = false; setBusy(false); posRef.current.setWarehouseLock(!!current.current?.operacion || uncertain.current, !!current.current?.operacion?.comprobante || uncertain.current) }
  }
  return <Context.Provider value={{ managed: featureFlags.supabase, record, error, busy, link, createRequest, refresh, flush, resolve }}>{children}</Context.Provider>
}
