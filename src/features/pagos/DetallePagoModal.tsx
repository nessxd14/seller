import { Modal } from '../../components/Modal'
import { estadoPagoLabel, fechaHoraPago, medioPagoLabel, montoRecibido, type FilaPago } from '../../domain/pagos/historialPagos'
import { bs, EstadoPunto, TipoBadge } from './pagosUi'

const cuando = (iso: string | null): string => {
  if (!iso) return ''
  const { fecha, hora } = fechaHoraPago(iso)
  return fecha ? `${fecha} ${hora}` : ''
}

/** Detalle de un pago a partir de la fila ya cargada (sin otra consulta). Solo lectura. */
export function DetallePagoModal({ fila, onClose, onVerHistorial }: { fila: FilaPago; onClose: () => void; onVerHistorial?: (clienteId: number, nombre: string) => void }) {
  const esSaldo = fila.clase === 'SALDO'
  const anulado = fila.estado === 'ANULADO'
  const porVerificar = fila.estado === 'POR_VERIFICAR'
  const totalAplicado = fila.aplicaciones.reduce((s, a) => s + a.monto, 0)
  return <Modal title="Detalle del pago" subtitle={`${fila.cliente} · ${cuando(fila.fecha)}`} onClose={onClose} wide className="pagos-detalle-modal">
    <div className="modal-body pagos-detalle">
      <div className="pagos-detalle-cabecera">
        <strong className={`pagos-detalle-monto ${esSaldo ? 'es-cero' : ''}`}>{bs(montoRecibido(fila))}</strong>
        <TipoBadge tipo={fila.tipo} conAyuda />
        <EstadoPunto estado={fila.estado} />
      </div>
      {esSaldo && <p className="pagos-nota">No entró dinero: se usó {bs(fila.usado)} del saldo a favor que el cliente ya tenía.</p>}

      <dl className="pagos-detalle-datos">
        <div><dt>Medio</dt><dd>{fila.medio ? medioPagoLabel[fila.medio] : '—'}</dd></div>
        <div><dt>Referencia</dt><dd>{fila.referencia ?? '—'}</dd></div>
        <div><dt>Cliente</dt><dd>{fila.clienteId != null && onVerHistorial
          ? <button type="button" className="pagos-link" onClick={() => onVerHistorial(fila.clienteId!, fila.cliente)}>{fila.cliente}</button>
          : fila.cliente}</dd></div>
        <div><dt>Caja</dt><dd>{fila.turnoDe ? `Turno de ${fila.turnoDe}` : '—'}</dd></div>
      </dl>

      {!esSaldo && <section aria-label="Recorrido">
        <h3 className="pagos-subtitulo">Recorrido</h3>
        <ol className="pagos-recorrido">
          <li className={`hecho ${anulado ? 'tachado' : ''}`}><i aria-hidden="true" /><span><strong>Registrado en caja</strong><small>{[cuando(fila.fecha), fila.registradoPor].filter(Boolean).join(' · ')}</small></span></li>
          <li className={anulado ? 'tachado' : porVerificar ? 'pendiente' : 'hecho'}><i aria-hidden="true" />
            <span><strong>{porVerificar ? 'Confirmación del gerente pendiente' : 'Confirmado por el gerente'}</strong>
              <small>{porVerificar ? 'Aún no figura como dinero recibido' : anulado ? estadoPagoLabel.ANULADO : [cuando(fila.confirmadoEn), fila.confirmadoPor].filter(Boolean).join(' · ')}</small></span></li>
        </ol>
      </section>}

      <section aria-label="Se aplicó a">
        <h3 className="pagos-subtitulo">{esSaldo ? 'Pedidos pagados con saldo a favor' : 'Se aplicó a'}</h3>
        {fila.aplicaciones.length === 0 && fila.aFavor <= 0
          ? <p className="pagos-nota">{fila.tipo === 'ANTICIPO' ? 'No se aplicó a ningún pedido.' : 'Sin aplicaciones registradas.'}</p>
          : <table className="pagos-mini-tabla">
            <thead><tr><th>Pedido</th><th className="num">Monto</th></tr></thead>
            <tbody>
              {fila.aplicaciones.map((a, i) => <tr key={`${a.pedidoId ?? 'x'}-${i}`}><td>{a.referencia ?? (a.pedidoId != null ? `Pedido ${a.pedidoId}` : 'Saldo anterior')}</td><td className="num">{bs(a.monto)}</td></tr>)}
              {!esSaldo && fila.aplicaciones.length > 0 && <tr className="subtotal"><td>Total aplicado a pedidos</td><td className="num">{bs(totalAplicado)}</td></tr>}
              {fila.aFavor > 0 && <tr className="total"><td>Quedó a favor del cliente</td><td className="num">{bs(fila.aFavor)}</td></tr>}
            </tbody>
          </table>}
      </section>

      <p className="pagos-nota pagos-solo-lectura">Vista de consulta. Para corregir o anular un pago, pídeselo al gerente.</p>
    </div>
    <footer className="modal-actions">
      {fila.clienteId != null && onVerHistorial && <button type="button" className="secondary-button" onClick={() => onVerHistorial(fila.clienteId!, fila.cliente)}>Historial del cliente</button>}
      <button type="button" className="primary-button" onClick={onClose}>Cerrar</button>
    </footer>
  </Modal>
}
