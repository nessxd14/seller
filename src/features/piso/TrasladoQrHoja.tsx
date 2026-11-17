import { ExternalLink, Printer } from 'lucide-react'
import type { TrasladoPiso } from '../../application/ports/pisoRepository'
import { DocQr } from '../../components/DocQr'
import { Modal } from '../../components/Modal'
import { ETIQUETA_PILDORA_QR, pildoraTrasladoPiso } from '../../domain/piso/trasladoQrPiso'
import { nombreSucursalPiso, numeroCorto } from '../../domain/sales/trasladoPiso'
import { contenidoQrTraslado } from '../../mobile/qrTraslado'

/** Enlace que abre el traslado en la app de Almacén (alistar o retirar). `null` si el id o la dirección no sirven. */
export const enlaceAlmacen = (id: string): string | null => {
  const qr = contenidoQrTraslado(id)
  return qr.ok ? qr.enlace : null
}

interface Props {
  traslado: TrasladoPiso
  imprimiendo: boolean
  onTicket: () => void
  onClose: () => void
}

/** Hoja con el QR del traslado: Almacén lo escanea para alistar; quien retira lo abre con su cuenta. */
export function TrasladoQrHoja({ traslado, imprimiendo, onTicket, onClose }: Props) {
  const qr = contenidoQrTraslado(traslado.id)
  const pildora = ETIQUETA_PILDORA_QR[pildoraTrasladoPiso(traslado)]
  return <Modal title={`Traslado ${numeroCorto(traslado.numero)}`} subtitle={`${traslado.numero} · ${nombreSucursalPiso(traslado.origenId)} → ${nombreSucursalPiso(traslado.destinoId)} · ${pildora}`} onClose={onClose} className="piso-hoja">
    <div className="modal-body piso-hoja-cuerpo traslado-qr-hoja">
      {qr.ok ? <DocQr content={qr.enlace} size={220} margin={4} /> : <p className="piso-error" role="alert">{qr.error}</p>}
      <p className="piso-hoja-sub">Almacén lo escanea para alistar. Para retirarlo, ábrelo tú en Almacén con tu cuenta.</p>
    </div>
    <footer className="modal-actions piso-salir-acciones">
      {qr.ok && <a className="piso-enviar traslado-enlace" href={qr.enlace} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Abrir en Almacén para retirar</a>}
      <button type="button" className="piso-secundario" disabled={imprimiendo} onClick={onTicket}><Printer aria-hidden="true" /> Imprimir ticket</button>
      <button type="button" className="piso-texto-boton" onClick={onClose}>Cerrar</button>
    </footer>
  </Modal>
}
