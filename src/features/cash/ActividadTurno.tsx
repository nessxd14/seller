import { Paperclip, Printer, ReceiptText } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { TurnoMovimiento, TurnoTicket } from '../../application/shared/models'
import { InfoHint } from '../../components/InfoHint'

const bs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })

const METODO: Record<string, string> = { EFECTIVO: 'Efectivo', QR: 'QR', TRANSFERENCIA: 'Transf.', SIGEP: 'SIGEP', CHEQUE: 'Cheque', DEPOSITO: 'Depósito', SALDO_FAVOR: 'Saldo a favor' }
const PAGINA = 15

type FiltroId = 'TODOS' | 'VENTA' | 'ANTICIPO' | 'GASTO' | 'REMESA' | 'INYECCION' | 'ANULACION' | 'SALDO_FAVOR' | 'ACREEDOR'

// Mismo criterio de filtrado que tenía el select "Filtrar movimientos"; ahora como botones con contador.
const FILTROS: { id: FiltroId; label: string; incluye: (m: TurnoMovimiento) => boolean }[] = [
  { id: 'TODOS', label: 'Todo', incluye: () => true },
  { id: 'VENTA', label: 'Ventas', incluye: (m) => m.tipo === 'VENTA' },
  { id: 'ANTICIPO', label: 'Cobros', incluye: (m) => m.tipo === 'ANTICIPO' },
  { id: 'GASTO', label: 'Gastos', incluye: (m) => m.subtipo === 'GASTO' },
  { id: 'REMESA', label: 'Remesas', incluye: (m) => m.subtipo === 'REMESA' },
  { id: 'INYECCION', label: 'Inyecciones', incluye: (m) => m.subtipo === 'INYECCION' },
  { id: 'ANULACION', label: 'Anulaciones', incluye: (m) => m.tipo === 'ANULACION' },
  { id: 'SALDO_FAVOR', label: 'Saldo a favor', incluye: (m) => m.tipo === 'SALDO_FAVOR' || m.tipo === 'SALDO_REVERTIDO' },
  { id: 'ACREEDOR', label: 'Clientes con saldo', incluye: (m) => !!m.clienteAcreedor },
]

const tipoDe = (m: TurnoMovimiento): { label: string; tono: string } => {
  if (m.tipo === 'VENTA') return { label: m.documento?.startsWith('VTD') ? 'VTD' : 'Venta', tono: 'venta' }
  if (m.tipo === 'ANTICIPO') return { label: 'Cobro', tono: 'cobro' }
  if (m.subtipo === 'GASTO') return { label: 'Gasto', tono: 'gasto' }
  if (m.subtipo === 'REMESA') return { label: 'Remesa', tono: 'neutro' }
  if (m.subtipo === 'INYECCION') return { label: 'Inyección', tono: 'neutro' }
  if (m.tipo === 'ANULACION') return { label: 'Anulación', tono: 'anulacion' }
  if (m.tipo === 'SALDO_FAVOR') return { label: 'Saldo', tono: 'saldo' }
  if (m.tipo === 'SALDO_REVERTIDO') return { label: 'Saldo dev.', tono: 'saldo' }
  return { label: m.subtipo ?? m.tipo, tono: 'neutro' }
}

const esSalida = (m: TurnoMovimiento) => m.tipo === 'EGRESO' || m.tipo === 'ANULACION'

/**
 * "Actividad del turno": una línea por movimiento (hora · tipo · detalle · método · importe) con
 * las acciones de ticket (ver productos, reimprimir) en la misma fila — reemplaza la lista de
 * tarjetas altas y la sección aparte "Mis tickets", que repetía las ventas. Un clic en el detalle
 * lo despliega completo. Muestra los últimos 15 y crece con "Ver más".
 */
export function ActividadTurno({ movimientos, tickets, puedeMoverArqueo, hints, onVerProductos, onReimprimir, onVerComprobante, onAlternarArqueo }: {
  movimientos: TurnoMovimiento[]
  tickets: TurnoTicket[]
  puedeMoverArqueo: boolean
  hints: { anulacion: { title: string; text: string }; fueraArqueo: { title: string; text: string } }
  onVerProductos: (ventaId: string) => void
  onReimprimir: (ventaId: string) => void
  onVerComprobante: (path: string) => void
  onAlternarArqueo: (m: TurnoMovimiento) => void
}) {
  const [filtro, setFiltro] = useState<FiltroId>('TODOS')
  const [limite, setLimite] = useState(PAGINA)
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set())

  const activo = FILTROS.find((f) => f.id === filtro) ?? FILTROS[0]
  const filtrados = movimientos.filter(activo.incluye)
  const visibles = filtrados.slice(0, limite)
  const restantes = filtrados.length - visibles.length
  const qrPendiente = new Set(tickets.filter((t) => t.metodos.some((p) => p.estadoVerificacion === 'PENDIENTE')).map((t) => t.ventaId))
  const contadores = FILTROS.map((f) => ({ ...f, total: movimientos.filter(f.incluye).length })).filter((f) => f.id === 'TODOS' || f.total > 0 || f.id === filtro)

  const elegir = (id: FiltroId) => { setFiltro(id); setLimite(PAGINA) }
  const alternar = (id: string) => setAbiertos((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const teclado = (id: string) => (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(id) } }

  return <section className="cash-ledger actividad-turno">
    <header>
      <div><h3>Actividad del turno</h3><p>{movimientos.length ? `${movimientos.length} movimiento${movimientos.length === 1 ? '' : 's'} · ventas, cobros, gastos y entregas del cajero.` : 'Ventas, pagos, anticipos y gastos del cajero que cobró.'}</p></div>
    </header>
    {!!movimientos.length && <div className="actividad-filtros" role="group" aria-label="Filtrar movimientos">
      {contadores.map((f) => <button key={f.id} type="button" className={`actividad-filtro filtro-${f.id.toLowerCase()}`} aria-pressed={filtro === f.id} onClick={() => elegir(f.id)}>{f.label} <span>{f.total}</span></button>)}
      {filtro === 'ANULACION' && <InfoHint title={hints.anulacion.title} text={hints.anulacion.text} />}
    </div>}
    {!!visibles.length && <div className="cash-ledger-head actividad-head" aria-hidden="true"><span>Hora</span><span>Tipo</span><span>Detalle</span><span>Método</span><span>Importe</span><span /></div>}
    <div className="actividad-lista">
      {visibles.map((m) => {
        const tipo = tipoDe(m)
        const titulo = m.documento ?? (m.tipo === 'ANTICIPO' ? 'Pago / anticipo' : m.detalle || m.subtipo || m.tipo)
        const extra = [m.clienteNombre, m.documento || m.tipo === 'ANTICIPO' ? m.detalle : '', m.estadoGasto?.toLowerCase()].filter(Boolean).join(' · ')
        const abierto = abiertos.has(m.id)
        return <article key={m.id} className={`cash-ledger-row actividad-row tono-${tipo.tono}${m.clienteAcreedor ? ' cash-acreedor-row' : ''}${abierto ? ' abierta' : ''}`}>
          <span className="actividad-hora">{hora(m.creadoEn)}</span>
          <span className={`actividad-tipo tono-${tipo.tono}`}>{tipo.label}</span>
          <div className="actividad-detalle">
            <span className="actividad-texto" role="button" tabIndex={0} aria-expanded={abierto} title={abierto ? undefined : [titulo, extra].filter(Boolean).join(' · ')} onClick={() => alternar(m.id)} onKeyDown={teclado(m.id)}><strong>{titulo}</strong>{extra && <span> · {extra}</span>}</span>
            {m.clienteAcreedor && <small className="credit-client-tag">Cliente con saldo a favor</small>}
            {m.ventaId && qrPendiente.has(m.ventaId) && <span className="qr-pendiente-chip">QR pendiente</span>}
            {m.fueraDeArqueo && <span className="fuera-arqueo-badge">Fuera del arqueo<InfoHint title={hints.fueraArqueo.title} text={hints.fueraArqueo.text} /></span>}
            {m.tipo === 'ANULACION' && <InfoHint title={hints.anulacion.title} text={hints.anulacion.text} />}
          </div>
          <span className="actividad-metodo">{METODO[m.metodo] ?? m.metodo}</span>
          <b className={`actividad-importe${esSalida(m) ? ' salida' : ''}`}>{esSalida(m) ? '− ' : ''}Bs {bs(m.montoBs)}</b>
          <div className="actividad-acciones">
            {m.ventaId && <button type="button" aria-label="Ver productos" title="Ver productos" onClick={() => onVerProductos(m.ventaId!)}><ReceiptText /></button>}
            {m.ventaId && <button type="button" aria-label="Reimprimir" title="Reimprimir ticket" onClick={() => onReimprimir(m.ventaId!)}><Printer /></button>}
            {m.comprobantePath && <button type="button" aria-label="Ver comprobante" title="Ver comprobante" onClick={() => onVerComprobante(m.comprobantePath!)}><Paperclip /></button>}
            {puedeMoverArqueo && m.tipo === 'ANTICIPO' && m.metodo === 'EFECTIVO' && <button type="button" className="fuera-arqueo-toggle" onClick={() => onAlternarArqueo(m)}>{m.fueraDeArqueo ? 'Volver al arqueo' : 'Sacar del arqueo'}</button>}
          </div>
        </article>
      })}
    </div>
    {!movimientos.length && <p className="cash-muted">Los movimientos aparecerán aquí cuando se registren.</p>}
    {!!movimientos.length && !filtrados.length && <div className="cash-filter-empty" role="status"><p>No hay movimientos de este tipo en el turno.</p><button type="button" onClick={() => elegir('TODOS')}>Ver todos los movimientos</button></div>}
    {restantes > 0 && <button type="button" className="actividad-ver-mas" onClick={() => setLimite((n) => n + 25)}>Ver {Math.min(25, restantes)} más <span>· quedan {restantes}</span></button>}
    {movimientos.length >= 500 && <p className="cash-muted">Se muestran los últimos 500 movimientos. El resumen incluye el turno completo.</p>}
  </section>
}
