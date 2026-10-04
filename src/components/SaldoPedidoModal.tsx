import { useRef, useState } from 'react'
import { Wallet } from 'lucide-react'
import { Modal } from './Modal'
import { NumberField } from './NumberField'
import { useSaldoCliente } from '../hooks/useSaldoCliente'
import { aplicarSaldoPedido } from '../infrastructure/supabase/SaldoCliente.supabase'
import { createUuid } from '../application/shared/createUuid'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
type BalanceAttempt = Parameters<typeof aplicarSaldoPedido>[0]
function readAttempt(key: string, pedidoId: string): BalanceAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as BalanceAttempt | null
    return value?.pedidoId === pedidoId && typeof value.key === 'string' && typeof value.sesionId === 'string' && Number.isFinite(value.saldoBs) && value.saldoBs > 0 ? value : null
  } catch { return null }
}

export function SaldoPedidoModal({ pedidoId, clienteId, numero, sesionId, onClose, onSuccess }: { pedidoId: string; clienteId: string; numero: string; sesionId: string; onClose: () => void; onSuccess: () => void }) {
  const { saldo, loading, error: loadError, refresh } = useSaldoCliente(clienteId, pedidoId)
  const pendingKey = `roari-saldo-pedido:${pedidoId}`
  const [pending, setPending] = useState(() => readAttempt(pendingKey, pedidoId))
  const [amount, setAmount] = useState<number | null>(null)
  const [collectDifference, setCollectDifference] = useState(false)
  const [method, setMethod] = useState('EFECTIVO')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef({ key: createUuid(), content: '' })
  const applied = pending?.saldoBs ?? Math.max(0, Math.min(amount ?? saldo?.disponible ?? 0, saldo?.disponible ?? 0))
  const remaining = Math.max(0, Math.round(((saldo?.pedidoPendiente ?? 0) - applied) * 100) / 100)
  const submit = async () => {
    if (submitting || (!pending && loading) || applied <= 0) return
    const content = JSON.stringify([pedidoId, applied, collectDifference ? remaining : 0, method])
    if (operation.current.content && operation.current.content !== content) operation.current.key = createUuid()
    operation.current.content = content
    setSubmitting(true); setError('')
    try {
      const attempt = pending ?? { pedidoId, saldoBs: applied, sesionId, key: operation.current.key, dineroNuevoBs: collectDifference ? remaining : 0, metodo: method }
      localStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt)
      await aplicarSaldoPedido(attempt)
      localStorage.removeItem(pendingKey)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar el saldo')
      if (/^(P0001|42501|22\w{3}|23\w{3})$/.test(String((err as { code?: string })?.code ?? ''))) { localStorage.removeItem(pendingKey); setPending(null) }
      void refresh()
    }
    finally { setSubmitting(false) }
  }
  return <Modal title="Aplicar saldo a favor" subtitle={numero} onClose={() => { if (!submitting) onClose() }}>
    <div className="modal-body">
      {!pending && loading && <p role="status">Consultando saldo y pendiente del pedido…</p>}
      {!pending && loadError && <p role="alert">{loadError} <button onClick={() => void refresh()}>Volver a consultar</button></p>}
      {pending && <section className="credit-payment-summary"><strong>Aplicación pendiente de comprobar</strong><span>Saldo del intento: Bs {bs(pending.saldoBs)}</span><span>Dinero nuevo del intento: Bs {bs(pending.dineroNuevoBs ?? 0)}</span><p>El reintento comprueba la misma operación y conserva su clave e importes.</p></section>}
      {saldo && !pending && <><section className="credit-payment-option"><Wallet /><strong>Saldo confirmado disponible: Bs {bs(saldo.disponible)}</strong><p>Este dinero ya se recibió. Aplicarlo no crea un nuevo ingreso de caja.</p></section>
        <fieldset className="payment-entry-fields" disabled={submitting}><label>Saldo que se aplicará (Bs)<NumberField min={0} max={saldo.disponible} step={0.01} value={applied} onCommit={setAmount} /></label>
          <p>Pendiente del pedido: Bs {bs(saldo.pedidoPendiente)}</p>
          {remaining > 0 && <><label className="credit-use-toggle"><input type="checkbox" checked={collectDifference} onChange={e => setCollectDifference(e.target.checked)} />Cobrar también el restante</label>{collectDifference && <label>Método del dinero nuevo<select value={method} onChange={e => setMethod(e.target.value)}><option value="EFECTIVO">Efectivo</option><option value="QR">QR</option><option value="TRANSFERENCIA">Transferencia</option></select></label>}</>}
        </fieldset>
        <div className="credit-amount-due"><span>{collectDifference ? 'Dinero nuevo por cobrar' : 'Queda por pagar'}</span><strong>Bs {bs(remaining)}</strong></div>
        {collectDifference && remaining > 0 && <small>El cobro nuevo se registrará en caja y quedará por verificar en el conciliador.</small>}
      </>}
      {error && <p className="payment-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions"><button className="secondary-button" disabled={submitting} onClick={onClose}>Cancelar</button><button className="primary-button" disabled={(!pending && loading) || submitting || applied <= 0} onClick={() => void submit()}>{submitting ? 'Aplicando…' : pending ? 'Comprobar aplicación anterior' : collectDifference && remaining > 0 ? 'Aplicar saldo y registrar cobro' : 'Aplicar saldo al pedido'}</button></footer>
  </Modal>
}
