import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { vtdEstadoLabels, type CajaAlmacenEnEsperaOperacion } from '../application/shared/cajaAlmacen'
import { listarCajaAlmacenEnEspera, operarCajaAlmacen } from '../infrastructure/supabase/CajaAlmacen.supabase'
import { RechazoVtdModal, type RechazoVtdData } from './RechazoVtdModal'
import '../styles/caja-almacen.css'

const RESUELTOS = ['CANCELADO', 'RETORNO_PENDIENTE', 'RETORNADO', 'ENTREGADO']
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la acción.'

export function CajaAlmacenEnEspera() {
  const [ops, setOps] = useState<CajaAlmacenEnEsperaOperacion[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejection, setRejection] = useState<{ op: CajaAlmacenEnEsperaOperacion; ventaId: number } | null>(null)

  const load = useCallback(async () => {
    const list = await listarCajaAlmacenEnEspera()
    setOps(list.operaciones)
    return list.operaciones
  }, [])
  useEffect(() => {
    let alive = true
    listarCajaAlmacenEnEspera().then(list => { if (alive) setOps(list.operaciones) }, e => { if (alive) setError(message(e)) })
    return () => { alive = false }
  }, [])

  const run = async (action: () => Promise<void>) => {
    if (busy) return false
    setBusy(true); setError('')
    try { await action(); return true } catch (e) { setError(message(e)); return false } finally { setBusy(false) }
  }
  const completar = (op: CajaAlmacenEnEsperaOperacion) => operarCajaAlmacen('completar', op.operacion.id, String(op.operacion.sesion_id), {})
  const actualizar = () => void run(async () => { await load() })
  const rechazar = async (data: RechazoVtdData) => {
    if (!rejection) return
    const { op, ventaId } = rejection
    const ok = await run(async () => {
      await operarCajaAlmacen('rechazar', op.operacion.id, String(op.operacion.sesion_id), { venta_id: ventaId, ...data })
      const fresh = (await load()).find(o => o.operacion.id === op.operacion.id)
      // Cerrar sólo si no queda material físico pendiente de entrega.
      if (fresh?.operacion.comprobante && fresh.vtds.length && fresh.vtds.every(v => RESUELTOS.includes(v.estado)) && !fresh.vtds.some(v => v.estado === 'EN_CAJA')) {
        await completar(fresh)
        await load()
      }
    })
    if (ok) setRejection(null)
  }
  const completarEntrega = (op: CajaAlmacenEnEsperaOperacion) => void run(async () => { await completar(op); await load() })

  if (!ops.length && !error) return null
  const rejOp = rejection?.op
  return <section className="caja-almacen-panel caja-almacen-en-espera" aria-label="Operaciones en espera de Almacén">
    <header className="caja-almacen-buttons"><strong>Operaciones en espera de Almacén</strong>
      <button type="button" className="secondary-button" disabled={busy} onClick={actualizar}><RefreshCw size={14} aria-hidden /> Actualizar</button></header>
    {ops.map(op => {
      const paid = !!op.operacion.comprobante
      const pending = op.vtds.some(v => v.estado === 'SOLICITADO')
      const delivered = paid && !pending && op.vtds.length > 0 && op.vtds.some(v => v.estado === 'EN_CAJA')
      return <article key={op.operacion.id} aria-label={`Operación ${op.operacion.comprobante?.numero ?? op.operacion.id}`}>
        <div><b>{op.operacion.comprobante?.numero ?? 'Sin comprobante'}</b>{op.operacion.comprobante && <span> · {`Bs ${Number(op.operacion.comprobante.total).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>}{op.turno_cerrado && <span className="badge"> Turno cerrado</span>}</div>
        <ul>{op.vtds.map(v => <li key={v.venta_id}><div><b>{v.numero}</b>{v.cliente && <span>{v.cliente}</span>}<span>{vtdEstadoLabels[v.estado]}</span></div>
          {['SOLICITADO', 'EN_CAJA'].includes(v.estado) && <div className="caja-almacen-buttons"><button type="button" className="secondary-button" disabled={busy} onClick={() => setRejection({ op, ventaId: v.venta_id })}>Rechazar</button></div>}</li>)}</ul>
        {delivered && <div className="caja-almacen-buttons"><button type="button" className="primary-button" disabled={busy} onClick={() => completarEntrega(op)}>Completar entrega y operación</button></div>}
      </article>
    })}
    {error && <p role="alert">{error}</p>}
    {rejection && rejOp && <RechazoVtdModal ventaNumero={rejOp.vtds.find(v => v.venta_id === rejection.ventaId)?.numero} paid={!!rejOp.operacion.comprobante} busy={busy} error={error} onCancel={() => setRejection(null)} onConfirm={rechazar} />}
  </section>
}
