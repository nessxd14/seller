import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { buscarClientesSimilares, reactivarCliente, type ClienteSimilar } from '../infrastructure/supabase/CustomerSimilarity.supabase'
import { consultarSaldosSimilares, type SaldoSimilar } from '../infrastructure/hermes/client'
import { formatMoney, money } from '../domain/common/money'

const tipoPrecioLabel: Record<string, string> = {
  retail: 'Retail',
  mayorista: 'Mayorista',
  corporativo: 'Corporativo',
  institucion: 'Institución / Gobierno',
}

const motivoLabel: Record<ClienteSimilar['motivo'], string> = {
  DOCUMENTO: 'Mismo documento',
  NOMBRE: 'Nombre parecido',
  RAZON_SOCIAL: 'Razón social parecida',
}

/**
 * Brief T2 Tarea 2 — panel de "cliente parecido". Se muestra encima del botón de
 * guardar (nunca un toast: tiene que verse sí o sí antes de confirmar el alta) mientras
 * se escribe el nombre o el documento, con debounce de ~400ms. No bloquea nada por sí
 * mismo — el formulario que lo usa decide si pide confirmación extra según
 * `onCandidatesChange` (ver src/domain/customers/duplicateWarning.ts).
 */
export function DuplicateCustomerPanel({ nombre, documento, excluirId, onUseCustomer, onCandidatesChange }: {
  nombre: string
  documento: string
  excluirId?: number
  onUseCustomer: (candidate: ClienteSimilar) => void
  onCandidatesChange?: (candidates: ClienteSimilar[]) => void
}) {
  const [candidatos, setCandidatos] = useState<ClienteSimilar[]>([])
  const [saldos, setSaldos] = useState<Map<number, SaldoSimilar> | null | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [reactivandoId, setReactivandoId] = useState<number | null>(null)

  useEffect(() => {
    const nombreTrim = nombre.trim()
    if (nombreTrim.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia candidatos previos apenas el nombre queda demasiado corto para buscar; no hay operación async que lo haga por nosotros en este caso
      setCandidatos([])
      onCandidatesChange?.([])
      return
    }
    let cancelado = false
    const handle = setTimeout(() => {
      void buscarClientesSimilares(nombreTrim, documento, excluirId)
        .then((result) => {
          if (cancelado) return
          setCandidatos(result)
          onCandidatesChange?.(result)
          if (result.length) {
            setSaldos(undefined)
            void consultarSaldosSimilares(result.map((c) => c.id)).then((mapa) => { if (!cancelado) setSaldos(mapa) })
          } else {
            setSaldos(undefined)
          }
        })
        .catch(() => { if (!cancelado) { setCandidatos([]); onCandidatesChange?.([]) } })
    }, 400)
    return () => { cancelado = true; clearTimeout(handle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCandidatesChange es un callback del padre, no un dato que deba disparar una nueva búsqueda
  }, [nombre, documento, excluirId])

  const reactivarYUsar = async (candidate: ClienteSimilar) => {
    setReactivandoId(candidate.id)
    try {
      await reactivarCliente(candidate.id, 'pos')
      onUseCustomer({ ...candidate, activo: true })
    } finally {
      setReactivandoId(null)
    }
  }

  if (!candidatos.length) return null

  return (
    <div className="duplicate-customer-panel">
      <p className="duplicate-customer-panel-title"><AlertTriangle size={13} /> Se encontraron clientes parecidos</p>
      {candidatos.map((c) => {
        const saldo = saldos?.get(c.id)
        const expanded = expandedId === c.id
        return (
          <div key={c.id} className="duplicate-customer-card">
            <div className="duplicate-customer-main">
              <div className="duplicate-customer-info">
                <strong>{c.nombre}</strong>
                {!c.activo && <span className="duplicate-customer-badge-inactivo">Inactivo</span>}
                <small>
                  {[c.razonSocial, c.documento || 'Sin documento', tipoPrecioLabel[c.tipoPrecio] ?? c.tipoPrecio, motivoLabel[c.motivo]].filter(Boolean).join(' · ')}
                </small>
                <small className="duplicate-customer-saldo">
                  {saldos === undefined ? 'Consultando saldo en Hermes…'
                    : saldo === null || saldos === null ? 'Saldo en Hermes: no disponible'
                    : saldo ? `Saldo en Hermes: ${formatMoney(money(Math.round(saldo.saldoConfirmado * 100)))}${saldo.partidasAbiertas ? ` · ${saldo.partidasAbiertas} partida${saldo.partidasAbiertas === 1 ? '' : 's'} abierta${saldo.partidasAbiertas === 1 ? '' : 's'}` : ''}`
                    : 'Sin cuenta en Hermes'}
                </small>
              </div>
              <div className="duplicate-customer-actions">
                {c.activo
                  ? <button type="button" className="secondary-button" onClick={() => onUseCustomer(c)}>Usar este cliente</button>
                  : <button type="button" className="secondary-button" disabled={reactivandoId === c.id} onClick={() => void reactivarYUsar(c)}>{reactivandoId === c.id ? 'Reactivando…' : 'Reactivar y usar'}</button>}
                <button type="button" className="duplicate-customer-detail-toggle" onClick={() => setExpandedId(expanded ? null : c.id)}>
                  Ver detalle {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>
            </div>
            {expanded && (
              <div className="duplicate-customer-detail">
                <span>ID interno: {c.id}</span>
                <span>Similitud: {(c.similitud * 100).toFixed(0)}%</span>
                {saldo && <span>Confirmado: {formatMoney(money(Math.round(saldo.saldoConfirmado * 100)))} · Provisional: {formatMoney(money(Math.round(saldo.saldoProvisional * 100)))}</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
