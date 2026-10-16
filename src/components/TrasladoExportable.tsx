import { useEffect, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { TransferEstado, TransferLine, TransferRecord } from '../application/shared/models'
import { listLineIdentifiers } from '../infrastructure/services'
import { Modal } from './Modal'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { LineIdentifiersRow, type LineIdentifiers } from './LineIdentifiersRow'
import { motivoLabel, sucursalLabel } from '../features/transfers/TransfersPage'
import { formatDocumentDate as fechaFmt, formatDocumentQuantity as fmtQty } from '../domain/documents/documentProgress'
import { nombreArchivoDocumento } from '../domain/documents/nombreArchivoDocumento'
import { DocumentPrintPages, DocumentTableColumns } from './DocumentPrintPages'

// Brief S8: un componente nuevo, no un cuarto modo de DocumentoExportable — un traslado
// no tiene cliente, canal ni precios, tiene origen→destino y tres cantidades por línea.
// El mismo componente imprime uno de tres documentos según transfer.estado: hoja de
// picking (SOLICITADO), guía de despacho (EN_TRANSITO), o constancia de recepción
// (RECIBIDO y los estados cerrados CANCELADO/RECHAZADO).
type TrasladoDocMode = 'picking' | 'guia' | 'constancia' | 'cerrado'

const modeFor = (estado: TransferEstado): TrasladoDocMode =>
  estado === 'SOLICITADO' ? 'picking' : estado === 'EN_TRANSITO' ? 'guia' : estado === 'RECIBIDO' ? 'constancia' : 'cerrado'

const titleFor: Record<TrasladoDocMode, string> = {
  picking: 'SOLICITUD DE TRASLADO',
  guia: 'GUÍA DE TRASLADO',
  constancia: 'CONSTANCIA DE RECEPCIÓN',
  cerrado: 'TRASLADO CERRADO',
}

const modalTitleFor: Record<TrasladoDocMode, string> = {
  picking: 'Vista previa de hoja de picking',
  guia: 'Vista previa de guía de traslado',
  constancia: 'Vista previa de constancia de recepción',
  cerrado: 'Vista previa de traslado cerrado',
}

// Mismo criterio que TransferDetailPanel: cantidadDespachada/cantidadRecibida siempre
// viajan en unidad base; esto las vuelve a expresar en la presentación de la línea
// (ej. "3 Caja") cuando corresponde, para que quien junta/despacha trabaje en cajas y
// quien controla el stock trabaje en unidades base sin que el papel le mienta a ninguno.
const factorFor = (line: TransferLine) => (line.presentacionId != null && line.cantidadPresentacion ? line.cantidadBase / line.cantidadPresentacion : 1)

const formatQty = (baseQty: number, factor: number, presentacionNombre?: string) =>
  factor !== 1 && presentacionNombre ? `${fmtQty(baseQty / factor)} ${presentacionNombre}` : fmtQty(baseQty)

export function TrasladoExportable({ transfer, onClose }: { transfer: TransferRecord; onClose: () => void }) {
  const [identifiersByProduct, setIdentifiersByProduct] = useState<Record<string, LineIdentifiers>>({})
  useEffect(() => { void loadEmpresaConfig() }, [])
  useEffect(() => {
    const ids = Array.from(new Set(transfer.lines.map((line) => line.productId).filter(Boolean)))
    if (!ids.length) return
    void listLineIdentifiers(ids).then(setIdentifiersByProduct)
  }, [transfer.lines])

  const mode = modeFor(transfer.estado)
  const title = mode === 'cerrado' ? `TRASLADO ${transfer.estado}` : titleFor[mode]
  // Brief T3: el identificador es el correlativo real (numero) — referencia es el asunto
  // libre y se muestra aparte, nunca como si fuera el número.
  const numero = transfer.numero
  const anulado = transfer.estado === 'CANCELADO' || transfer.estado === 'RECHAZADO'

  // TAREA 5 (T1): mismo mecanismo que DocumentoExportable — un traslado no tiene
  // cliente, así que el nombre de archivo es solo el número.
  useEffect(() => {
    const previousTitle = document.title
    document.title = nombreArchivoDocumento(numero)
    return () => { document.title = previousTitle }
  }, [numero])
  const lineasIncompletas = mode === 'guia' && transfer.lines.some((line) => line.cantidadDespachada != null && line.cantidadDespachada < line.cantidadBase)

  return (
    <Modal title={modalTitleFor[mode]} subtitle={empresa.razonSocial} onClose={onClose} wide>
      <DocumentPrintPages number={numero} lineCount={transfer.lines.length} />
      <div className={`print-document documento-exportable traslado-a4 traslado-doc-${mode}`}>
        {anulado && <div className="doc-watermark">{transfer.estado}</div>}
        <div className={`doc-purpose ${anulado ? 'doc-purpose-alert' : ''}`}><span>{mode === 'picking' ? 'Preparación de mercadería · marcar cada producto' : mode === 'guia' ? 'Salida de mercadería · controlar al recibir' : mode === 'constancia' ? 'Recepción registrada · revisar diferencias' : 'Registro de cierre · no autoriza salida de mercadería'}</span><b>{transfer.estado.replaceAll('_', ' ')}</b></div>
        <header>
          <div className="doc-brand">
            <img src={empresa.logoSrc} alt={empresa.razonSocial} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            <div>
              <b>{empresa.razonSocial}</b>
              <span>{empresa.direccion}</span>
              <span>{empresa.ciudad}</span>
              <span>Cel. {empresa.celular} · {empresa.correo}</span>
              {empresa.nit && <span>NIT: {empresa.nit}</span>}
            </div>
          </div>
          <div className="doc-id-block"><strong>{title}</strong><span className="doc-number-mono">{numero}</span></div>
        </header>
        <section className="doc-meta">
          <p><b>Origen:</b> {sucursalLabel[transfer.sucursalOrigenId] ?? `Sucursal ${transfer.sucursalOrigenId}`} <b>→ Destino:</b> {sucursalLabel[transfer.sucursalDestinoId] ?? `Sucursal ${transfer.sucursalDestinoId}`}</p>
          <p><b>Motivo:</b> {motivoLabel[transfer.motivo]}</p>
          {transfer.referencia && <p><b>Asunto:</b> {transfer.referencia}</p>}
          <p><b>Solicitado por:</b> {transfer.solicitadoPor} · {fechaFmt(transfer.solicitadoEn)}</p>
          {transfer.despachadoEn && <p><b>Despachado el:</b> {fechaFmt(transfer.despachadoEn)}</p>}
          {transfer.recibidoEn && <p><b>Recibido el:</b> {fechaFmt(transfer.recibidoEn)}</p>}
          {transfer.nota && <p><b>Nota:</b> {transfer.nota}</p>}
        </section>

        {mode === 'picking' && <PickingTable lines={transfer.lines} identifiers={identifiersByProduct} />}
        {mode === 'guia' && <GuiaTable lines={transfer.lines} identifiers={identifiersByProduct} />}
        {(mode === 'constancia' || mode === 'cerrado') && <ConstanciaTable lines={transfer.lines} identifiers={identifiersByProduct} />}
        <p className="doc-items-summary">{transfer.lines.length} productos · Cantidades según la presentación indicada. — = cantidad sin registrar.</p>

        {mode === 'guia' && (
          <>
            {lineasIncompletas && <p className="doc-footer-note-alert">* Las líneas marcadas se despacharon incompletas.</p>}
            <div className="doc-signatures">
              <div><span>Despachado por</span><strong>{transfer.despachadoPor || ' '}</strong></div>
              <div><span>Recibido por</span><strong>{' '}</strong></div>
            </div>
          </>
        )}
        {mode === 'constancia' && (
          <div className="doc-signatures">
            <div><span>Solicitó</span><strong>{transfer.solicitadoPor}</strong><small>{fechaFmt(transfer.solicitadoEn)}</small></div>
            <div><span>Despachó</span><strong>{transfer.despachadoPor || '—'}</strong><small>{fechaFmt(transfer.despachadoEn)}</small></div>
            <div><span>Recibió</span><strong>{transfer.recibidoPor || '—'}</strong><small>{fechaFmt(transfer.recibidoEn)}</small></div>
          </div>
        )}
      </div>
      <p className="print-header-footer-hint">Si el PDF sale con fecha y URL arriba/abajo, es el encabezado que agrega el navegador — desactivalo en el diálogo de impresión, en "Más ajustes" → "Encabezados y pies de página".</p>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={() => window.print()}><FileDown /> Guardar PDF</button>
        <button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button>
      </footer>
    </Modal>
  )
}

// Hoja de picking (SOLICITADO): sin precios, sin despachado/recibido (todavía no
// existen — una columna vacía invita a llenarla a mano y después no cargarla). El
// checkbox es un cuadrito impreso, no un input: quien junta va marcando en el papel.
function PickingTable({ lines, identifiers }: { lines: TransferLine[]; identifiers: Record<string, LineIdentifiers> }) {
  return (
    <table className="doc-table">
      <DocumentTableColumns widths={[4, 4, 44, 18, 17, 13]} />
      <thead><tr><th aria-label="Marcar"></th><th>Nº</th><th>Descripción</th><th>Presentación</th><th>Cantidad</th><th>Equivalencia</th></tr></thead>
      <tbody>
        {lines.map((line, index) => {
          const factor = factorFor(line)
          const hasEquivalence = factor !== 1 && !!line.presentacionNombre
          return (
            <tr key={line.id}>
              <td><span className="print-checkbox" /></td>
              <td>{index + 1}</td>
              <td>{line.name}<LineIdentifiersRow identifiers={identifiers[line.productId]} /></td>
              <td>{line.presentacionNombre ?? 'Unidad'}</td>
              <td className="doc-picking-qty">{formatQty(line.cantidadBase, factor, line.presentacionNombre)}</td>
              <td className="doc-equivalence">{hasEquivalence ? `${fmtQty(line.cantidadBase)} u` : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Guía de despacho (EN_TRANSITO): el papel que viaja con la mercadería. Las líneas
// despachadas incompletas (cantidadDespachada < cantidadBase) se marcan con un
// asterisco — quien recibe tiene que poder detectar el faltante sin comparar contra
// otro papel.
function GuiaTable({ lines, identifiers }: { lines: TransferLine[]; identifiers: Record<string, LineIdentifiers> }) {
  return (
    <table className="doc-table">
      <DocumentTableColumns widths={[4, 46, 18, 16, 16]} />
      <thead><tr><th>Nº</th><th>Descripción</th><th>Presentación</th><th>Solicitado</th><th>Despachado</th></tr></thead>
      <tbody>
        {lines.map((line, index) => {
          const factor = factorFor(line)
          const despachada = line.cantidadDespachada
          const incompleta = despachada != null && despachada < line.cantidadBase
          return (
            <tr key={line.id} className={incompleta ? 'doc-line-incompleta' : undefined}>
              <td>{index + 1}</td>
              <td>{line.name}<LineIdentifiersRow identifiers={identifiers[line.productId]} /></td>
              <td>{line.presentacionNombre ?? 'Unidad'}</td>
              <td>{formatQty(line.cantidadBase, factor, line.presentacionNombre)}</td>
              <td>{despachada == null ? '—' : formatQty(despachada, factor, line.presentacionNombre)}{incompleta && ' *'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// Constancia de recepción (RECIBIDO y estados cerrados): la columna Dif. solo se llena
// cuando hay diferencia entre lo despachado y lo recibido, y va resaltada.
function ConstanciaTable({ lines, identifiers }: { lines: TransferLine[]; identifiers: Record<string, LineIdentifiers> }) {
  return (
    <table className="doc-table">
      <DocumentTableColumns widths={[4, 32, 16, 12, 12, 12, 12]} />
      <thead><tr><th>Nº</th><th>Descripción</th><th>Presentación</th><th>Solicitado</th><th>Despachado</th><th>Recibido</th><th>Dif.</th></tr></thead>
      <tbody>
        {lines.map((line, index) => {
          const factor = factorFor(line)
          const despachada = line.cantidadDespachada
          const recibida = line.cantidadRecibida
          const diff = despachada != null && recibida != null ? recibida - despachada : null
          const diffSign = diff != null && diff > 0 ? '+' : diff != null && diff < 0 ? '−' : ''
          return (
            <tr key={line.id}>
              <td>{index + 1}</td>
              <td>{line.name}<LineIdentifiersRow identifiers={identifiers[line.productId]} /></td>
              <td>{line.presentacionNombre ?? 'Unidad'}</td>
              <td>{formatQty(line.cantidadBase, factor, line.presentacionNombre)}</td>
              <td>{despachada != null ? formatQty(despachada, factor, line.presentacionNombre) : '—'}</td>
              <td>{recibida != null ? formatQty(recibida, factor, line.presentacionNombre) : '—'}</td>
              <td className={diff != null && diff !== 0 ? 'doc-diff-flag' : undefined}>{diff == null ? '—' : diff !== 0 ? `${diffSign}${formatQty(Math.abs(diff), factor, line.presentacionNombre)}` : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
