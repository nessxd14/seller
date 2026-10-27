import { Ban } from 'lucide-react'
import { useState } from 'react'
import { anulacionService } from '../../infrastructure/services'
import type { AnulacionSolicitud } from '../../application/shared/models'
import { badgeDevolucion, explicarDevolucion, MOTIVO_ANULACION_MIN, mensajeAnulacion } from '../../domain/sales/anulacion'
import { VentaDetalleModal } from './VentaDetalleModal'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaCorta = (iso: string) => new Date(iso).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
const quien = (email?: string) => (email ? email.split('@')[0] : '—')
const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

const ESTADO_CHIP: Record<AnulacionSolicitud['estado'], string> = { SOLICITADA: 'Pendiente', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada', RETIRADA: 'Retirada' }

/**
 * Bandeja de revisión (solo Ness / gerente, dentro de Supervisión). Los datos los carga el panel con su
 * propio ciclo de refresco (useCashRefresh); aquí solo se resuelve y se avisa con `onResolved`.
 */
export function SolicitudesAnulacionBandeja({ pendientes, resueltas, notify, onResolved }: { pendientes: AnulacionSolicitud[]; resueltas: AnulacionSolicitud[]; notify: (message: string) => void; onResolved: () => void }) {
  const [detalleVentaId, setDetalleVentaId] = useState<string | null>(null)
  return <section id="bandeja-anulaciones" className="cash-movements bandeja-aprobacion bandeja-anulaciones" aria-labelledby="bandeja-anulaciones-titulo">
    <header>
      <h3 id="bandeja-anulaciones-titulo"><Ban aria-hidden="true" /> Solicitudes de anulación <span className="anulacion-contador" aria-label={`${pendientes.length} pendientes`}>{pendientes.length}</span></h3>
      <p>Tickets que un cajero pide anular. Al aprobar se anula la venta y se devuelve el dinero según el turno del cobro.</p>
    </header>
    {pendientes.length
      ? pendientes.map((s) => <SolicitudRevisionRow key={s.id} solicitud={s} notify={notify} onResolved={onResolved} onVerProductos={() => setDetalleVentaId(s.ventaId)} />)
      : <p className="anulacion-vacia" role="status">Sin solicitudes por revisar</p>}
    {resueltas.length > 0 && <details className="anulacion-resueltas">
      <summary>Resueltas recientes ({resueltas.length})</summary>
      <ul>
        {resueltas.map((s) => <li key={s.id}>
          <span><strong>{s.numero ?? `Venta ${s.ventaId}`}</strong> · Bs {bs(s.total)} · <em className={`anulacion-chip ${s.estado.toLowerCase()}`}>{ESTADO_CHIP[s.estado]}</em></span>
          <small>{quien(s.solicitadaPor)} · {s.resueltaPor ? `resuelta por ${quien(s.resueltaPor)}` : ''}{s.resueltaEn ? ` · ${fechaCorta(s.resueltaEn)}` : ''}{s.notaResolucion ? ` · ${s.notaResolucion}` : ''}</small>
        </li>)}
      </ul>
    </details>}
    {detalleVentaId && <VentaDetalleModal key={detalleVentaId} id={detalleVentaId} notify={notify} onChanged={onResolved} onClose={() => setDetalleVentaId(null)} />}
  </section>
}

function SolicitudRevisionRow({ solicitud: s, notify, onResolved, onVerProductos }: { solicitud: AnulacionSolicitud; notify: (message: string) => void; onResolved: () => void; onVerProductos: () => void }) {
  const [modo, setModo] = useState<'aprobar' | 'rechazar' | null>(null)
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const badge = badgeDevolucion(s)
  const notaValida = modo === 'aprobar' || nota.trim().length >= MOTIVO_ANULACION_MIN

  const cerrar = () => { setModo(null); setNota(''); setError('') }
  const confirmar = async () => {
    if (!modo || busy || !notaValida) return
    setBusy(true)
    setError('')
    try {
      if (modo === 'aprobar') {
        const resultado = await anulacionService.aprobar(s.id, nota.trim() || undefined)
        notify(mensajeAnulacion(s.numero, { tipo: 'anulada', resultado }))
      } else {
        await anulacionService.rechazar(s.id, nota.trim())
        notify(`Solicitud de ${s.numero ?? `venta ${s.ventaId}`} rechazada`)
      }
      onResolved()
    } catch (err) {
      setError(errorMessage(err, 'No se pudo resolver la solicitud'))
      setBusy(false)
    }
  }

  return <article className="aprobacion-row anulacion" aria-label={`Solicitud de anulación ${s.numero ?? s.ventaId}`}>
    <div className="aprobacion-row-main">
      <div className="aprobacion-row-text">
        <strong>{s.numero ?? `Venta ${s.ventaId}`} · {s.cliente ?? 'Cliente de mostrador'}</strong>
        <small>Pidió {quien(s.solicitadaPor)} · {fechaCorta(s.solicitadaEn)}</small>
        <p className="anulacion-motivo">“{s.motivo}”</p>
        <span className={`anulacion-badge ${badge.tipo}`}>{badge.texto}</span>
      </div>
      <div className="aprobacion-monto"><b>Bs {bs(s.total)}</b><small>Cobrado Bs {bs(s.cobrado)}</small></div>
    </div>
    {modo
      ? <div className="aprobacion-row-form">
        {modo === 'aprobar' && <p className="anular-venta-refund" role="note">{explicarDevolucion(s, true)}</p>}
        <label>{modo === 'aprobar' ? 'Nota (opcional)' : 'Motivo del rechazo (obligatorio)'}
          <input type="text" maxLength={300} value={nota} disabled={busy} autoFocus onChange={(e) => setNota(e.target.value)} placeholder={modo === 'aprobar' ? 'Comentario para el cajero' : 'Por qué no se anula'} />
        </label>
        {error && <p role="alert" className="cash-error">{error}</p>}
        <div className="aprobacion-row-actions">
          <button type="button" disabled={busy} onClick={cerrar}>Cancelar</button>
          <button type="button" className={modo === 'aprobar' ? 'primary-button' : 'aprobacion-rechazar'} disabled={busy || !notaValida} onClick={() => void confirmar()}>{modo === 'aprobar' ? 'Confirmar anulación' : 'Confirmar rechazo'}</button>
        </div>
      </div>
      : <div className="aprobacion-row-actions">
        <button type="button" onClick={onVerProductos}>Ver productos</button>
        <button type="button" onClick={() => setModo('rechazar')}>Rechazar</button>
        <button type="button" className="primary-button" onClick={() => setModo('aprobar')}>Aprobar</button>
      </div>}
  </article>
}

/** "Mis solicitudes de anulación" del cajero: estado de cada pedido y retiro de los pendientes. Oculto si no hay ninguna. */
export function MisSolicitudesAnulacion({ solicitudes, notify, onChanged }: { solicitudes: AnulacionSolicitud[]; notify: (message: string) => void; onChanged: () => void }) {
  const [retirandoId, setRetirandoId] = useState<string | null>(null)
  if (!solicitudes.length) return null
  const retirar = async (s: AnulacionSolicitud) => {
    if (retirandoId) return
    setRetirandoId(s.id)
    try {
      await anulacionService.retirar(s.id)
      notify('Solicitud de anulación retirada')
      onChanged()
    } catch (err) {
      notify(errorMessage(err, 'No se pudo retirar la solicitud'))
    } finally {
      setRetirandoId(null)
    }
  }
  return <section className="cash-movements mis-anulaciones" aria-labelledby="mis-anulaciones-titulo">
    <header><h3 id="mis-anulaciones-titulo"><Ban aria-hidden="true" /> Mis solicitudes de anulación</h3></header>
    <ul>
      {solicitudes.map((s) => <li key={s.id}>
        <span><strong>{s.numero ?? `Venta ${s.ventaId}`}</strong> · Bs {bs(s.total)} · <em className={`anulacion-chip ${s.estado.toLowerCase()}`}>{ESTADO_CHIP[s.estado]}</em></span>
        <small>{fechaCorta(s.solicitadaEn)} · “{s.motivo}”{s.estado === 'RECHAZADA' && s.notaResolucion ? ` · Rechazo: ${s.notaResolucion}` : ''}{s.estado === 'APROBADA' && s.notaResolucion ? ` · ${s.notaResolucion}` : ''}</small>
        {s.estado === 'SOLICITADA' && <button type="button" className="aprobacion-link" disabled={retirandoId === s.id} onClick={() => void retirar(s)}>Retirar</button>}
      </li>)}
    </ul>
  </section>
}
