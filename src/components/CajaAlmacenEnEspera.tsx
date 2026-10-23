import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { faltanteTexto, vtdEstadoLabels, type CajaAlmacenEnEsperaOperacion } from '../application/shared/cajaAlmacen'
import { listarCajaAlmacenEnEspera, operarCajaAlmacen } from '../infrastructure/supabase/CajaAlmacen.supabase'
import { RechazoVtdModal, type RechazoVtdData } from './RechazoVtdModal'
import { AjusteVtdModal, type AjusteVtdPayload } from './AjusteVtdModal'
import '../styles/caja-almacen.css'

const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la acción.'

export function CajaAlmacenEnEspera() {
  const [ops, setOps] = useState<CajaAlmacenEnEsperaOperacion[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejection, setRejection] = useState<{ op: CajaAlmacenEnEsperaOperacion; ventaId: number } | null>(null)
  const [adjusting, setAdjusting] = useState<{ op: CajaAlmacenEnEsperaOperacion; ventaId: number } | null>(null)

  const load = useCallback(async () => {
    const list = await listarCajaAlmacenEnEspera()
    setOps(list.operaciones)
    return list.operaciones
  }, [])
  useEffect(() => {
    let alive = true
    listarCajaAlmacenEnEspera().then(list => { if (alive) setOps(list.operaciones) }, e => { if (alive) setError(message(e)) })
    // Sin polling: se relee al volver a la ventana, que es cuando Almacén pudo haber reportado.
    const onFocus = () => { listarCajaAlmacenEnEspera().then(list => { if (alive) setOps(list.operaciones) }, () => {}) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
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
    // La base cierra la operación en la misma transacción al rechazar la última VTD pendiente;
    // al releer, una operación cerrada ya no aparece en la lista.
    const ok = await run(async () => {
      await operarCajaAlmacen('rechazar', op.operacion.id, String(op.operacion.sesion_id), { venta_id: ventaId, ...data })
      await load()
    })
    if (ok) setRejection(null)
  }
  const ajustar = async (payload: AjusteVtdPayload) => {
    if (!adjusting) return
    const { op } = adjusting
    const ok = await run(async () => { await operarCajaAlmacen('ajustar', op.operacion.id, String(op.operacion.sesion_id), payload); await load() })
    if (ok) setAdjusting(null)
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
        <ul>{op.vtds.map(v => <li key={v.venta_id}><div><b>{v.numero}</b>{v.cliente && <span>{v.cliente}</span>}<span>{vtdEstadoLabels[v.estado]}</span>{v.estado === 'SOLICITADO' && v.faltante && <strong className="caja-almacen-faltante" role="status">{faltanteTexto(v)} — ajusta la VTD</strong>}</div>
          {['SOLICITADO', 'EN_CAJA'].includes(v.estado) && <div className="caja-almacen-buttons">{v.estado === 'SOLICITADO' && <button type="button" className="secondary-button" disabled={busy} onClick={() => setAdjusting({ op, ventaId: v.venta_id })}>Ajustar</button>}<button type="button" className="secondary-button" disabled={busy} onClick={() => setRejection({ op, ventaId: v.venta_id })}>Rechazar</button></div>}</li>)}</ul>
        {delivered && <div className="caja-almacen-buttons"><button type="button" className="primary-button" disabled={busy} onClick={() => completarEntrega(op)}>Completar entrega y operación</button></div>}
      </article>
    })}
    {error && <p role="alert">{error}</p>}
    {adjusting && adjusting.op.vtds.find(v => v.venta_id === adjusting.ventaId) && <AjusteVtdModal vtd={adjusting.op.vtds.find(v => v.venta_id === adjusting.ventaId)!} paid={!!adjusting.op.operacion.comprobante} busy={busy} error={error} onCancel={() => setAdjusting(null)} onConfirm={ajustar} />}
    {rejection && rejOp && <RechazoVtdModal ventaNumero={rejOp.vtds.find(v => v.venta_id === rejection.ventaId)?.numero} paid={!!rejOp.operacion.comprobante} busy={busy} error={error} onCancel={() => setRejection(null)} onConfirm={rechazar} />}
  </section>
}
