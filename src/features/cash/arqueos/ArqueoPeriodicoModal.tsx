import { useState } from 'react'
import { CajonEnCeroCheck } from '../../../components/CajonEnCeroCheck'
import { DenominationCount, denominacionesLimpias, denominacionesTotal } from '../../../components/DenominationCount'
import { Modal } from '../../../components/Modal'
import type { Denominaciones } from '../../../application/shared/models'

export const MENSAJE_SIN_ARQUEO_PENDIENTE = 'No tienes un arqueo pendiente en este momento'

export interface ArqueoPeriodicoModalProps {
  numero: number
  total: number
  fueraDeHora: boolean
  registrar: (denominaciones: Denominaciones) => Promise<{ numero: number; estado: 'CUMPLIDO' | 'CUMPLIDO_TARDE' }>
  /** Refresca el estado del hook (se llama también cuando la base dice que ya no hay arqueo pendiente). */
  refrescar: () => Promise<void>
  notify: (message: string) => void
  onClose: () => void
}

/**
 * Conteo ciego: cuenta TODO el cajón por billetes y monedas. Nunca muestra ni pide el esperado
 * ni la diferencia — la base no se los manda al cajero.
 */
export function ArqueoPeriodicoModal({ numero, total, fueraDeHora, registrar, refrescar, notify, onClose }: ArqueoPeriodicoModalProps) {
  const [contado, setContado] = useState<Denominaciones>({})
  const [cajonEnCero, setCajonEnCero] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const totalContado = denominacionesTotal(contado)
  const falta = totalContado === 0 && !cajonEnCero

  const confirmar = async () => {
    if (enviando || falta) return
    setEnviando(true)
    setError('')
    try {
      const r = await registrar(denominacionesLimpias(contado))
      notify(`Arqueo ${r.numero} registrado${r.estado === 'CUMPLIDO_TARDE' ? ' · fuera de hora' : ''}`)
      onClose()
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : ''
      if (mensaje.includes(MENSAJE_SIN_ARQUEO_PENDIENTE)) { await refrescar(); onClose(); return }
      setError(mensaje || 'No se pudo registrar el arqueo')
      setEnviando(false)
    }
  }

  return <Modal
    className="cash-dialog cierre-dialog"
    title={`Arqueo ${numero} de ${total}`}
    subtitle={<>Cuenta todo el efectivo del cajón, billete por billete.{fueraDeHora && <> <span className="arqueo-badge-tarde">Fuera de hora — igual queda registrado.</span></>}</>}
    onClose={onClose}
    escapeToClose={!enviando}
    wide
  >
    <div className="modal-body arqueo-modal">
      <header className="arqueo-conteo-cabecera"><h3>Cuenta todo el efectivo del cajón</h3><p>Ingresa la cantidad de cada denominación.</p></header>
      <DenominationCount value={contado} onChange={setContado} disabled={enviando} />
      {totalContado === 0 && <CajonEnCeroCheck checked={cajonEnCero} onChange={setCajonEnCero} disabled={enviando} />}
      {error && <p role="alert" className="cash-error">{error}</p>}
    </div>
    <footer className="modal-actions">
      {/* Es el conteo del propio cajero, no el esperado: no rompe el conteo ciego. */}
      <div className="arqueo-modal-total" aria-live="polite"><span>Total contado</span><strong>Bs {totalContado.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      <button type="button" className="secondary-button" onClick={onClose}>Más tarde</button>
      <button type="button" className="primary-button" disabled={enviando || falta} onClick={() => void confirmar()}>{enviando ? 'Registrando…' : 'Registrar arqueo'}</button>
    </footer>
  </Modal>
}
