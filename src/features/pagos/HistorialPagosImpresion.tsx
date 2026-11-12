import { useEffect, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { DocBrand } from '../../components/DocumentoExportable'
import { DocumentTableColumns } from '../../components/DocumentPrintPages'
import type { DocPrintFormat } from '../../components/docPrintFormat'
import { empresaStore as empresa, loadEmpresaConfig } from '../../config/empresaStore'
import { authSessionProvider } from '../../infrastructure/services'
import { consultarHistorialPagos } from '../../infrastructure/hermes/client'
import {
  fechaHoraPago, fechaIsoCorta, medioPagoLabel, pedidosAplicados, tipoPagoLabel, totalConSaldo, totalRecibidoConfirmado,
  TIPOS_PAGO, type FilaPago,
} from '../../domain/pagos/historialPagos'
import { bs } from './pagosUi'

export interface ClienteImpresion { id: number; nombre: string; documento: string | null; categoria: string | null }

const POR_PAGINA_IMPRESION = 500
const MAX_PAGINAS = 200
const LEYENDA = TIPOS_PAGO.map(t => tipoPagoLabel[t]).join(' · ')

/** Trae todas las páginas de pagos confirmados del cliente en el rango. Solo confirmados: lo pide la RPC y se vuelve a filtrar. */
export async function cargarPagosParaImpresion(clienteId: number, desde: string, hasta: string): Promise<FilaPago[]> {
  const filas: FilaPago[] = []
  let total = Number.POSITIVE_INFINITY
  for (let pagina = 0; filas.length < total && pagina < MAX_PAGINAS; pagina++) {
    const r = await consultarHistorialPagos({ desde, hasta, clienteId, soloConfirmados: true, limite: POR_PAGINA_IMPRESION, offset: filas.length })
    total = r.total
    if (r.filas.length === 0) break
    filas.push(...r.filas)
  }
  return filas.filter(f => f.estado === 'CONFIRMADO')
}

const medioYReferencia = (f: FilaPago): string => [f.medio ? medioPagoLabel[f.medio] : null, f.referenciaImpresion].filter(Boolean).join(' · ') || '—'
const aplicadoA = (f: FilaPago): string => pedidosAplicados(f) || (f.tipo === 'ANTICIPO' ? 'A favor del cliente' : '—')
const recibido = (f: FilaPago): string => f.clase === 'SALDO' ? '—' : bs(f.monto)

interface Cargado { clave: string; filas?: FilaPago[]; error?: string }

/** Vista previa e impresión del historial de pagos confirmados de un cliente (carta o rollo 80 mm). */
export function HistorialPagosImpresion({ cliente, desde, hasta, formato, onClose }: { cliente: ClienteImpresion; desde: string; hasta: string; formato: DocPrintFormat; onClose: () => void }) {
  const clave = `${cliente.id}|${desde}|${hasta}`
  const [cargado, setCargado] = useState<Cargado | null>(null)
  const [usuario, setUsuario] = useState('')
  const [emitido] = useState(() => new Date())
  const [, setEmpresaVersion] = useState(0)
  const [imprimiendo, setImprimiendo] = useState(false)
  const esRollo = formato === 'rollo-80'

  useEffect(() => {
    let cancelado = false
    cargarPagosParaImpresion(cliente.id, desde, hasta)
      .then(filas => { if (!cancelado) setCargado({ clave, filas }) })
      .catch((err: unknown) => { if (!cancelado) setCargado({ clave, error: err instanceof Error ? err.message : 'No se pudo preparar la impresión.' }) })
    return () => { cancelado = true }
  }, [clave, cliente.id, desde, hasta])
  useEffect(() => {
    let cancelado = false
    void authSessionProvider.getSession().then(s => { if (!cancelado) setUsuario(s?.user.name ?? s?.user.email ?? '') }).catch(() => undefined)
    void loadEmpresaConfig().then(() => { if (!cancelado) setEmpresaVersion(v => v + 1) })
    return () => { cancelado = true }
  }, [])
  // El nombre sugerido al «Guardar como PDF» sale del título de la pestaña.
  useEffect(() => {
    const anterior = document.title
    document.title = `Historial de pagos - ${cliente.nombre}`
    return () => { document.title = anterior }
  }, [cliente.nombre])

  // Rollo continuo: el largo de la hoja es el del contenido renderizado.
  const [rollo, setRollo] = useState<HTMLDivElement | null>(null)
  const [altoMm, setAltoMm] = useState(0)
  useEffect(() => {
    if (!rollo || typeof ResizeObserver === 'undefined') return
    const medir = () => setAltoMm(Math.ceil(rollo.offsetHeight * 25.4 / 96))
    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(rollo)
    return () => observer.disconnect()
  }, [rollo])

  const vigente = cargado?.clave === clave ? cargado : null
  const filas = vigente?.filas
  const fecha = emitido.toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = emitido.toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false })
  const periodo = `${fechaIsoCorta(desde)} al ${fechaIsoCorta(hasta)}`

  const imprimir = async () => {
    setImprimiendo(true)
    try {
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.print-document img')).map(img => img.decode().catch(() => undefined)))
    } finally { setImprimiendo(false) }
    window.print()
  }

  const encabezado = { cliente, periodo, fecha, hora, usuario }
  return <Modal title="Vista previa del historial de pagos" subtitle={`${cliente.nombre} · ${periodo}`} onClose={onClose} wide>
    {!esRollo && <style>{`@media print {
      @page pos-document {
        size: letter; margin: 12mm;
        @bottom-left { content: ${JSON.stringify(`Historial de pagos · ${cliente.nombre}`)}; font: 8pt Arial, sans-serif; color: #555; }
        @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial, sans-serif; color: #555; }
      }
    }`}</style>}
    {esRollo && altoMm > 0 && <style>{`@media print { @page pos-roll { size: 80mm ${altoMm + 12}mm; margin: 0 } }`}</style>}
    {!filas
      ? vigente?.error ? <div className="modal-body"><p role="alert" className="pagos-error">{vigente.error}</p></div> : <div className="modal-body"><p role="status">Preparando el historial…</p></div>
      : esRollo ? <HistorialRollo filas={filas} {...encabezado} rollRef={setRollo} /> : <HistorialCarta filas={filas} {...encabezado} />}
    <footer className="modal-actions">
      <button type="button" className="secondary-button" disabled={!filas || imprimiendo} onClick={() => void imprimir()}><FileDown /> Guardar PDF</button>
      <button type="button" className="primary-button" disabled={!filas || imprimiendo} onClick={() => void imprimir()}><Printer /> Imprimir</button>
    </footer>
  </Modal>
}

interface Encabezado { cliente: ClienteImpresion; periodo: string; fecha: string; hora: string; usuario: string }

function Totales({ filas }: { filas: FilaPago[] }) {
  return <footer className="doc-totals pagos-print-totales">
    <div className="doc-total-row"><span>Pagos confirmados</span><strong>{filas.filter(f => f.clase === 'PAGO').length}</strong></div>
    <div className="doc-total-row"><span>Pagado con saldo a favor</span><strong>{bs(totalConSaldo(filas))}</strong></div>
    <div className="doc-total-row doc-total-line"><span>Dinero recibido</span><strong>{bs(totalRecibidoConfirmado(filas))}</strong></div>
  </footer>
}

function HistorialCarta({ filas, cliente, periodo, fecha, hora, usuario }: { filas: FilaPago[] } & Encabezado) {
  return <div className="print-document documento-exportable pagos-print">
    <div className="doc-page">
      <header>
        <DocBrand />
        <div className="doc-id-block">
          <strong>HISTORIAL DE PAGOS</strong>
          <span>Emitido el {fecha} a las {hora}</span>
          {usuario && <span>Por: {usuario}</span>}
        </div>
      </header>
      <section className="doc-kv-grid pagos-print-cliente" aria-label="Cliente">
        <div className="doc-kv doc-kv-span2"><div className="k">Cliente</div><div className="v">{cliente.nombre}</div></div>
        {cliente.documento && <div className="doc-kv"><div className="k">NIT</div><div className="v">{cliente.documento}</div></div>}
        {cliente.categoria && <div className="doc-kv"><div className="k">Categoría</div><div className="v">{cliente.categoria}</div></div>}
        <div className="doc-kv"><div className="k">Período</div><div className="v">{periodo}</div></div>
      </section>
      {filas.length === 0
        ? <p className="doc-items-summary">No hay pagos confirmados en este período.</p>
        : <table className="doc-table pagos-print-tabla">
          <DocumentTableColumns widths={[15, 17, 24, 26, 18]} />
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Medio / Ref.</th><th>Aplicado a</th><th className="num">Recibido</th></tr></thead>
          <tbody>{filas.map(f => {
            const { fecha: d, hora: h } = fechaHoraPago(f.fecha)
            return <tr key={f.clave}><td>{d}<small className="doc-line-note">{h}</small></td><td>{tipoPagoLabel[f.tipo]}</td><td>{medioYReferencia(f)}</td><td>{aplicadoA(f)}</td><td className="num">{recibido(f)}</td></tr>
          })}</tbody>
        </table>}
      <Totales filas={filas} />
      <p className="pagos-print-leyenda">Tipos de movimiento: {LEYENDA}. «Aplicación de saldo» no recibe dinero.</p>
    </div>
  </div>
}

function HistorialRollo({ filas, cliente, periodo, fecha, hora, usuario, rollRef }: { filas: FilaPago[]; rollRef: (el: HTMLDivElement | null) => void } & Encabezado) {
  return <div className="print-document documento-exportable doc-roll pagos-print-rollo" ref={rollRef}>
    <div className="doc-roll-center">
      <div className="doc-roll-line"><b>{empresa.razonSocial}</b></div>
      <div className="doc-roll-line">{empresa.direccion}</div>
      {empresa.nit && <div className="doc-roll-line">NIT: {empresa.nit}</div>}
    </div>
    <div className="doc-roll-rule" />
    <div className="doc-roll-center">
      <div className="doc-roll-line"><b>HISTORIAL DE PAGOS</b></div>
      <div className="doc-roll-line">Emitido el {fecha} a las {hora}</div>
      {usuario && <div className="doc-roll-line">Por: {usuario}</div>}
    </div>
    <div className="doc-roll-rule" />
    <div className="doc-roll-line">Cliente: {cliente.nombre}</div>
    {cliente.documento && <div className="doc-roll-line">NIT: {cliente.documento}</div>}
    <div className="doc-roll-line">Período: {periodo}</div>
    <div className="doc-roll-rule" />
    {filas.length === 0 && <div className="doc-roll-line">No hay pagos confirmados en este período.</div>}
    {filas.map(f => {
      const { fecha: d, hora: h } = fechaHoraPago(f.fecha)
      return <div className="doc-roll-item" key={f.clave}>
        <div className="doc-roll-line"><b>{d} {h}</b></div>
        <div className="doc-roll-line">{tipoPagoLabel[f.tipo]}</div>
        <div className="doc-roll-line">{medioYReferencia(f)}</div>
        <div className="doc-roll-line">Aplicado a: {aplicadoA(f)}</div>
        <div className="doc-roll-line"><b>Recibido: {recibido(f)}</b></div>
        <div className="doc-roll-rule" />
      </div>
    })}
    <div className="doc-roll-line">Pagos confirmados: {filas.filter(f => f.clase === 'PAGO').length}</div>
    <div className="doc-roll-line">Con saldo a favor: {bs(totalConSaldo(filas))}</div>
    <div className="doc-roll-line doc-roll-total"><b>DINERO RECIBIDO: {bs(totalRecibidoConfirmado(filas))}</b></div>
    <div className="doc-roll-rule" />
    <div className="doc-roll-line">{LEYENDA}</div>
    <div className="doc-roll-end">— FIN —</div>
  </div>
}
