import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { MessageSquare, Pencil, Printer } from 'lucide-react'
import type { OrderView } from '../../../application/shared/models'
import type { AccionAviso, LineaTiempo, PedidoAviso, PedidoDetalle } from '../../../domain/orders/pedidoEdicion.types'
import { AutoriaBadge } from '../../../components/AutoriaBadge'
import { Modal } from '../../../components/Modal'
import { pedidoEditarPath, cotizacionPath } from '../../../router/appRoute'
import { navigate } from '../../../router/history'
import { pedidoEdicionService } from '../../../infrastructure/services'
import { condicionPagoLabel } from '../../shared/FeatureShell'
import { intentoAQuery, type IntentoEdicion } from '../edicion/intento'
import { AvisosPedido } from './AvisosPedido'
import { Chip } from './Chip'
import { EstadosPedido } from './EstadosPedido'
import { ItemsPedido } from './ItemsPedido'
import { LineaTiempoPedido } from './LineaTiempoPedido'
import { bs, deltaBs, fechaHora, horaCorta } from './formato'

export type PestanaDetalle = 'items' | 'tiempo' | 'pagos' | 'documentos'
const PESTANAS: PestanaDetalle[] = ['items', 'tiempo', 'pagos', 'documentos']

/** `?tab=linea-tiempo` abre directo la línea de tiempo (lo usa la confirmación de una edición). */
export const pestanaDesdeUrl = (search: string): PestanaDetalle => {
  const tab = new URLSearchParams(search).get('tab')
  return tab === 'linea-tiempo' ? 'tiempo' : tab === 'pagos' ? 'pagos' : tab === 'documentos' ? 'documentos' : 'items'
}

const textoAccion: Record<AccionAviso, string> = {
  MANTENER_PRECIO: 'Se mantiene el precio del ítem.',
  ACEPTAR: 'Aviso aceptado.',
  RECHAZAR_SUSTITUTO: 'Sustituto rechazado.',
}

/**
 * Detalle del pedido con la edición habilitada (feature flag edicionPedido): estados,
 * avisos de Almacén, ítems con su surtido, línea de tiempo, pagos y documentos. Los bloques
 * de pagos/documentos/pie son los de siempre; llegan armados desde OrdersPage.
 */
export function DetallePedidoModal({ order, detalle, notify, onRecargar, onClose, onImprimir, pagos, documentos, pie }: {
  order: OrderView
  detalle: PedidoDetalle
  notify: (mensaje: string) => void
  onRecargar: () => Promise<void>
  onClose: () => void
  onImprimir: () => void
  pagos: ReactNode
  documentos: ReactNode
  pie: ReactNode
}) {
  const { pedido, estados, permisos, items, avisos, cuenta } = detalle
  const [pestana, setPestana] = useState<PestanaDetalle>(() => pestanaDesdeUrl(window.location.search))
  const [tiempo, setTiempo] = useState<LineaTiempo | null>(null)
  const [tiempoCargando, setTiempoCargando] = useState(true)
  const [tiempoError, setTiempoError] = useState(false)
  const [enfocarComentario, setEnfocarComentario] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [rechazando, setRechazando] = useState<PedidoAviso | null>(null)

  const cargarTiempo = useCallback(async () => {
    try { setTiempo(await pedidoEdicionService.lineaTiempo(pedido.id)); setTiempoError(false) } catch { setTiempoError(true) } finally { setTiempoCargando(false) }
  }, [pedido.id])
  // La versión del pedido cambia con cada edición / aviso resuelto: la línea de tiempo se vuelve a pedir.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y recarga cuando cambia la versión del pedido
    void cargarTiempo()
  }, [cargarTiempo, pedido.version])

  const resolver = async (aviso: PedidoAviso, accion: AccionAviso) => {
    setOcupado(true)
    try {
      await pedidoEdicionService.resolverAviso(aviso.id, accion)
      await onRecargar()
      notify(textoAccion[accion])
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo resolver el aviso')
    } finally { setOcupado(false); setRechazando(null) }
  }
  const editarDesdeAviso = (intento: IntentoEdicion) => navigate(`${pedidoEditarPath(String(pedido.id))}${intentoAQuery(intento)}`)
  const comentar = async (texto: string) => {
    try { await pedidoEdicionService.comentar(pedido.id, texto); await cargarTiempo() } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo enviar el comentario'); throw error }
  }
  const irAComentar = () => { setPestana('tiempo'); setEnfocarComentario((n) => n + 1) }

  const vigentes = items.filter((item) => item.estado === 'VIGENTE')
  const subtotal = vigentes.reduce((suma, item) => suma + item.subtotal, 0)
  const ultimos = tiempo?.eventos.slice(0, 3) ?? []

  return <Modal title={`Pedido ${pedido.numero}`} subtitle={pedido.cliente_nombre} onClose={onClose} wide className="commercial-modal product-detail-modal ped-modal">
    <div className="modal-body ped-detalle">
      <div className="ped-cabecera">
        <div className="ped-cabecera-datos">
          <p className="ped-cabecera-titulo"><strong>{pedido.numero}</strong><Chip tone="gray">Versión {pedido.version}</Chip></p>
          <p className="ped-cabecera-meta">
            <span>{pedido.cliente_nombre}</span>
            <span>{order.channel === 'mayoreo' ? 'Mayoreo' : order.channel === 'institucional' ? 'Institucional' : order.channel === 'corporativo' ? 'Corporativo' : pedido.categoria}</span>
            {pedido.condicion_pago && <span>{condicionPagoLabel[pedido.condicion_pago]}</span>}
          </p>
          <div className="autoria-row">
            <AutoriaBadge label={pedido.cotizacion_origen_id ? 'Convertido por' : 'Creado por'} email={pedido.creado_por ?? undefined} />
            {pedido.cotizacion_origen_id != null && <a className="autoria-source-link" href={cotizacionPath(String(pedido.cotizacion_origen_id))} onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(cotizacionPath(String(pedido.cotizacion_origen_id))) } }}>Ver cotización de origen{pedido.cotizacion_origen_numero ? ` (${pedido.cotizacion_origen_numero})` : ''}</a>}
          </div>
        </div>
        <div className="ped-cabecera-acciones">
          <button type="button" className="ped-btn ped-btn-suave" onClick={onImprimir}><Printer aria-hidden />Imprimir</button>
          <button type="button" className="ped-btn ped-btn-suave" onClick={irAComentar}><MessageSquare aria-hidden />Comentar</button>
          {permisos.puede_editar && <button type="button" className="ped-btn ped-btn-primario" onClick={() => navigate(pedidoEditarPath(String(pedido.id)))}><Pencil aria-hidden />Editar pedido</button>}
          {!permisos.puede_editar && permisos.motivo_no_editable && <small className="ped-nota-editar">{permisos.motivo_no_editable}</small>}
        </div>
      </div>

      <EstadosPedido estados={estados} total={pedido.total} />

      <div className="ped-pestanas" role="tablist" aria-label="Secciones del pedido">
        {PESTANAS.map((id) => <button key={id} type="button" role="tab" id={`ped-tab-${id}`} aria-selected={pestana === id} aria-controls={`ped-panel-${id}`} className={pestana === id ? 'activa' : ''} onClick={() => setPestana(id)}>
          {id === 'items' ? 'Ítems' : id === 'tiempo' ? 'Línea de tiempo' : id === 'pagos' ? 'Pagos' : 'Documentos'}
          {id === 'tiempo' && tiempo && <span className="ped-pestana-cuenta">{tiempo.eventos.length}</span>}
        </button>)}
      </div>

      <div role="tabpanel" id={`ped-panel-${pestana}`} aria-labelledby={`ped-tab-${pestana}`} className="ped-panel">
        {pestana === 'items' && <div className="ped-items-grid">
          <div className="ped-items-principal">
            <AvisosPedido avisos={avisos} items={items} ocupado={ocupado} puedeEditar={permisos.puede_editar} onResolver={(aviso, accion) => accion === 'RECHAZAR_SUSTITUTO' ? setRechazando(aviso) : void resolver(aviso, accion)} onEditar={editarDesdeAviso} />
            <ItemsPedido items={items} />
          </div>
          <aside className="ped-lateral">
            <section className="ped-tarjeta">
              <h4>Resumen</h4>
              <dl className="ped-resumen">
                <div><dt>Subtotal</dt><dd>{bs(subtotal)}</dd></div>
                <div><dt>Descuento general</dt><dd>{pedido.descuento_general > 0 ? `− ${bs(pedido.descuento_general)}` : bs(0)}</dd></div>
                <div className="ped-resumen-total"><dt>Total</dt><dd>{bs(pedido.total)}</dd></div>
              </dl>
            </section>
            <section className="ped-tarjeta ped-tarjeta-oscura">
              <h4>Cuenta del cliente</h4>
              <dl className="ped-resumen">
                <div><dt>Partida en Hermes</dt><dd>{bs(cuenta.partida_total)}</dd></div>
                <div><dt>Pagado</dt><dd>{bs(cuenta.pagado)}</dd></div>
                <div className="ped-resumen-total"><dt>Saldo</dt><dd>{bs(cuenta.saldo)}</dd></div>
              </dl>
              {cuenta.sincronizada
                ? <p className="ped-sync ped-sync-ok"><i aria-hidden />Partida al día</p>
                : <p className="ped-sync ped-sync-aviso"><i aria-hidden />Partida desfasada</p>}
            </section>
            <section className="ped-tarjeta">
              <h4>Última actividad</h4>
              {ultimos.length === 0 ? <p className="ped-nota">Sin actividad todavía.</p> : <ul className="ped-actividad">
                {ultimos.map((evento) => <li key={evento.id}>
                  <span><strong>{evento.actor}</strong> {evento.titulo}</span>
                  <small>{fechaHora(evento.creado_en)}{evento.delta_total ? ` · ${deltaBs(evento.delta_total)}` : ''}</small>
                </li>)}
              </ul>}
              <button type="button" className="ped-enlace" onClick={() => setPestana('tiempo')}>Ver todo</button>
              {ultimos[0] && <span className="ped-sr">Último movimiento a las {horaCorta(ultimos[0].creado_en)}</span>}
            </section>
          </aside>
        </div>}
        {pestana === 'tiempo' && <LineaTiempoPedido pedidoId={pedido.id} datos={tiempo} cargando={tiempoCargando} error={tiempoError} enfocarComentario={enfocarComentario} onComentar={comentar} />}
        {pestana === 'pagos' && <div className="ped-pagos">{pagos}</div>}
        {pestana === 'documentos' && <div className="ped-documentos">{documentos}</div>}
      </div>
    </div>
    {pie}
    {rechazando && <Modal title="Rechazar sustituto" subtitle={pedido.numero} onClose={() => setRechazando(null)} className="commercial-modal">
      <div className="modal-body"><p>Almacén tendrá que dejar de surtir el sustituto y el ítem volverá a quedar sin cubrir en esa parte. ¿Rechazarlo?</p></div>
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setRechazando(null)}>Cancelar</button><button type="button" className="danger-button" disabled={ocupado} onClick={() => void resolver(rechazando, 'RECHAZAR_SUSTITUTO')}>Rechazar sustituto</button></footer>
    </Modal>}
  </Modal>
}
