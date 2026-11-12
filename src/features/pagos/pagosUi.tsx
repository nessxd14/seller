import { InfoHint } from '../../components/InfoHint'
import { formatMoney, moneyFromDecimal } from '../../domain/common/money'
import { estadoPagoLabel, tipoPagoAyuda, tipoPagoLabel, type EstadoPago, type FilaPago, type TipoPago } from '../../domain/pagos/historialPagos'
import { textoMotivoAnticipo } from '../../domain/pagos/historialPagos'

export const bs = (value: number): string => formatMoney(moneyFromDecimal(value))

export function TipoBadge({ tipo, conAyuda = false }: { tipo: TipoPago; conAyuda?: boolean }) {
  return <span className="pagos-tipo-wrap"><span className={`pagos-tipo pagos-tipo-${tipo.toLowerCase()}`}>{tipoPagoLabel[tipo]}</span>{conAyuda && <InfoHint title={tipoPagoLabel[tipo]} text={tipoPagoAyuda[tipo]} />}</span>
}

export function EstadoPunto({ estado }: { estado: EstadoPago }) {
  return <span className={`pagos-estado pagos-estado-${estado.toLowerCase()}`}><i aria-hidden="true" />{estadoPagoLabel[estado]}</span>
}

/** Segunda línea de «Se aplicó a»: lo que quedó a favor, el motivo del anticipo o el saldo usado. */
export function notaAplicacion(fila: FilaPago): string | null {
  if (fila.tipo === 'SALDO') return `Usó ${bs(fila.usado)} a favor`
  if (fila.tipo === 'ANTICIPO') return textoMotivoAnticipo(fila)
  if (fila.aFavor > 0) return `${bs(fila.aFavor)} quedó a favor`
  return null
}
