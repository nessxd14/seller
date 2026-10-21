import { DocQr } from './DocQr'
import { qrContentForTraslado } from '../domain/documents/qrContent'

export function TrasladoQr({ id, numero }: { id: string; numero: string }) {
  const enlace = qrContentForTraslado(id)
  return <section className="traslado-qr" aria-label={`QR del traslado ${numero}`}>
    <h3>QR de {numero}</h3>
    <DocQr content={enlace} size={230} margin={4} />
    <p>Almacén alista; otra persona confirma al recibir el material. Usa el mismo QR en ambos pasos.</p>
    <a className="secondary-button" href={enlace} target="_blank" rel="noreferrer">Abrir alistado y recepción</a>
  </section>
}
