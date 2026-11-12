import { useMemo, useState } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { readDefaultDocPrintFormat, type DocPrintFormat } from '../../components/docPrintFormat'
import {
  fechaHoraPago, medioPagoLabel, montoRecibido, rangoPorDefectoHistorial, rangoValido, fechaIsoCorta, type FilaPago,
} from '../../domain/pagos/historialPagos'
import { FeatureState } from '../shared/FeatureShell'
import { DetallePagoModal } from './DetallePagoModal'
import { HistorialPagosImpresion } from './HistorialPagosImpresion'
import { bs, EstadoPunto, notaAplicacion, TipoBadge } from './pagosUi'
import { useHistorialPagos } from './useHistorialPagos'
import type { ClientePagos } from './PagosPage'

const categoriaLabel: Record<string, string> = { retail: 'Minorista', mayorista: 'Mayorista', wholesale: 'Mayorista', institucional: 'Institucional', institutional: 'Institucional', corporativo: 'Corporativo', corporate: 'Corporativo' }

/** Historial de pagos de un cliente: resumen del período, lista e impresión (solo lectura). */
export function HistorialClientePage({ cliente, onVolver }: { cliente: ClientePagos; onVolver: () => void }) {
  const [rango, setRango] = useState(() => rangoPorDefectoHistorial())
  const [detalle, setDetalle] = useState<FilaPago | null>(null)
  const [formato, setFormato] = useState<DocPrintFormat>(readDefaultDocPrintFormat)
  const [imprimiendo, setImprimiendo] = useState(false)
  const errorRango = rangoValido(rango.desde, rango.hasta)
  const params = useMemo(() => errorRango ? null : { desde: rango.desde, hasta: rango.hasta, clienteId: cliente.id }, [errorRango, rango.desde, rango.hasta, cliente.id])
  const lista = useHistorialPagos(params)
  const info = lista.cliente
  const sinCuenta = info?.sinCuenta === true
  const periodo = info?.periodo
  const nombre = info?.nombre ?? cliente.nombre

  return <main className="feature-page pagos-page pagos-historial">
    <button type="button" className="pagos-volver" onClick={onVolver}><ArrowLeft aria-hidden="true" /> Volver a Pagos</button>
    <header className="feature-header">
      <div><span>HISTORIAL DE PAGOS</span><h1>{nombre}</h1>
        <p className="pagos-cliente-meta">
          {info?.categoria && <span className="pagos-categoria">{categoriaLabel[info.categoria] ?? info.categoria}</span>}
          {info?.documento && <span>NIT: {info.documento}</span>}
        </p></div>
      <div className="pagos-filtros pagos-filtros-historial">
        <label>Desde<input type="date" value={rango.desde} max={rango.hasta || undefined} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))} /></label>
        <label>Hasta<input type="date" value={rango.hasta} min={rango.desde || undefined} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))} /></label>
      </div>
    </header>
    {errorRango && <p role="alert" className="pagos-error">{errorRango}</p>}

    {periodo && <div className="pagos-tiles" aria-label="Resumen del período">
      <div className="pagos-tile"><span>Dinero recibido</span><strong>{bs(periodo.recibido)}</strong><small>{periodo.pagos} {periodo.pagos === 1 ? 'pago' : 'pagos'} en el período</small></div>
      <div className="pagos-tile"><span>Aplicado a pedidos</span><strong>{bs(periodo.aplicadoPedidos)}</strong>{periodo.conSaldo > 0 && <small>Incluye {bs(periodo.conSaldo)} del saldo a favor</small>}</div>
      <div className="pagos-tile pagos-tile-favor"><span>Saldo a favor hoy</span><strong>{bs(info?.aFavorHoy ?? 0)}</strong></div>
      <div className="pagos-tile"><span>Pendiente hoy</span><strong>{bs(info?.pendienteHoy ?? 0)}</strong></div>
    </div>}

    {sinCuenta ? <FeatureState type="empty" text="Este cliente todavía no tiene pagos registrados" />
      : lista.sinAcceso ? <FeatureState type="error" text="Sin acceso a los pagos" />
        : lista.error ? <><FeatureState type="error" text={lista.error} /><button type="button" className="secondary-button" onClick={lista.reintentar}>Reintentar</button></>
          : !params ? null
            : lista.cargando ? <FeatureState type="skeleton" text="Cargando historial" />
              : lista.filas.length === 0 ? <FeatureState type="no-results" text="Sin movimientos en este período" />
                : <>
                  <ul className="pagos-historial-lista">{lista.filas.map(f => <MovimientoItem key={f.clave} fila={f} onVer={() => setDetalle(f)} />)}</ul>
                  {lista.errorMas && <p role="alert" className="pagos-error">{lista.errorMas}</p>}
                  {lista.hayMas && <button type="button" className="secondary-button pagos-mas" disabled={lista.cargandoMas} onClick={() => void lista.cargarMas()}>{lista.cargandoMas ? 'Cargando…' : 'Cargar más'}</button>}
                  <footer className="pagos-pie"><span>{lista.total} {lista.total === 1 ? 'movimiento' : 'movimientos'} · {fechaIsoCorta(rango.desde)} al {fechaIsoCorta(rango.hasta)}</span></footer>
                </>}

    {!sinCuenta && <section className="pagos-imprimir" aria-label="Imprimir historial">
      <p>Se imprimen solo los pagos confirmados del período elegido.</p>
      <div className="pagos-formato" role="group" aria-label="Formato de impresión">
        <button type="button" aria-pressed={formato === 'carta'} className={formato === 'carta' ? 'active' : ''} onClick={() => setFormato('carta')}>Carta</button>
        <button type="button" aria-pressed={formato === 'rollo-80'} className={formato === 'rollo-80' ? 'active' : ''} onClick={() => setFormato('rollo-80')}>Rollo 80 mm</button>
      </div>
      <button type="button" className="primary-button" disabled={!params} onClick={() => setImprimiendo(true)}><Printer aria-hidden="true" /> Imprimir</button>
    </section>}

    {detalle && <DetallePagoModal fila={detalle} onClose={() => setDetalle(null)} />}
    {imprimiendo && params && <HistorialPagosImpresion cliente={{ id: cliente.id, nombre, documento: info?.documento ?? null, categoria: info?.categoria ? (categoriaLabel[info.categoria] ?? info.categoria) : null }} desde={rango.desde} hasta={rango.hasta} formato={formato} onClose={() => setImprimiendo(false)} />}
  </main>
}

function MovimientoItem({ fila, onVer }: { fila: FilaPago; onVer: () => void }) {
  const { fecha, hora } = fechaHoraPago(fila.fecha)
  const nota = notaAplicacion(fila)
  const esSaldo = fila.clase === 'SALDO'
  return <li className={`pagos-movimiento ${fila.estado === 'POR_VERIFICAR' ? 'por-verificar' : fila.estado === 'ANULADO' ? 'anulado' : ''}`}>
    <div className="pagos-mov-fecha"><strong>{fecha}</strong><small>{hora}</small></div>
    <div className="pagos-mov-cuerpo">
      <div className="pagos-mov-linea"><TipoBadge tipo={fila.tipo} /><span>{fila.medio ? medioPagoLabel[fila.medio] : 'Sin dinero nuevo'}</span>{fila.referencia && <span className="pagos-ref">{fila.referencia}</span>}<EstadoPunto estado={fila.estado} /></div>
      {fila.aplicaciones.length > 0 && <ul className="pagos-mov-pedidos">{fila.aplicaciones.map((a, i) => <li key={`${a.pedidoId ?? 'x'}-${i}`}><span>{a.referencia ?? 'Saldo anterior'}</span><span>{bs(a.monto)}</span></li>)}</ul>}
      {nota && <small className="pagos-mov-nota">{nota}</small>}
    </div>
    <div className={`pagos-mov-monto num ${esSaldo ? 'es-cero' : ''}`}>{bs(montoRecibido(fila))}</div>
    <button type="button" className="pagos-ver" aria-label={`Ver pago del ${fecha}`} onClick={onVer}>Ver</button>
  </li>
}
