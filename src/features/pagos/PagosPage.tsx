import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { InfoHint } from '../../components/InfoHint'
import {
  fechaHoraPago, MEDIOS_PAGO, medioPagoLabel, montoRecibido, pedidosAplicados, rangoPorDefectoLista, rangoValido,
  TIPOS_PAGO, tipoPagoAyuda, tipoPagoLabel, fechaIsoCorta,
  type EstadoPago, type FilaPago, type MedioPago, type ParamsHistorialPagos, type TipoPago,
} from '../../domain/pagos/historialPagos'
import { FeatureState } from '../shared/FeatureShell'
import { DetallePagoModal } from './DetallePagoModal'
import { HistorialClientePage } from './HistorialClientePage'
import { bs, EstadoPunto, notaAplicacion, TipoBadge } from './pagosUi'
import { useConteosPorTipo, useHistorialPagos } from './useHistorialPagos'

export interface ClientePagos { id: number; nombre: string }

const ESTADOS: { valor: '' | EstadoPago; label: string }[] = [
  { valor: '', label: 'Todos los estados' }, { valor: 'CONFIRMADO', label: 'Confirmados' },
  { valor: 'POR_VERIFICAR', label: 'Por verificar' }, { valor: 'ANULADO', label: 'Anulados' },
]
const BUSQUEDA_DEMORA_MS = 300

/** Módulo «Pagos»: lista general de movimientos (solo lectura) y acceso al historial por cliente. */
export function PagosPage({ clienteInicial = null }: { clienteInicial?: ClientePagos | null }) {
  const [cliente, setCliente] = useState<ClientePagos | null>(clienteInicial)
  if (cliente) return <HistorialClientePage cliente={cliente} onVolver={() => setCliente(null)} />
  return <ListaPagos onVerHistorial={(id, nombre) => setCliente({ id, nombre })} />
}

function ListaPagos({ onVerHistorial }: { onVerHistorial: (id: number, nombre: string) => void }) {
  const [rango, setRango] = useState(() => rangoPorDefectoLista())
  const [buscarTexto, setBuscarTexto] = useState('')
  const [buscar, setBuscar] = useState('')
  const [medio, setMedio] = useState<'' | MedioPago>('')
  const [estado, setEstado] = useState<'' | EstadoPago>('')
  const [tipo, setTipo] = useState<'' | TipoPago>('')
  const [detalle, setDetalle] = useState<FilaPago | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setBuscar(buscarTexto.trim()), BUSQUEDA_DEMORA_MS)
    return () => window.clearTimeout(id)
  }, [buscarTexto])

  const errorRango = rangoValido(rango.desde, rango.hasta)
  const filtros = useMemo(() => errorRango ? null : {
    desde: rango.desde, hasta: rango.hasta,
    ...(buscar ? { buscar } : {}), ...(medio ? { medio } : {}), ...(estado ? { estado } : {}),
  }, [errorRango, rango.desde, rango.hasta, buscar, medio, estado])
  const params: ParamsHistorialPagos | null = filtros ? { ...filtros, ...(tipo ? { tipo } : {}) } : null
  const lista = useHistorialPagos(params)
  const conteos = useConteosPorTipo(filtros)
  const totalTodos = conteos ? TIPOS_PAGO.reduce((s, t) => s + conteos[t], 0) : null

  const verHistorial = (id: number, nombre: string) => { setDetalle(null); onVerHistorial(id, nombre) }

  return <main className="feature-page pagos-page">
    <header className="feature-header"><div><span>COBRANZA</span><h1>Pagos</h1><p>Dinero recibido y deudas canceladas, cada cosa por separado. Solo consulta.</p></div></header>

    <div className="pagos-filtros">
      <label className="pagos-buscar"><Search aria-hidden="true" /><input aria-label="Buscar por cliente o referencia" placeholder="Buscar cliente o referencia…" value={buscarTexto} onChange={e => setBuscarTexto(e.target.value)} /></label>
      <label>Desde<input type="date" value={rango.desde} max={rango.hasta || undefined} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))} /></label>
      <label>Hasta<input type="date" value={rango.hasta} min={rango.desde || undefined} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))} /></label>
      <label>Medio<select value={medio} onChange={e => setMedio(e.target.value as '' | MedioPago)}><option value="">Todos los medios</option>{MEDIOS_PAGO.map(m => <option key={m} value={m}>{medioPagoLabel[m]}</option>)}</select></label>
      <label>Estado<select value={estado} onChange={e => setEstado(e.target.value as '' | EstadoPago)}>{ESTADOS.map(e => <option key={e.valor} value={e.valor}>{e.label}</option>)}</select></label>
    </div>
    {errorRango && <p role="alert" className="pagos-error">{errorRango}</p>}

    <div className="pagos-chips" role="group" aria-label="Tipo de movimiento">
      <button type="button" className={`pagos-chip ${tipo === '' ? 'active' : ''}`} aria-pressed={tipo === ''} onClick={() => setTipo('')}>Todos{totalTodos != null && <b>{totalTodos}</b>}</button>
      {TIPOS_PAGO.map(t => <span key={t} className="pagos-chip-wrap">
        <button type="button" className={`pagos-chip ${tipo === t ? 'active' : ''}`} aria-pressed={tipo === t} onClick={() => setTipo(tipo === t ? '' : t)}>{tipoPagoLabel[t]}{conteos && <b>{conteos[t]}</b>}</button>
        <InfoHint title={tipoPagoLabel[t]} text={tipoPagoAyuda[t]} />
      </span>)}
    </div>

    {lista.resumen && <div className="pagos-tiles" aria-label="Totales del período">
      <div className="pagos-tile"><span>Dinero recibido</span><strong>{bs(lista.resumen.recibido)}</strong><small>Pagos confirmados</small></div>
      <div className="pagos-tile"><span>Por verificar</span><strong>{bs(lista.resumen.porVerificar)}</strong><small>Esperan al gerente</small></div>
      <div className="pagos-tile pagos-tile-favor"><span>Quedó a favor</span><strong>{bs(lista.resumen.aFavor)}</strong><small>Anticipos y sobrantes</small></div>
      <div className="pagos-tile"><span>Pagado con saldo a favor</span><strong>{bs(lista.resumen.conSaldo)}</strong><small>No entró dinero</small></div>
    </div>}

    {lista.sinAcceso ? <FeatureState type="error" text="Sin acceso a los pagos" />
      : lista.error ? <><FeatureState type="error" text={lista.error} /><button type="button" className="secondary-button" onClick={lista.reintentar}>Reintentar</button></>
        : !params ? null
          : lista.cargando ? <FeatureState type="skeleton" text="Cargando pagos" />
            : lista.filas.length === 0 ? <FeatureState type="no-results" text="No hay movimientos en este período" />
              : <>
                <div className="pagos-tabla-caja"><table className="pagos-tabla">
                  <thead><tr><th>Fecha y hora</th><th>Cliente</th><th>Tipo</th><th>Se aplicó a</th><th>Medio</th><th className="num">Dinero recibido</th><th>Estado</th><th>Registró</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                  <tbody>{lista.filas.map(f => <FilaTabla key={f.clave} fila={f} onVerCliente={verHistorial} onVer={() => setDetalle(f)} />)}</tbody>
                </table></div>
                {lista.errorMas && <p role="alert" className="pagos-error">{lista.errorMas}</p>}
                {lista.hayMas && <button type="button" className="secondary-button pagos-mas" disabled={lista.cargandoMas} onClick={() => void lista.cargarMas()}>{lista.cargandoMas ? 'Cargando…' : 'Cargar más'}</button>}
                <footer className="pagos-pie">
                  <span>{lista.total} {lista.total === 1 ? 'movimiento' : 'movimientos'} · {fechaIsoCorta(rango.desde)} al {fechaIsoCorta(rango.hasta)}</span>
                  {lista.resumen && <span>Los totales cuentan solo pagos confirmados</span>}
                </footer>
              </>}

    {detalle && <DetallePagoModal fila={detalle} onClose={() => setDetalle(null)} onVerHistorial={verHistorial} />}
  </main>
}

function FilaTabla({ fila, onVerCliente, onVer }: { fila: FilaPago; onVerCliente: (id: number, nombre: string) => void; onVer: () => void }) {
  const { fecha, hora } = fechaHoraPago(fila.fecha)
  const nota = notaAplicacion(fila)
  const aplicado = pedidosAplicados(fila)
  const esSaldo = fila.clase === 'SALDO'
  return <tr className={fila.estado === 'POR_VERIFICAR' ? 'por-verificar' : fila.estado === 'ANULADO' ? 'anulado' : undefined}>
    <td><strong>{fecha}</strong><small>{hora}</small></td>
    <td>{fila.clienteId != null
      ? <button type="button" className="pagos-link" aria-label={`Ver historial de ${fila.cliente}`} onClick={() => onVerCliente(fila.clienteId!, fila.cliente)}>{fila.cliente}</button>
      : fila.cliente}</td>
    <td><TipoBadge tipo={fila.tipo} /></td>
    <td><span>{aplicado || '—'}</span>{nota && <small>{nota}</small>}</td>
    <td>{fila.medio ? medioPagoLabel[fila.medio] : '—'}</td>
    <td className={`num ${esSaldo ? 'es-cero' : ''}`}>{bs(montoRecibido(fila))}</td>
    <td><EstadoPunto estado={fila.estado} /></td>
    <td>{fila.registradoPor ?? '—'}</td>
    <td><button type="button" className="pagos-ver" aria-label={`Ver pago de ${fila.cliente}`} onClick={onVer}>Ver</button></td>
  </tr>
}
