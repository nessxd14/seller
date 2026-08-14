import { useEffect, useState } from 'react'
import { calcularRepartoFifo, HermesHttpError, type FilaReparto } from '../infrastructure/hermes/client'
import { validarReparto, type FilaRepartoEditable } from '../domain/hermes/repartoPago'
import { formatMoney, moneyFromDecimal } from '../domain/common/money'
import { NumberField } from './NumberField'
import { FeatureState } from '../features/shared/FeatureShell'

/**
 * Brief T4 Tarea 2: cuando el cobro no corresponde a un solo pedido (tipo "total" en
 * PagoModal), esto propone el reparto FIFO sobre las partidas abiertas del cliente y deja
 * editar los montos por fila antes de guardar. Tarea 3: la columna de identificación es
 * `referencia` (PED-2026-XXXXX) — nunca partidaId.
 *
 * Puramente de preview/edición: no llama a imputar_pago — eso lo hace el padre
 * (PagoModal.confirm) una vez que el pago ya existe en Hermes con un pago_id real.
 */
export function RepartoPagoPanel({ clienteId, monto, onFilasChange }: {
  clienteId: number
  monto: number
  onFilasChange: (filas: FilaRepartoEditable[], error: string | null) => void
}) {
  const [filas, setFilas] = useState<FilaRepartoEditable[] | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    if (!clienteId || monto <= 0) { setFilas(null); setStatus('ready'); return }
    let cancelled = false
    setStatus('loading')
    const handle = setTimeout(() => {
      void calcularRepartoFifo(clienteId, monto)
        .then((propuesta: FilaReparto[]) => {
          if (cancelled) return
          setFilas(propuesta.map((f) => ({ partidaId: f.partidaId, referencia: f.referencia, pendiente: f.pendiente, aplica: f.aplica })))
          setStatus('ready')
        })
        .catch((err) => {
          if (cancelled) return
          setFetchError(err instanceof HermesHttpError ? err.message : 'No se pudo calcular el reparto')
          setStatus('error')
        })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [clienteId, monto])

  useEffect(() => {
    if (!filas) { onFilasChange([], null); return }
    onFilasChange(filas, validarReparto(monto, filas))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFilasChange se recrea cada render en el padre; lo que importa es cuándo cambian filas/monto
  }, [filas, monto])

  const updateAplica = (partidaId: number, aplica: number) =>
    setFilas((prev) => prev?.map((f) => (f.partidaId === partidaId ? { ...f, aplica } : f)) ?? prev)

  if (status === 'loading') return <div className="full reparto-pago-panel"><FeatureState type="loading" text="Calculando reparto FIFO" rows={2} /></div>
  if (status === 'error') return <div className="full reparto-pago-panel"><p className="mock-note payment-error">{fetchError}</p></div>
  if (!filas || !filas.length) return null

  const error = validarReparto(monto, filas)
  const suma = filas.reduce((sum, f) => sum + f.aplica, 0)
  const excedente = Math.max(0, monto - suma)

  return (
    <div className="full reparto-pago-panel">
      <span className="field-label">Reparto propuesto (FIFO — editable)</span>
      <div className="feature-table reparto-pago-table">
        <div className="table-head"><span>Partida</span><span>Pendiente</span><span>Aplica</span><span>Restante</span></div>
        {filas.map((fila) => (
          <article key={fila.partidaId}>
            <strong className="doc-number-cell">{fila.referencia}</strong>
            <span>{formatMoney(moneyFromDecimal(fila.pendiente))}</span>
            <NumberField ariaLabel={`Monto a aplicar a ${fila.referencia}`} min={0} max={fila.pendiente} step={0.01} value={fila.aplica} onCommit={(v) => updateAplica(fila.partidaId, v)} />
            <span>{formatMoney(moneyFromDecimal(Math.max(0, fila.pendiente - fila.aplica)))}</span>
          </article>
        ))}
      </div>
      {error
        ? <p className="mock-note payment-error">{error}</p>
        : excedente > 0
          ? <p className="mock-note">{formatMoney(moneyFromDecimal(excedente))} quedarán como anticipo a favor del cliente.</p>
          : null}
    </div>
  )
}
