import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, HandCoins, XCircle } from 'lucide-react'
import { etiquetasCobro, type CobroPedido } from '../domain/orders/cobroPedido'
import { formatMoney, money } from '../domain/common/money'

export function CobroPedidoBadge({ cobro }: { cobro: CobroPedido | null }) {
  if (!cobro) return <span className="order-payment-cell"><span className="order-payment-badge loading"><CircleDashed size={13} />Consultando cobro…</span></span>
  const { estado } = cobro
  const saldadas = cobro.partidasSaldadas ?? (estado === 'pagado' ? cobro.partidas : null)
  const Icon = estado === 'pagado' || estado === 'sin_pendiente' ? CheckCircle2 : estado === 'por_verificar' ? Clock3 : estado === 'parcial' ? HandCoins : estado === 'cancelado' ? XCircle : estado === 'revisar' ? AlertTriangle : CircleDashed
  return <span className="order-payment-cell">
    <span className={`order-payment-badge ${estado}`}><Icon size={13} />{etiquetasCobro[estado]}</span>
    {estado === 'pagado' && <small>Saldo {formatMoney(money(0))}</small>}
    {saldadas !== null && cobro.partidas > 0 && <small>{saldadas} de {cobro.partidas} partidas saldadas</small>}
    {(estado === 'parcial' || estado === 'pendiente') && <small>Pendiente {formatMoney(money(cobro.porCobrarCents))}</small>}
    {estado === 'por_verificar' && <><small>{formatMoney(money(cobro.enRevisionCents))} en revisión</small>{cobro.porCobrarCents > 0 && <small>Pendiente {formatMoney(money(cobro.porCobrarCents))}</small>}</>}
    {estado === 'revisar' && <small>Consultar partidas y resolución</small>}
    {estado === 'cancelado' && <small>Consultar historial del pedido</small>}
    {estado === 'no_aplica' && <small>Sin cuenta corriente</small>}
  </span>
}

export function ResumenCobroPedido({ cobro }: { cobro: CobroPedido | null }) {
  const hasAmounts = cobro && ['pagado', 'parcial', 'pendiente', 'por_verificar', 'sin_pendiente'].includes(cobro.estado)
  let note = 'Los pagos por verificar aún no están confirmados. Un saldo a favor o un pago sin asignar debe aplicarse al pedido antes de considerarlo saldado.'
  if (!cobro) note = 'Consultando las partidas de este pedido.'
  else if (cobro.estado === 'pagado') note = 'Todas las partidas vigentes de este pedido están saldadas. La entrega se consulta en el estado del pedido.'
  else if (cobro.estado === 'no_disponible') note = 'No se pudo consultar el cobro. Actualiza los cobros antes de decidir el importe a recibir.'
  else if (cobro.estado === 'sin_partida') note = 'Este pedido no tiene partidas vigentes vinculadas. Revisa su cuenta en Conciliador.'
  else if (cobro.estado === 'revisar') note = 'Revisa las partidas y la resolución de cancelación o diferencias en Conciliador.'
  else if (cobro.estado === 'cancelado') note = 'El pedido está cancelado. Consulta su historial para conocer el destino del dinero recibido.'
  else if (cobro.estado === 'no_aplica') note = 'Este documento se consulta en Caja; no tiene cuenta corriente en Conciliador.'
  return <section className="order-payment-detail" aria-label="Cobro del pedido">
    <div><h3>Cobro del pedido</h3><CobroPedidoBadge cobro={cobro} /></div>
    {hasAmounts && <dl>
      <div><dt>Aplicado confirmado</dt><dd>{formatMoney(money(cobro.aplicadoCents))}</dd></div>
      <div><dt>Por verificar</dt><dd>{formatMoney(money(cobro.enRevisionCents))}</dd></div>
      <div><dt>Por cubrir en este pedido</dt><dd>{formatMoney(money(cobro.porCobrarCents))}</dd></div>
    </dl>}
    <p>{note}</p>
  </section>
}
