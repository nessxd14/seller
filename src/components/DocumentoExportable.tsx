import { useEffect, useState, type ImgHTMLAttributes, type Ref } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { CustomerRecord, WorkflowLine } from '../application/shared/models'
import { customerService, listLineIdentifiers } from '../infrastructure/services'
import { formatMoney, money } from '../domain/common/money'
import { Modal } from './Modal'
import { empresaStore as empresa, loadEmpresaConfig } from '../config/empresaStore'
import { LineIdentifiersRow, type LineIdentifiers } from './LineIdentifiersRow'
import { nombreArchivoDocumento } from '../domain/documents/nombreArchivoDocumento'
import { qrContentForNotaEntrega, qrContentForPedido } from '../domain/documents/qrContent'
import { DocQr } from './DocQr'
import { featureFlags } from '../config/featureFlags'
import { resolveNombrePorEmail } from '../infrastructure/supabase/PerfilRepository.supabase'
import { readDefaultDocPrintFormat, type DocPrintFormat } from './docPrintFormat'
import { formatQtyWithUnit } from '../domain/sales/unitOfMeasure'
import { DocumentPrintPages, DocumentTableColumns } from './DocumentPrintPages'
import { DocumentPrintDetails, DocumentRecipient } from './DocumentPrintDetails'
import { docPrintDetailsKey, readDocPrintDetails, saveDocPrintDetails, type DocPrintDetails } from './docPrintDetails'
import { documentLineProgress, formatDocumentDate, formatDocumentQuantity as qty, isInactiveDocumentLine } from '../domain/documents/documentProgress'

export interface ExportableDoc {
  number: string
  customerId?: string
  customerName: string
  channel: string
  lines: WorkflowLine[]
  validUntil?: string
  conditionPago?: string
  medioPago?: string
  asunto?: string
  documentDate?: string
  createdAt?: string
  status?: string
  solicitanteNombre?: string
  terms?: string
  notes?: string
  subtotalCents?: number
  totalCents?: number
  /** Descuento general del encabezado, en centavos. Ausente = sin descuento. */
  generalDiscountCents?: number
  // Brief T3: número real (COT-2026-XXXXX) de la cotización de origen, cuando el pedido
  // nació de una conversión. Se imprime debajo del número principal, más chico.
  sourceQuoteNumber?: string
  // Brief "documentos diferenciados": email de quien creó/gestiona el documento — se
  // muestra como "Asesor" en cotización y pedido (mismo dato que AutoriaBadge resuelve).
  creadoPor?: string
  // Pedido de origen del QR. La referencia manual de una entrega no crea un ID de salida.
  orderId?: string
  // Brief "documentos diferenciados": número del pedido de origen de esta nota de
  // entrega (meta "Origen"). Solo aplica a mode 'nota-entrega'.
  originOrderNumber?: string
  // Valor inicial para el formulario local de impresión.
  bultos?: string
}

// Brief S-E: condición (CONTADO/CREDITO) y medio de pago (cómo se paga) son dos ejes
// separados desde acá en más — antes un solo campo condicion_pago mezclaba ambos.
const conditionPagoLabel: Record<string, string> = {
  CONTADO: 'Contado',
  CREDITO: 'Crédito',
}
const medioPagoLabel: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  QR: 'QR',
  TRANSFERENCIA: 'Transferencia',
  SIGEP: 'SIGEP',
  CHEQUE: 'Cheque',
  DEPOSITO: 'Depósito',
}

const lineTotalCents = (line: WorkflowLine) => Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000)

const formatFecha = (date: Date) => date.toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', day: '2-digit', month: '2-digit', year: 'numeric' })

type PedidoLine = WorkflowLine

const lineaEstadoPedido = (line: PedidoLine): string => {
  if (line.lineStatus === 'CAMBIADA') return line.replacedByName ? `Cambiada → ${line.replacedByName}` : 'Cambiada'
  if (line.lineStatus === 'RECHAZADO') return 'Rechazada'
  if (line.lineStatus === 'RETIRADA') return 'Retirada'
  if (line.lineStatus === 'COMPRADO_DIRECTO') return 'Entrega directa'
  const { dispatched, pending } = documentLineProgress(line)
  if (dispatched == null) return 'Sin confirmar'
  if (dispatched <= 0) return 'Pendiente'
  if (pending === 0) return 'Despachado'
  return 'Entrega parcial'
}

const statusLabels: Record<string, string> = { draft: 'Borrador', sent: 'Enviada', negotiating: 'En negociación', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Vencida', converted: 'Convertida a pedido', confirmed: 'Abierto', awaiting_stock: 'Esperando productos', reserved: 'Reservado', preparing: 'En preparación', ready: 'Listo para despachar', dispatched: 'Despachado', delivered: 'Completado', cancelled: 'Cancelado' }

function DocPurpose({ doc, mode }: { doc: ExportableDoc; mode: 'cotizacion' | 'pedido' | 'nota-entrega' }) {
  return <div className={`doc-purpose ${doc.status === 'cancelled' ? 'doc-purpose-alert' : ''}`}>
    <span>{mode === 'cotizacion' ? 'Propuesta comercial' : mode === 'pedido' ? 'Seguimiento de productos y entregas' : 'Registro manual · completar cantidades y firmas de esta entrega'}</span>
    {mode !== 'nota-entrega' && doc.status && <b>{statusLabels[doc.status] ?? doc.status}</b>}
  </div>
}

function DocObservations({ values }: { values: DocPrintDetails }) {
  return values.observations ? <div className="doc-written-notes"><b>Observaciones</b><p>{values.observations}</p></div> : null
}

/** <img> que se oculta solo mientras el `src` que falló siga siendo el actual: si más tarde
 * llega una URL firmada nueva, la imagen vuelve a intentarse (un display:none imperativo
 * sobre el nodo la dejaba oculta para siempre). */
function SafeImg({ src, alt, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [broken, setBroken] = useState<string | null>(null)
  if (broken === src) return null
  return <img {...rest} src={src} alt={alt} onError={() => setBroken(src)} />
}

/** Brand + logo, idéntico en los tres documentos. */
function DocBrand() {
  return (
    <div className="doc-brand">
      <SafeImg src={empresa.logoSrc} alt={empresa.razonSocial} />
      <div>
        <b>{empresa.razonSocial}</b>
        <span>{empresa.direccion}</span>
        <span>{empresa.ciudad}</span>
        <span>Cel. {empresa.celular} · {empresa.correo}</span>
        {empresa.nit && <span>NIT: {empresa.nit}</span>}
      </div>
    </div>
  )
}

/** Sello + firma preimpresa (cotización y pedido). La nota de entrega NO usa esto — sus
 * dos firmas son siempre manuscritas en el momento, ver <ManualSigns>. */
function PrintedSignoff() {
  const hasSignature = Boolean(empresa.firmaUrl || empresa.firmaNombre || empresa.firmaCargo)
  if (!hasSignature && !empresa.selloUrl) return null
  return (
    <div className="doc-signoff">
      <div className={`doc-signoff-stamp ${!hasSignature ? 'doc-stamp-alone' : ''}`}>
        {empresa.firmaUrl
          ? <SafeImg src={empresa.firmaUrl} alt="Firma" className="doc-firma-img" />
          : hasSignature ? <div className="doc-firma-blank" /> : null}
        {empresa.selloUrl && <SafeImg src={empresa.selloUrl} alt="Sello" className="doc-sello-img" />}
      </div>
      <small className="doc-signoff-label">{hasSignature ? 'Firma / autorización comercial' : 'Sello de la empresa'}</small>
      {(empresa.firmaNombre || empresa.firmaCargo) && (
        <p className="doc-signoff-name">{[empresa.firmaNombre, empresa.firmaCargo].filter(Boolean).join(' · ')}</p>
      )}
    </div>
  )
}

/**
 * Print/export document, parameterized for three modes que ahora son layouts
 * genuinamente distintos (antes compartían tabla y footer, cambiando solo un puñado de
 * columnas — ver brief "Rediseño de documentos exportables"):
 * - 'cotizacion': layout de siempre (precios, descuentos, totales, vigencia/condición/
 *   medio de pago, firma y sello preimpresos), con el mismo lenguaje visual que los
 *   otros dos (metadatos .doc-kv, tabla sin bordes de celda).
 * - 'pedido': igual que cotización más QR, estado por línea y la leyenda de "documento
 *   interno de seguimiento". El bloque de tandas de despacho de la maqueta (prueba_
 *   impresion_documentos.html) NO se implementó: no hay dato de tanda_de_id ni de
 *   pedidos hijos disponible en el frontend hoy — el brief pide parar y reportar antes
 *   de inventar una query nueva en vez de armar el bloque con datos falsos.
 * - 'nota-entrega': sin precios ni totales — es el papel que acompaña la mercadería.
 *   Agrega QR, paginado real ("Página N de M", crítico para poder exigir todas las
 *   fotos por Telegram), casillas C/P/N/R, motivo por línea y firmas manuscritas.
 */
export function DocumentoExportable({ doc, mode, onClose }: { doc: ExportableDoc; mode: 'cotizacion' | 'nota-entrega' | 'pedido'; onClose: () => void }) {
  return <ExportableDocument key={JSON.stringify([mode, doc.number, doc.customerId])} doc={doc} mode={mode} onClose={onClose} />
}

function ExportableDocument({ doc: sourceDoc, mode, onClose }: { doc: ExportableDoc; mode: 'cotizacion' | 'nota-entrega' | 'pedido'; onClose: () => void }) {
  const doc = { ...sourceDoc, documentDate: formatDocumentDate(sourceDoc.documentDate ?? sourceDoc.createdAt) }
  // Brief S-A: "Vista de cliente" (default) muestra doc.lines en una sola lista plana, sin
  // separar ítems especiales ni encabezados de sección — pensada para mandarle al cliente.
  // "Vista de empresa" es el comportamiento de siempre (catalogLines/customLines separados).
  // Solo aplica a cotización; sin persistencia, siempre arranca en Cliente al abrir el modal.
  const [vistaCliente, setVistaCliente] = useState(true)
  const [customerDoc, setCustomerDoc] = useState('')
  const [customerInfo, setCustomerInfo] = useState<CustomerRecord | null>(null)
  const detailsKey = docPrintDetailsKey(mode, doc.number, doc.customerId)
  const [overrides, setOverrides] = useState<Partial<DocPrintDetails>>(() => readDocPrintDetails(detailsKey))
  const [saveMessage, setSaveMessage] = useState('')
  const details: DocPrintDetails = {
    address: overrides.address ?? customerInfo?.address ?? '', contact: overrides.contact ?? doc.solicitanteNombre ?? '',
    phone: overrides.phone ?? customerInfo?.phone ?? '', leadTime: overrides.leadTime ?? '',
    bultos: overrides.bultos ?? doc.bultos ?? '', carrier: overrides.carrier ?? '', plate: overrides.plate ?? '',
    observations: overrides.observations ?? doc.notes ?? '', deliveryReference: overrides.deliveryReference ?? '',
  }
  const changeDetail = (field: keyof DocPrintDetails, value: string) => { setOverrides((previous) => ({ ...previous, [field]: value })); setSaveMessage('') }
  // Datos manuales por documento: se guardan localmente solo al pulsar Guardar.
  const bultos = details.bultos
  const setBultos = (value: string) => changeDetail('bultos', value)
  const [asesorNombre, setAsesorNombre] = useState(doc.creadoPor ?? '')
  // La impresión se identifica aparte de la fecha de creación del pedido.
  const [printedAt] = useState(() => new Date())
  // Brief "Correcciones de impresión" Parte 3: rollo 80mm para cotización y nota de
  // entrega — el pedido se queda en carta (documento de consulta interna, se lee mejor en
  // hoja completa). Arranca en el default de Configuración > Impresión.
  const [docFormat, setDocFormat] = useState<DocPrintFormat>(readDefaultDocPrintFormat)
  const supportsRollo = mode === 'cotizacion' || mode === 'nota-entrega'
  const isRoll = supportsRollo && docFormat === 'rollo-80'
  // loadEmpresaConfig solo muta el store: el contador fuerza el re-render con las URLs firmadas
  // (sello/firma) recién obtenidas, en vez de dibujar la primera vez con las que vencieron.
  const [, setEmpresaVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    void loadEmpresaConfig().then(() => { if (!cancelled) setEmpresaVersion((version) => version + 1) })
    return () => { cancelled = true }
  }, [])
  const [printing, setPrinting] = useState(false)
  // Imprimir antes de que carguen logo/firma/sello/QR deja huecos en el papel.
  const printWhenReady = async () => {
    setPrinting(true)
    try {
      const images = Array.from(document.querySelectorAll<HTMLImageElement>('.print-document img'))
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)))
    } finally {
      setPrinting(false)
    }
    window.print()
  }
  // Rollo 80 mm: el largo de la hoja es el del contenido renderizado (rollo continuo).
  const [rollElement, setRollElement] = useState<HTMLDivElement | null>(null)
  const [rollHeightMm, setRollHeightMm] = useState(0)
  useEffect(() => {
    if (!rollElement || typeof ResizeObserver === 'undefined') return
    const measure = () => setRollHeightMm(Math.ceil(rollElement.offsetHeight * 25.4 / 96))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(rollElement)
    return () => observer.disconnect()
  }, [rollElement])
  useEffect(() => {
    let cancelled = false
    const lookup = doc.customerId ? customerService.getById(doc.customerId) : customerService.list().then((customers) => {
      const matches = customers.filter((c) => c.name === doc.customerName)
      return matches.length === 1 ? matches[0] : null
    })
    void lookup.then((match) => {
      if (!cancelled && match) { setCustomerDoc(match.document); setCustomerInfo(match) }
    }).catch(() => { /* El documento sigue disponible con los datos de su cabecera. */ })
    return () => { cancelled = true }
  }, [doc.customerId, doc.customerName])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el nombre mostrado con el email que llega por prop (mismo patrón que AutoriaBadge), no hay nada async que esperar en estos dos casos
    if (!doc.creadoPor) { setAsesorNombre(''); return }
    if (!featureFlags.supabase) { setAsesorNombre(doc.creadoPor); return }
    let cancelled = false
    void resolveNombrePorEmail(doc.creadoPor).then((resolved) => { if (!cancelled) setAsesorNombre(resolved) })
    return () => { cancelled = true }
  }, [doc.creadoPor])

  // Item 2.2: batch-fetch barra/fábrica/marca for every catalog line's product in one call
  // when the document loads, not one lookup per rendered row.
  const [identifiersByProduct, setIdentifiersByProduct] = useState<Record<string, LineIdentifiers>>({})
  useEffect(() => {
    const ids = Array.from(new Set(doc.lines.filter((line) => !line.isCustomItem && line.productId).map((line) => line.productId)))
    if (!ids.length) return
    void listLineIdentifiers(ids).then(setIdentifiersByProduct)
  }, [doc.lines])

  // TAREA 5 (T1): window.print() no tiene otra forma de nombrar el archivo que sugiere
  // Chrome al "Guardar como PDF" — solo document.title en el momento de imprimir. Se
  // restaura en el cleanup para que no quede pegado si el modal se desmonta con el
  // diálogo de impresión todavía abierto.
  useEffect(() => {
    const previousTitle = document.title
    document.title = nombreArchivoDocumento(doc.number, doc.customerName)
    return () => { document.title = previousTitle }
  }, [doc.number, doc.customerName])

  const modalTitle = mode === 'cotizacion' ? 'Vista previa de cotización' : mode === 'pedido' ? 'Vista previa de pedido' : 'Vista previa de nota de entrega'

  return (
    <Modal title={modalTitle} subtitle={empresa.razonSocial} onClose={onClose} wide>
      {isRoll && rollHeightMm > 0 && <style>{`@media print { @page pos-roll { size: 80mm ${rollHeightMm + 12}mm; margin: 0 } }`}</style>}
      <DocumentPrintPages number={mode === 'nota-entrega' ? details.deliveryReference || `Pedido ${doc.number}` : doc.number} lineCount={doc.lines.filter((line) => mode !== 'nota-entrega' || !isInactiveDocumentLine(line)).length} />
      <DocumentPrintDetails mode={mode} values={details} onChange={changeDetail} onSave={() => setSaveMessage(saveDocPrintDetails(detailsKey, details) ? 'Datos guardados en este navegador.' : 'No se pudieron guardar. Puedes imprimir los datos actuales.')} message={saveMessage} />
      {(mode === 'cotizacion' || supportsRollo) && (
        <div className="doc-view-toggle">
          {mode === 'cotizacion' && (
            <label>
              <input type="checkbox" checked={vistaCliente} onChange={(e) => setVistaCliente(e.target.checked)} />
              Vista de cliente
            </label>
          )}
          {supportsRollo && (
            <label className="doc-format-select">
              Formato
              <select value={docFormat} onChange={(e) => setDocFormat(e.target.value as DocPrintFormat)}>
                <option value="carta">Carta</option>
                <option value="rollo-80">Rollo 80 mm</option>
              </select>
            </label>
          )}
        </div>
      )}
      {mode === 'cotizacion' && <CotizacionDoc doc={doc} details={details} vistaCliente={vistaCliente} customerDoc={customerDoc} asesorNombre={asesorNombre} identifiersByProduct={identifiersByProduct} format={docFormat} rollRef={setRollElement} />}
      {mode === 'pedido' && <PedidoDoc doc={doc} details={details} customerDoc={customerDoc} asesorNombre={asesorNombre} identifiersByProduct={identifiersByProduct} />}
      {mode === 'nota-entrega' && (
        <NotaEntregaDoc
          doc={doc}
          details={details}
          customerDoc={customerDoc}
          bultos={bultos}
          onBultosChange={setBultos}
          printedAt={printedAt}
          identifiersByProduct={identifiersByProduct}
          format={docFormat}
          rollRef={setRollElement}
        />
      )}
      <p className="print-header-footer-hint">Si el PDF sale con fecha y URL arriba/abajo, es el encabezado que agrega el navegador — desactivalo en el diálogo de impresión, en "Más ajustes" → "Encabezados y pies de página".</p>
      <footer className="modal-actions">
        <button className="secondary-button" disabled={printing} onClick={() => void printWhenReady()}><FileDown /> Guardar PDF</button>
        <button className="primary-button" disabled={printing} onClick={() => void printWhenReady()}><Printer /> Imprimir</button>
      </footer>
    </Modal>
  )
}

// ============================== COTIZACIÓN ==============================
// Mismo contenido de siempre (precios, descuentos, vigencia/condición/medio de pago,
// maskName, ítems especiales, vista de cliente, firma/sello preimpresos) — lo único que
// cambia es el lenguaje visual, para que la cotización se lea como parte de la misma
// familia que pedido y nota de entrega (ver brief, sección 3).
function CotizacionDoc({ doc, details, vistaCliente, customerDoc, asesorNombre, identifiersByProduct, format, rollRef }: {
  doc: ExportableDoc
  details: DocPrintDetails
  vistaCliente: boolean
  customerDoc: string
  asesorNombre: string
  identifiersByProduct: Record<string, LineIdentifiers>
  format: DocPrintFormat
  rollRef: Ref<HTMLDivElement>
}) {
  const catalogLines = doc.lines.filter((line) => !line.isCustomItem)
  const customLines = doc.lines.filter((line) => line.isCustomItem)
  const primaryLines = vistaCliente ? doc.lines : catalogLines
  const subtotalCents = doc.subtotalCents ?? doc.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)

  if (format === 'rollo-80') {
    return <CotizacionRoll doc={doc} details={details} lines={primaryLines} customerDoc={customerDoc} asesorNombre={asesorNombre} subtotalCents={subtotalCents} rollRef={rollRef} />
  }

  // El cierre viaja dentro del <tbody> de la última fila: así nunca queda una hoja con solo
  // firma/observaciones. Con ítems especiales debajo de la tabla, el cierre va al final.
  const attachClosing = primaryLines.length > 0 && (vistaCliente || customLines.length === 0)
  const renderRow = (line: WorkflowLine, index: number) => {
        const factor = line.factorUnidadBase ?? 1
        const hasEquivalence = factor !== 1
        const displayName = line.maskName ?? line.name
        return (
          <tr key={line.id}>
            <td>{index + 1}</td>
            <td>{displayName}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} />{line.note && <small className="doc-line-note">{line.note}</small>}</td>
            <td>{line.presentacionNombre ?? (line.isCustomItem ? line.unitOfMeasure : undefined) ?? 'Unidad'}</td>
            <td>{line.quantity}</td>
            <td className="doc-equivalence">{hasEquivalence ? `${line.quantity * factor} u` : '—'}</td>
            <td>{formatMoney(money(line.unitPriceCents))}</td>
            <td>{(line.discountBasisPoints / 100).toFixed(1)}%</td>
            <td>{formatMoney(money(lineTotalCents(line)))}</td>
          </tr>
        )
  }

  const closing = (
  <div className="doc-commercial-closing">
    <footer className="doc-totals">
      <div className="doc-total-row"><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
      {Boolean(doc.generalDiscountCents) && (
        <div className="doc-total-row"><span>Descuento general</span><strong>−{formatMoney(money(doc.generalDiscountCents ?? 0))}</strong></div>
      )}
      <div className="doc-total-row doc-total-line"><span>Total</span><strong>{formatMoney(money(doc.totalCents ?? Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))))}</strong></div>
    </footer>
    {(doc.validUntil || doc.conditionPago || doc.medioPago) && (
      <div className="doc-footer-notes">
        {doc.validUntil && <span>Vigencia: {doc.validUntil}</span>}
        {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
        {doc.medioPago && <span>Medio de pago: {medioPagoLabel[doc.medioPago] ?? doc.medioPago}</span>}
      </div>
    )}
    {doc.terms && <div className="doc-written-notes"><b>Condiciones comerciales</b><p>{doc.terms}</p></div>}
    <DocObservations values={details} />
    <PrintedSignoff />
  </div>
  )

  return (
    <div className="print-document documento-exportable quote-a4">
      <div className="doc-page">
        <DocPurpose doc={doc} mode="cotizacion" />
        <header>
          <DocBrand />
          <div className="doc-id-block">
            <strong>COTIZACIÓN</strong>
            <span className="doc-number-mono">{doc.number}</span>
          </div>
        </header>
        <section className="doc-kv-grid">
          <div className="doc-kv"><div className="k">Cliente</div><div className="v">{doc.customerName}{customerDoc && ` · ${customerDoc}`}</div></div>
          {doc.documentDate && <div className="doc-kv"><div className="k">Fecha</div><div className="v">{doc.documentDate}</div></div>}
          <div className="doc-kv"><div className="k">Canal</div><div className="v">{doc.channel}</div></div>
          {doc.asunto && <div className="doc-kv doc-kv-span2"><div className="k">Asunto</div><div className="v">{doc.asunto}</div></div>}
          {asesorNombre && <div className="doc-kv"><div className="k">Asesor</div><div className="v">{asesorNombre}</div></div>}
        </section>
        <DocumentRecipient values={details} showLeadTime />
        <table className="doc-table">
          <DocumentTableColumns widths={[4, 39, 10, 6, 8, 12, 8, 13]} />
          <thead>
            <tr><th>Nº</th><th>Descripción</th><th>Medida</th><th>Cant</th><th>Equiv.</th><th>P/U</th><th>Desc.</th><th>Total</th></tr>
          </thead>
          <tbody>
            {primaryLines.map((line, index) => (attachClosing && index === primaryLines.length - 1 ? null : renderRow(line, index)))}
          </tbody>
          {attachClosing && (
            <tbody className="doc-last-rows">
              {renderRow(primaryLines[primaryLines.length - 1], primaryLines.length - 1)}
              <tr className="doc-closing-row"><td colSpan={8}>{closing}</td></tr>
            </tbody>
          )}
        </table>
        {!vistaCliente && customLines.length > 0 && (
          <div className="doc-custom-block">
            <h4>Ítems especiales / a pedido</h4>
            <table className="doc-table">
              <thead><tr><th>Descripción</th><th>Cant</th><th>P/U</th><th>Total</th></tr></thead>
              <tbody>
                {customLines.map((line) => (
                  <tr key={line.id}><td>{line.name}<LineIdentifiersRow isCustomItem /></td><td>{formatQtyWithUnit(line.quantity, line.unitOfMeasure)}</td><td>{formatMoney(money(line.unitPriceCents))}</td><td>{formatMoney(money(lineTotalCents(line)))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!attachClosing && closing}
      </div>
    </div>
  )
}

// ============================== PEDIDO ==============================
// Extiende el layout de cotización: mantiene precios/totales/condición/medio de pago,
// agrega QR, estado por línea (incluye líneas CAMBIADA, antes invisibles) y la leyenda
// de "documento interno de seguimiento". El bloque de "Estado de despacho" por tandas de
// la maqueta se dejó afuera — ver el comentario grande en DocumentoExportable de más
// arriba, no hay tanda_de_id ni pedidos hijos disponibles en el frontend todavía.
function PedidoDoc({ doc, details, customerDoc, asesorNombre, identifiersByProduct }: {
  doc: ExportableDoc
  details: DocPrintDetails
  customerDoc: string
  asesorNombre: string
  identifiersByProduct: Record<string, LineIdentifiers>
}) {
  const active = doc.lines.filter((line) => !isInactiveDocumentLine(line))
  const pending = active.filter((line) => (documentLineProgress(line).pending ?? 0) > 0).length
  const unknown = active.filter((line) => documentLineProgress(line).dispatched == null).length
  const subtotalCents = doc.subtotalCents ?? active.reduce((sum, line) => sum + lineTotalCents(line), 0)
  const renderRow = (line: PedidoLine, index: number) => {
        const inactive = isInactiveDocumentLine(line)
        const progress = documentLineProgress(line)
        return <tr key={line.id} className={inactive ? 'doc-line-status-cambiada' : undefined}>
          <td>{index + 1}</td>
          <td>{line.maskName ?? line.name}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} />
            <small className="doc-line-state">{lineaEstadoPedido(line)}</small>{line.note && <small className="doc-line-note">{line.note}</small>}
          </td>
          <td>{line.presentacionNombre ?? (line.isCustomItem ? line.unitOfMeasure : undefined) ?? 'Unidad'}{(line.factorUnidadBase ?? 1) !== 1 && <small className="doc-line-note">1 = {qty(line.factorUnidadBase!)} u</small>}</td>
          <td>{qty(line.quantity)}</td>
          <td>{inactive || progress.dispatched == null ? '—' : qty(progress.dispatched)}</td>
          <td>{inactive || progress.pending == null ? '—' : qty(progress.pending)}</td>
          <td>{inactive ? '—' : formatMoney(money(line.unitPriceCents))}{!inactive && line.discountBasisPoints > 0 && <small className="doc-line-note">Desc. {(line.discountBasisPoints / 100).toFixed(1)}%</small>}</td>
          <td>{inactive ? '—' : formatMoney(money(lineTotalCents(line)))}</td>
        </tr>
  }
  const closing = (
    <div className="doc-commercial-closing">
      <footer className="doc-totals">
        <div className="doc-total-row"><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
        {Boolean(doc.generalDiscountCents) && <div className="doc-total-row"><span>Descuento general</span><strong>−{formatMoney(money(doc.generalDiscountCents ?? 0))}</strong></div>}
        <div className="doc-total-row doc-total-line"><span>Total</span><strong>{formatMoney(money(doc.totalCents ?? Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))))}</strong></div>
      </footer>
      {(doc.conditionPago || doc.medioPago) && <div className="doc-footer-notes">
        {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
        {doc.medioPago && <span>Medio de pago: {medioPagoLabel[doc.medioPago] ?? doc.medioPago}</span>}
      </div>}
      <DocObservations values={details} />
      <p className="doc-disclaimer">Documento interno de seguimiento. Las cantidades despachadas son acumuladas del pedido.<br />La recepción se registra con las cantidades y firmas de cada entrega.</p>
      <PrintedSignoff />
    </div>
  )
  return <div className="print-document documento-exportable order-a4">
    <div className="doc-page">
      <DocPurpose doc={doc} mode="pedido" />
      <header>
        <DocBrand />
        <div className="doc-id-block-with-qr">
          {doc.orderId && <DocQr margin={4} content={qrContentForPedido(doc.orderId)} />}
          <div className="doc-id-block"><strong>PEDIDO</strong><span className="doc-number-mono">{doc.number}</span>
            {doc.sourceQuoteNumber && <small className="doc-number-origin">origen {doc.sourceQuoteNumber}</small>}
          </div>
        </div>
      </header>
      <section className="doc-kv-grid">
        <div className="doc-kv"><div className="k">Cliente</div><div className="v">{doc.customerName}{customerDoc && ' · ' + customerDoc}</div></div>
        {doc.documentDate && <div className="doc-kv"><div className="k">Fecha del pedido</div><div className="v">{doc.documentDate}</div></div>}
        <div className="doc-kv"><div className="k">Canal</div><div className="v">{doc.channel}</div></div>
        {doc.conditionPago && <div className="doc-kv"><div className="k">Condición</div><div className="v">{conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</div></div>}
        {asesorNombre && <div className="doc-kv"><div className="k">Asesor</div><div className="v">{asesorNombre}</div></div>}
        {doc.asunto && <div className="doc-kv"><div className="k">Asunto</div><div className="v">{doc.asunto}</div></div>}
      </section>
      <DocumentRecipient values={details} />
      <p className="doc-items-summary">{active.length} productos vigentes · {pending} con cantidades pendientes{unknown > 0 && ' · ' + unknown + ' sin confirmar despacho'}</p>
      <table className="doc-table doc-order-table">
        <DocumentTableColumns widths={[4, 34, 11, 9, 10, 10, 11, 11]} />
        <thead><tr><th>Nº</th><th>Descripción / estado</th><th>Medida</th><th>Solicitado</th><th>Despachado</th><th>Pendiente</th><th>P/U</th><th>Importe</th></tr></thead>
        <tbody>{doc.lines.map((line, index) => (index === doc.lines.length - 1 ? null : renderRow(line, index)))}</tbody>
        {doc.lines.length > 0 && (
          <tbody className="doc-last-rows">
            {renderRow(doc.lines[doc.lines.length - 1], doc.lines.length - 1)}
            <tr className="doc-closing-row"><td colSpan={8}>{closing}</td></tr>
          </tbody>
        )}
      </table>
      {doc.lines.length === 0 && closing}
    </div>
  </div>
}

// ============================== NOTA DE ENTREGA ==============================
// Rehecha por completo: sin precios ni totales, con paginado real y todos los campos
// operativos que necesita quien despacha/recibe (ver brief, sección 1).
function NotaEntregaDoc({ doc, details, customerDoc, bultos, onBultosChange, printedAt, identifiersByProduct, format, rollRef }: {
  doc: ExportableDoc
  details: DocPrintDetails
  customerDoc: string
  bultos: string
  onBultosChange: (value: string) => void
  printedAt: Date
  identifiersByProduct: Record<string, LineIdentifiers>
  format: DocPrintFormat
  rollRef: Ref<HTMLDivElement>
}) {
  // Brief 1.4: documentDate puede faltar (ver comentario junto a printedAt en el
  // componente padre) — sin esto, la NE imprimía la hora sola, rompiendo la conciliación
  // contra el timestamp de Cation en la verificación de evidencia.
  const fechaMostrada = formatFecha(printedAt)
  const horaMostrada = printedAt.toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false })
  const lines = doc.lines.filter((line) => !isInactiveDocumentLine(line))

  if (format === 'rollo-80') {
    return <NotaEntregaRoll doc={doc} details={details} lines={lines} customerDoc={customerDoc} bultos={bultos} onBultosChange={onBultosChange} fechaMostrada={fechaMostrada} horaMostrada={horaMostrada} identifiersByProduct={identifiersByProduct} rollRef={rollRef} />
  }

  const closing = (
    <div className="doc-delivery-closing">
        <div className="doc-legend">
          C = Completo · P = Parcial · N = No despachado (almacén) · R = Rechazado al recibir<br />
          Equivalencia en unidades base debajo de la cantidad pedida.
        </div>
        <div className="doc-obs">Observaciones de recepción: <span className="doc-fill doc-fill-lg" /></div>
        <div className="doc-obs">Fecha y hora de recepción: <span className="doc-fill" /></div>
        <div className="doc-manual-signs">
          <div className="doc-manual-sign"><div className="doc-manual-sign-line" /><span>Entrega (nombre y firma)</span></div>
          <div className="doc-manual-sign"><div className="doc-manual-sign-line" /><span>Recibe (nombre, CI y firma)</span></div>
          {empresa.selloUrl && (
            <div className="doc-stamp-only">
              <SafeImg src={empresa.selloUrl} alt="Sello" className="doc-sello-img" />
            </div>
          )}
        </div>
        <div className="doc-telegram-note">Fotografiar TODAS las páginas y enviarlas al grupo de Telegram al momento del despacho.</div>
    </div>
  )

  return (
    <div className="print-document documento-exportable delivery-a4">
      <div className="doc-page">
        <DocPurpose doc={doc} mode="nota-entrega" />
        <header>
          <DocBrand />
          <div className="doc-id-block">
            <strong>NOTA DE<br />ENTREGA</strong>
            <span className="doc-number-mono">{details.deliveryReference || `Pedido ${doc.number}`}</span>
          </div>
        </header>
        <section className="doc-kv-grid">
          <div className="doc-kv"><div className="k">Cliente</div><div className="v">{doc.customerName}{customerDoc && ` · ${customerDoc}`}</div></div>
          <div className="doc-kv"><div className="k">Impreso el</div><div className="v">{fechaMostrada} · {horaMostrada}</div></div>
          {details.deliveryReference && doc.originOrderNumber && <div className="doc-kv"><div className="k">Origen</div><div className="v">Pedido {doc.originOrderNumber}</div></div>}
          <div className="doc-kv"><div className="k">Canal</div><div className="v">{doc.channel}</div></div>
          {doc.documentDate && <div className="doc-kv"><div className="k">Fecha del pedido</div><div className="v">{doc.documentDate}</div></div>}
          <div className="doc-kv">
            <div className="k">Bultos</div>
            <div className="v">
              {/* Brief 1.3: el placeholder del input ("Ej. 3 cajas...") se imprimía
                          como si fuera un valor cargado. En @media print el input nunca se
                          pinta — .doc-bultos-print (texto o línea en blanco) lo reemplaza. */}
              <input type="text" value={bultos} onChange={(e) => onBultosChange(e.target.value)} placeholder="Ej. 3 cajas · 1 rollo" className="doc-bultos-input doc-bultos-input-screen" />
              <span className="doc-bultos-print">{bultos ? bultos : <span className="doc-fill doc-fill-sm" />}</span>
            </div>
          </div>
          <div className="doc-kv doc-carrier">
            <div><div className="k">Transportista (opcional)</div><div className="v">{details.carrier || <span className="doc-fill" />}</div></div>
            <div><div className="k">Placa</div><div className="v">{details.plate || <span className="doc-fill" />}</div></div>
          </div>
        </section>
        <DocumentRecipient values={details} />
        <DocObservations values={details} />
        <p className="doc-items-summary">{lines.length} productos · Completar las cantidades entregadas y recibidas en esta salida.</p>
        <table className="doc-table doc-delivery-table">
          <DocumentTableColumns widths={[4, 32, 10, 8, 10, 10, 18, 8]} />
          <thead>
            <tr className="doc-delivery-repeat"><td colSpan={8}>
              <div className="doc-delivery-reference">
                <span>{details.deliveryReference || `Pedido ${doc.number}`} · {doc.customerName}</span>
                {doc.orderId && <DocQr margin={4} content={qrContentForNotaEntrega(doc.orderId, doc.number)} />}
              </div>
            </td></tr>
            <tr>
              <th>Nº</th><th>Descripción</th><th>Medida</th><th>Pedido</th><th>Entregado</th><th>Recibido</th><th>Control</th>
              <th>Origen</th>
            </tr>
          </thead>
          {lines.length === 0 && <tbody className="doc-delivery-item"><tr className="doc-delivery-closing-row"><td colSpan={8}>{closing}</td></tr></tbody>}
          {lines.map((line, i) => {
            const factor = line.factorUnidadBase ?? 1
            const hasEquivalence = factor !== 1
            return (
              <tbody className="doc-delivery-item" key={line.id}>
                <tr>
                  <td>{i + 1}</td>
                  <td>{line.name}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} />{line.note && <small className="doc-line-note">{line.note}</small>}</td>
                  <td>{line.presentacionNombre ?? (line.isCustomItem ? line.unitOfMeasure : undefined) ?? 'Unidad'}</td>
                  <td>{line.quantity}{hasEquivalence && <span className="doc-equivalence line-equivalence">{line.quantity * factor} u</span>}</td>
                  <td><span className="doc-qty-fill" /></td>
                  <td><span className="doc-qty-fill" /></td>
                  <td><div className="doc-result-checks">{['C', 'P', 'N', 'R'].map((label) => <span key={label}><i className="doc-checkbox" />{label}</span>)}</div></td>
                  <td>{line.sourceLocation ?? '—'}</td>
                </tr>
                <tr className="doc-motivo-row">
                  <td></td>
                  <td colSpan={7}>Motivo / diferencia:<span className="doc-motivo-line" /></td>
                </tr>
                {i === lines.length - 1 && <tr className="doc-delivery-closing-row"><td colSpan={8}>{closing}</td></tr>}
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}

// ============================== FORMATO ROLLO (80mm) ==============================
// Brief "Correcciones de impresión de documentos" Parte 3: cotización y nota de entrega
// también en rollo térmico de 80mm — mostrador, sin pasar por la impresora de carta.
// 58mm queda fuera (no entran las cuatro casillas C/P/N/R con un ancho usable) y el
// pedido no lo pide (documento de consulta interna, se lee mejor en carta completa).
// Layout apilado, sin tabla de columnas — ver la maqueta del brief.

/** Cotización en rollo: mismo contenido que la de carta (precios, descuentos, totales,
 * vigencia/condición/medio de pago), apilado en bloques en vez de tabla. Sin QR — mismo
 * criterio que la cotización en carta, todavía no hay un caso de uso claro para uno. */
function CotizacionRoll({ doc, details, lines, customerDoc, asesorNombre, subtotalCents, rollRef }: {
  doc: ExportableDoc
  details: DocPrintDetails
  lines: WorkflowLine[]
  customerDoc: string
  asesorNombre: string
  subtotalCents: number
  rollRef: Ref<HTMLDivElement>
}) {
  const totalCents = doc.totalCents ?? Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))
  return (
    <div className="print-document documento-exportable doc-roll" ref={rollRef}>
      <div className="doc-roll-center">
        <SafeImg src={empresa.logoSrc} alt={empresa.razonSocial} className="doc-roll-logo" />
        <div className="doc-roll-line"><b>{empresa.razonSocial}</b></div>
        <div className="doc-roll-line">{empresa.direccion}</div>
      </div>
      <div className="doc-roll-rule" />
      <div className="doc-roll-center">
        <div className="doc-roll-line"><b>COTIZACIÓN</b></div>
        <div className="doc-roll-line">{doc.number}</div>
        {doc.documentDate && <div className="doc-roll-line">{doc.documentDate}</div>}
      </div>
      <div className="doc-roll-rule" />
      <div className="doc-roll-line">Cliente: {doc.customerName}{customerDoc && ` · ${customerDoc}`}</div>
      <div className="doc-roll-line">Canal: {doc.channel}</div>
      {doc.asunto && <div className="doc-roll-line">Asunto: {doc.asunto}</div>}
      {asesorNombre && <div className="doc-roll-line">Asesor: {asesorNombre}</div>}
      {details.address && <div className="doc-roll-line">Entrega: {details.address}</div>}
      {(details.contact || details.phone) && <div className="doc-roll-line">Contacto: {[details.contact, details.phone].filter(Boolean).join(' · ')}</div>}
      {details.leadTime && <div className="doc-roll-line">Plazo de entrega: {details.leadTime}</div>}
      <div className="doc-roll-rule" />
      {lines.map((line, index) => {
        const displayName = line.maskName ?? line.name
        return (
          <div className="doc-roll-item" key={line.id}>
            <div className="doc-roll-line">{index + 1}. {displayName.toUpperCase()}</div>
            <div className="doc-roll-line">{line.isCustomItem ? `${formatQtyWithUnit(line.quantity, line.unitOfMeasure)}` : `${line.presentacionNombre ?? 'Unidad'} × ${line.quantity}`}</div>
            <div className="doc-roll-line">P/U {formatMoney(money(line.unitPriceCents))} · Desc {(line.discountBasisPoints / 100).toFixed(1)}%</div>
            <div className="doc-roll-line"><b>Total {formatMoney(money(lineTotalCents(line)))}</b></div>
            <div className="doc-roll-rule" />
          </div>
        )
      })}
      <div className="doc-roll-line">Subtotal: {formatMoney(money(subtotalCents))}</div>
      {Boolean(doc.generalDiscountCents) && <div className="doc-roll-line">Descuento general: −{formatMoney(money(doc.generalDiscountCents ?? 0))}</div>}
      <div className="doc-roll-line doc-roll-total"><b>TOTAL: {formatMoney(money(totalCents))}</b></div>
      {(doc.validUntil || doc.conditionPago || doc.medioPago) && (
        <>
          <div className="doc-roll-rule" />
          {doc.validUntil && <div className="doc-roll-line">Vigencia: {doc.validUntil}</div>}
          {doc.conditionPago && <div className="doc-roll-line">Condición: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</div>}
          {doc.medioPago && <div className="doc-roll-line">Medio de pago: {medioPagoLabel[doc.medioPago] ?? doc.medioPago}</div>}
        </>
      )}
      {doc.terms && <div className="doc-roll-line">Condiciones: {doc.terms}</div>}
      {details.observations && <div className="doc-roll-line">Observaciones: {details.observations}</div>}
    </div>
  )
}

/** Nota de entrega en rollo: sin paginado — el rollo es continuo. Lleva el mismo QR y los
 * mismos campos operativos que la versión de carta (bultos, transportista/placa, C/P/N/R,
 * motivo, firmas manuscritas), apilados en vez de en tabla. El marcador "— FIN —" es lo
 * que reemplaza al paginado acá: sin él, una tira larga reintroduce exactamente el
 * problema que el paginado resuelve en carta — el agente de Telegram no tendría forma de
 * saber si la última foto llega al final del rollo o si falta más. */
function NotaEntregaRoll({ doc, details, lines, customerDoc, bultos, onBultosChange, fechaMostrada, horaMostrada, identifiersByProduct, rollRef }: {
  doc: ExportableDoc
  details: DocPrintDetails
  lines: WorkflowLine[]
  customerDoc: string
  bultos: string
  onBultosChange: (value: string) => void
  fechaMostrada: string
  horaMostrada: string
  identifiersByProduct: Record<string, LineIdentifiers>
  rollRef: Ref<HTMLDivElement>
}) {
  return (
    <div className="print-document documento-exportable doc-roll" ref={rollRef}>
      <div className="doc-roll-center">
        <SafeImg src={empresa.logoSrc} alt={empresa.razonSocial} className="doc-roll-logo" />
        <div className="doc-roll-line"><b>{empresa.razonSocial}</b></div>
        <div className="doc-roll-line">{empresa.direccion}</div>
      </div>
      {doc.orderId && <div className="doc-roll-center"><DocQr margin={4} content={qrContentForNotaEntrega(doc.orderId, doc.number)} className="doc-roll-qr" /></div>}
      <div className="doc-roll-center">
        <div className="doc-roll-line"><b>NOTA DE ENTREGA</b></div>
        <div className="doc-roll-line">{details.deliveryReference || `Pedido ${doc.number}`}</div>
        {details.deliveryReference && doc.originOrderNumber && <div className="doc-roll-line">Origen: Pedido {doc.originOrderNumber}</div>}
        <div className="doc-roll-line">Impreso: {fechaMostrada} · {horaMostrada}</div>
        <div className="doc-roll-line">Registro manual de esta entrega</div>
      </div>
      <div className="doc-roll-rule" />
      <div className="doc-roll-line">Cliente: {doc.customerName}{customerDoc && ` · ${customerDoc}`}</div>
      <div className="doc-roll-line">Canal: {doc.channel}</div>
      <div className="doc-roll-line">
        Bultos:{' '}
        <input type="text" value={bultos} onChange={(e) => onBultosChange(e.target.value)} placeholder="Ej. 3 cajas · 1 rollo" className="doc-bultos-input doc-bultos-input-screen" />
        <span className="doc-bultos-print">{bultos ? bultos : <span className="doc-fill doc-fill-sm" />}</span>
      </div>
      {doc.documentDate && <div className="doc-roll-line">Fecha del pedido: {doc.documentDate}</div>}
      {details.address && <div className="doc-roll-line">Entrega: {details.address}</div>}
      {(details.contact || details.phone) && <div className="doc-roll-line">Contacto: {[details.contact, details.phone].filter(Boolean).join(' · ')}</div>}
      <div className="doc-roll-line">Transportista: {details.carrier || <span className="doc-fill doc-fill-sm" />}</div>
      <div className="doc-roll-line">Placa: {details.plate || <span className="doc-fill doc-fill-sm" />}</div>
      <div className="doc-roll-rule" />
      {lines.map((line, index) => {
        const factor = line.factorUnidadBase ?? 1
        const hasEquivalence = factor !== 1
        return (
          <div className="doc-roll-item" key={line.id}>
            <div className="doc-roll-line">{index + 1}. {line.name.toUpperCase()}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} /></div>
            <div className="doc-roll-line">
              {line.presentacionNombre ?? (line.isCustomItem ? line.unitOfMeasure : undefined) ?? 'Unidad'} · Pedido: {line.quantity}{hasEquivalence ? ` (${line.quantity * factor} u)` : ''} · {line.sourceLocation ?? '—'}
            </div>
            <div className="doc-roll-line">Entregado: <span className="doc-fill doc-fill-sm" /></div>
            <div className="doc-roll-line">Recibido: <span className="doc-fill doc-fill-sm" /></div>
            <div className="doc-roll-checks">
              <span><span className="doc-checkbox" /> C</span>
              <span><span className="doc-checkbox" /> P</span>
              <span><span className="doc-checkbox" /> N</span>
              <span><span className="doc-checkbox" /> R</span>
            </div>
            <div className="doc-roll-line">Motivo: <span className="doc-fill doc-fill-sm" /></div>
            <div className="doc-roll-rule" />
          </div>
        )
      })}
      <div className="doc-roll-line">C=Completo P=Parcial</div>
      <div className="doc-roll-line">N=No despachado R=Rechazado</div>
      <div className="doc-roll-rule" />
      <div className="doc-roll-line">Observaciones:</div>
      {details.observations && <div className="doc-roll-line">{details.observations}</div>}
      <div className="doc-roll-line"><span className="doc-fill doc-fill-lg" /></div>
      <div className="doc-roll-line">Entrega: <span className="doc-fill" /></div>
      <div className="doc-roll-line">Recibe (nombre, CI): <span className="doc-fill" /></div>
      <div className="doc-roll-line">Fecha y hora de recepción: <span className="doc-fill" /></div>
      <div className="doc-roll-end">— FIN —</div>
      <div className="doc-roll-center doc-roll-telegram">Fotografiar TODO el rollo y enviarlo al grupo de Telegram al momento del despacho.</div>
    </div>
  )
}
