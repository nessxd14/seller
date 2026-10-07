import { useCallback, useState } from 'react'
import { Printer } from 'lucide-react'
import type { CajaReceipt } from '../../application/shared/cajaCheckout'
import { comprobantesCaja } from '../../infrastructure/supabase/CajaCheckout.supabase'
import { CajaTicket } from '../../components/CajaTicket'
import { useCashRefresh } from './useCashRefresh'

export function CajaComprobantes({ sessionId }: { sessionId: string }) {
  const [receipts, setReceipts] = useState<CajaReceipt[]>([])
  const [selected, setSelected] = useState<CajaReceipt | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setReceipts(await comprobantesCaja(sessionId)); setError('') }
    catch { setError('No se pudieron consultar los comprobantes unificados. Reintenta actualizar.') }
  }, [sessionId])
  useCashRefresh(load, `comprobantes-${sessionId}`)
  return <section className="cash-movements cash-tickets"><h3>Comprobantes unificados</h3>{error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Actualizar</button></p>}{receipts.map(r => <div className="turno-ticket-row" key={r.id}><span>{r.numero}<small>{r.cliente ?? 'Cliente de mostrador'} · {r.vendedor ?? 'Sin vendedor asignado'}</small></span><b>Bs {(r.totalCents/100).toLocaleString('es-BO',{minimumFractionDigits:2})}</b><button type="button" onClick={() => setSelected(r)}><Printer /> Reimprimir</button></div>)}{!error && !receipts.length && <p className="cash-muted">Los cobros combinados aparecerán aquí.</p>}{selected && <CajaTicket receipt={selected} onClose={() => setSelected(null)} />}</section>
}
