import { Fragment, useEffect, useMemo, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { WorkflowLine } from '../application/shared/models'
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
  /** Descuento general del encabezado, en centavos. Ausente = sin descuento. */
  generalDiscountCents?: number
  // Brief T3: número real (COT-2026-XXXXX) de la cotización de origen, cuando el pedido
  // nació de una conversión. Se imprime debajo del número principal, más chico.
  sourceQuoteNumber?: string
  // Brief "documentos diferenciados": email de quien creó/gestiona el documento — se
  // muestra como "Asesor" en cotización y pedido (mismo dato que AutoriaBadge resuelve).
  creadoPor?: string
  // Brief "documentos diferenciados": id interno del pedido, para el QR de pedido y de
  // nota de entrega — no es el número humano del documento (`number`), que en la nota
  // de entrega es el correlativo propio de la NE, distinto del pedido que la originó.
  orderId?: string
  // Brief "documentos diferenciados": número del pedido de origen de esta nota de
  // entrega (meta "Origen"). Solo aplica a mode 'nota-entrega'.
  originOrderNumber?: string
  // Brief "documentos diferenciados": bultos no tiene esquema propio todavía (fuera de
  // alcance) — texto libre opcional, precarga el input que se llena antes de imprimir.
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

// Brief "Correcciones de impresión de documentos" Parte 2: la página 1 lleva el membrete
// completo (más alto); las páginas 2..N llevan la cabecera compacta de una sola línea
// (más baja, aunque acotada por abajo por el QR de 16mm que se mantiene en todas las
// páginas). El brief sugería arrancar en 12/16 — con el membrete ya corregido (logo
// 56px, sin los overrides de 132/208/264px que existían antes, y el bug de
// .doc-id-block-with-qr apilándose en vertical por especificidad CSS, también corregido)
// esos números todavía partían cada página lógica en dos físicas. 9 primera / 11
// siguientes sí entra: medido con Playwright imprimiendo a PDF tamaño carta y contando
// páginas físicas contra "Página N de M" hasta que coincidieron exactamente (confirmado
// con nombres de producto largos que fuerzan 2 líneas de wrap). Un nombre aún más largo
// que fuerce 3 líneas todavía puede desbordar una hoja ocasionalmente — CSS de impresión
// no da un hook para medir antes de romper página; si eso se vuelve un problema real, la
// solución de fondo es binning por altura medida en vez de por cantidad fija de líneas.
const NE_LINES_FIRST_PAGE = 9
const NE_LINES_OTHER_PAGES = 11

const chunkVariable = <T,>(items: T[], firstSize: number, restSize: number): T[][] => {
  if (!items.length) return [[]]
  const pages: T[][] = []
  let i = 0
  let size = firstSize
  while (i < items.length) {
    pages.push(items.slice(i, i + size))
    i += size
    size = restSize
  }
  return pages
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const formatFecha = (date: Date) => `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`

type PedidoLine = WorkflowLine & { prepared?: number }

const lineaEstadoPedido = (line: PedidoLine): string => {
  if (line.lineStatus === 'CAMBIADA') return line.replacedByName ? `Cambiada → ${line.replacedByName}` : 'Cambiada'
  if (line.lineStatus === 'RECHAZADO') return 'Rechazada'
  if (line.lineStatus === 'RETIRADA') return 'Retirada'
  if (line.prepared === undefined) return '—'
  if (line.prepared <= 0) return 'Pendiente'
  if (line.prepared >= line.quantity) return 'Despachado'
  return `Parcial ${line.prepared}/${line.quantity}`
}

/** Brand + logo, idéntico en los tres documentos. */
function DocBrand() {
  return (
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
  )
}

/** Sello + firma preimpresa (cotización y pedido). La nota de entrega NO usa esto — sus
 * dos firmas son siempre manuscritas en el momento, ver <ManualSigns>. */
function PrintedSignoff() {
  return (
    <div className="doc-signoff">
      <div className="doc-signoff-stamp">
        {empresa.firmaUrl
          ? <img src={empresa.firmaUrl} alt="Firma" className="doc-firma-img" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <div className="doc-firma-blank" />}
        {empresa.selloUrl && <img src={empresa.selloUrl} alt="Sello" className="doc-sello-img" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
      </div>
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
  // Brief S-A: "Vista de cliente" (default) muestra doc.lines en una sola lista plana, sin
  // separar ítems especiales ni encabezados de sección — pensada para mandarle al cliente.
  // "Vista de empresa" es el comportamiento de siempre (catalogLines/customLines separados).
  // Solo aplica a cotización; sin persistencia, siempre arranca en Cliente al abrir el modal.
  const [vistaCliente, setVistaCliente] = useState(true)
  const [customerDoc, setCustomerDoc] = useState('')
  // Brief nota de entrega: bultos no tiene esquema propio (fuera de alcance) — texto
  // libre que se llena en el momento, antes de imprimir. El input imprime su valor tal
  // cual (el navegador pinta el valor actual del campo al imprimir).
  const [bultos, setBultos] = useState(doc.bultos ?? '')
  const [asesorNombre, setAsesorNombre] = useState(doc.creadoPor ?? '')
  // Fecha/hora de la nota de entrega: documentDate puede faltar (ver brief "Correcciones
  // de impresión" 1.4 — el flujo de pedidos hoy no lo envía, y no hay una fecha de
  // despacho propia distinta de "ahora" en el modelo). printedAt cubre ambos casos: hora
  // siempre, y fecha de respaldo cuando documentDate no llega.
  const [printedAt] = useState(() => new Date())
  // Brief "Correcciones de impresión" Parte 3: rollo 80mm para cotización y nota de
  // entrega — el pedido se queda en carta (documento de consulta interna, se lee mejor en
  // hoja completa). Arranca en el default de Configuración > Impresión.
  const [docFormat, setDocFormat] = useState<DocPrintFormat>(readDefaultDocPrintFormat)
  const supportsRollo = mode === 'cotizacion' || mode === 'nota-entrega'
  useEffect(() => { void loadEmpresaConfig() }, [])
  useEffect(() => {
    void customerService.list().then((customers) => {
      const match = doc.customerId ? customers.find((c) => c.id === doc.customerId) : customers.find((c) => c.name === doc.customerName)
      if (match) setCustomerDoc(match.document)
    })
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
      {mode === 'cotizacion' && <CotizacionDoc doc={doc} vistaCliente={vistaCliente} customerDoc={customerDoc} asesorNombre={asesorNombre} identifiersByProduct={identifiersByProduct} format={docFormat} />}
      {mode === 'pedido' && <PedidoDoc doc={doc} customerDoc={customerDoc} asesorNombre={asesorNombre} identifiersByProduct={identifiersByProduct} />}
      {mode === 'nota-entrega' && (
        <NotaEntregaDoc
          doc={doc}
          customerDoc={customerDoc}
          bultos={bultos}
          onBultosChange={setBultos}
          printedAt={printedAt}
          identifiersByProduct={identifiersByProduct}
          format={docFormat}
        />
      )}
      <p className="print-header-footer-hint">Si el PDF sale con fecha y URL arriba/abajo, es el encabezado que agrega el navegador — desactivalo en el diálogo de impresión, en "Más ajustes" → "Encabezados y pies de página".</p>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={() => window.print()}><FileDown /> Guardar PDF</button>
        <button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button>
      </footer>
    </Modal>
  )
}

// ============================== COTIZACIÓN ==============================
// Mismo contenido de siempre (precios, descuentos, vigencia/condición/medio de pago,
// maskName, ítems especiales, vista de cliente, firma/sello preimpresos) — lo único que
// cambia es el lenguaje visual, para que la cotización se lea como parte de la misma
// familia que pedido y nota de entrega (ver brief, sección 3).
function CotizacionDoc({ doc, vistaCliente, customerDoc, asesorNombre, identifiersByProduct, format }: {
  doc: ExportableDoc
  vistaCliente: boolean
  customerDoc: string
  asesorNombre: string
  identifiersByProduct: Record<string, LineIdentifiers>
  format: DocPrintFormat
}) {
  const catalogLines = doc.lines.filter((line) => !line.isCustomItem)
  const customLines = doc.lines.filter((line) => line.isCustomItem)
  const primaryLines = vistaCliente ? doc.lines : catalogLines
  const subtotalCents = doc.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)

  if (format === 'rollo-80') {
    return <CotizacionRoll doc={doc} lines={primaryLines} customerDoc={customerDoc} asesorNombre={asesorNombre} subtotalCents={subtotalCents} />
  }

  return (
    <div className="print-document documento-exportable quote-a4">
      <div className="doc-page">
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
        <table className="doc-table">
          <thead>
            <tr><th>Nº</th><th>Descripción</th><th>Medida</th><th>Cant</th><th>Equiv.</th><th>P/U</th><th>Desc.</th><th>Total</th></tr>
          </thead>
          <tbody>
            {primaryLines.map((line, index) => {
              const factor = line.factorUnidadBase ?? 1
              const hasEquivalence = factor !== 1
              const displayName = line.maskName ?? line.name
              return (
                <tr key={line.id}>
                  <td>{index + 1}</td>
                  <td>{displayName}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} /></td>
                  <td>{line.presentacionNombre ?? 'Unidad'}</td>
                  <td>{line.quantity}</td>
                  <td className="doc-equivalence">{hasEquivalence ? `${line.quantity * factor} u` : '—'}</td>
                  <td>{formatMoney(money(line.unitPriceCents))}</td>
                  <td>{(line.discountBasisPoints / 100).toFixed(1)}%</td>
                  <td>{formatMoney(money(lineTotalCents(line)))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!vistaCliente && customLines.length > 0 && (
          <div className="doc-custom-block">
            <h4>Ítems especiales / a pedido</h4>
            <table className="doc-table">
              <thead><tr><th>Descripción</th><th>Cant</th><th>P/U</th><th>Total</th></tr></thead>
              <tbody>
                {customLines.map((line) => (
                  <tr key={line.id}><td>{line.name}<LineIdentifiersRow isCustomItem /></td><td>{line.quantity}</td><td>{formatMoney(money(line.unitPriceCents))}</td><td>{formatMoney(money(lineTotalCents(line)))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="doc-totals">
          <div className="doc-total-row"><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          {Boolean(doc.generalDiscountCents) && (
            <div className="doc-total-row"><span>Descuento general</span><strong>−{formatMoney(money(doc.generalDiscountCents ?? 0))}</strong></div>
          )}
          <div className="doc-total-row doc-total-line"><span>Total</span><strong>{formatMoney(money(Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))))}</strong></div>
        </footer>
        {(doc.validUntil || doc.conditionPago || doc.medioPago) && (
          <div className="doc-footer-notes">
            {doc.validUntil && <span>Vigencia: {doc.validUntil}</span>}
            {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
            {doc.medioPago && <span>Medio de pago: {medioPagoLabel[doc.medioPago] ?? doc.medioPago}</span>}
          </div>
        )}
        <PrintedSignoff />
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
function PedidoDoc({ doc, customerDoc, asesorNombre, identifiersByProduct }: {
  doc: ExportableDoc
  customerDoc: string
  asesorNombre: string
  identifiersByProduct: Record<string, LineIdentifiers>
}) {
  const catalogLines = doc.lines.filter((line) => !line.isCustomItem) as PedidoLine[]
  const customLines = doc.lines.filter((line) => line.isCustomItem) as PedidoLine[]
  const subtotalCents = doc.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)

  return (
    <div className="print-document documento-exportable order-a4">
      <div className="doc-page">
        <header>
          <DocBrand />
          <div className="doc-id-block-with-qr">
            {doc.orderId && <DocQr content={qrContentForPedido(doc.orderId)} />}
            <div className="doc-id-block">
              <strong>PEDIDO</strong>
              <span className="doc-number-mono">{doc.number}</span>
              {doc.sourceQuoteNumber && <small className="doc-number-origin">origen {doc.sourceQuoteNumber}</small>}
            </div>
          </div>
        </header>
        <section className="doc-kv-grid">
          <div className="doc-kv"><div className="k">Cliente</div><div className="v">{doc.customerName}{customerDoc && ` · ${customerDoc}`}</div></div>
          {doc.documentDate && <div className="doc-kv"><div className="k">Fecha</div><div className="v">{doc.documentDate}</div></div>}
          <div className="doc-kv"><div className="k">Canal</div><div className="v">{doc.channel}</div></div>
          {doc.conditionPago && <div className="doc-kv"><div className="k">Condición</div><div className="v">{conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</div></div>}
          {asesorNombre && <div className="doc-kv"><div className="k">Asesor</div><div className="v">{asesorNombre}</div></div>}
        </section>
        <table className="doc-table">
          <thead>
            <tr><th>Nº</th><th>Descripción</th><th>Medida</th><th>Cant</th><th>Equiv.</th><th>P/U</th><th>Desc.</th><th>Total</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {catalogLines.map((line, index) => {
              const factor = line.factorUnidadBase ?? 1
              const hasEquivalence = factor !== 1
              const displayName = line.maskName ?? line.name
              const cambiada = line.lineStatus === 'CAMBIADA'
              return (
                <tr key={line.id} className={cambiada ? 'doc-line-status-cambiada' : undefined}>
                  <td>{index + 1}</td>
                  <td>{displayName}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} /></td>
                  <td>{line.presentacionNombre ?? 'Unidad'}</td>
                  <td>{line.quantity}</td>
                  <td className="doc-equivalence">{hasEquivalence ? `${line.quantity * factor} u` : '—'}</td>
                  <td>{cambiada ? '—' : formatMoney(money(line.unitPriceCents))}</td>
                  <td>{cambiada ? '—' : `${(line.discountBasisPoints / 100).toFixed(1)}%`}</td>
                  <td>{cambiada ? '—' : formatMoney(money(lineTotalCents(line)))}</td>
                  <td>{lineaEstadoPedido(line)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {customLines.length > 0 && (
          <div className="doc-custom-block">
            <h4>Ítems especiales / a pedido</h4>
            <table className="doc-table">
              <thead><tr><th>Descripción</th><th>Cant</th><th>P/U</th><th>Total</th><th>Estado</th></tr></thead>
              <tbody>
                {customLines.map((line) => (
                  <tr key={line.id}><td>{line.name}<LineIdentifiersRow isCustomItem /></td><td>{line.quantity}</td><td>{formatMoney(money(line.unitPriceCents))}</td><td>{formatMoney(money(lineTotalCents(line)))}</td><td>{lineaEstadoPedido(line)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="doc-totals">
          <div className="doc-total-row"><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          {Boolean(doc.generalDiscountCents) && (
            <div className="doc-total-row"><span>Descuento general</span><strong>−{formatMoney(money(doc.generalDiscountCents ?? 0))}</strong></div>
          )}
          <div className="doc-total-row doc-total-line"><span>Total</span><strong>{formatMoney(money(Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))))}</strong></div>
        </footer>
        {(doc.conditionPago || doc.medioPago) && (
          <div className="doc-footer-notes">
            {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
            {doc.medioPago && <span>Medio de pago: {medioPagoLabel[doc.medioPago] ?? doc.medioPago}</span>}
          </div>
        )}
        <p className="doc-disclaimer">
          Documento interno de seguimiento. No constituye comprobante de entrega ni documento fiscal.<br />
          La entrega física se acredita con la Nota de Entrega correspondiente a cada tanda.
        </p>
        <PrintedSignoff />
      </div>
    </div>
  )
}

// ============================== NOTA DE ENTREGA ==============================
// Rehecha por completo: sin precios ni totales, con paginado real y todos los campos
// operativos que necesita quien despacha/recibe (ver brief, sección 1).
function NotaEntregaDoc({ doc, customerDoc, bultos, onBultosChange, printedAt, identifiersByProduct, format }: {
  doc: ExportableDoc
  customerDoc: string
  bultos: string
  onBultosChange: (value: string) => void
  printedAt: Date
  identifiersByProduct: Record<string, LineIdentifiers>
  format: DocPrintFormat
}) {
  const pages = useMemo(() => chunkVariable(doc.lines, NE_LINES_FIRST_PAGE, NE_LINES_OTHER_PAGES), [doc.lines])
  const totalPages = pages.length
  const pageStartIndexes = useMemo(() => {
    const starts: number[] = []
    let running = 0
    for (const pageLines of pages) { starts.push(running); running += pageLines.length }
    return starts
  }, [pages])
  // Brief 1.4: documentDate puede faltar (ver comentario junto a printedAt en el
  // componente padre) — sin esto, la NE imprimía la hora sola, rompiendo la conciliación
  // contra el timestamp de Cation en la verificación de evidencia.
  const fechaMostrada = doc.documentDate ?? formatFecha(printedAt)
  const horaMostrada = `${pad2(printedAt.getHours())}:${pad2(printedAt.getMinutes())}`

  if (format === 'rollo-80') {
    return <NotaEntregaRoll doc={doc} lines={doc.lines} customerDoc={customerDoc} bultos={bultos} onBultosChange={onBultosChange} fechaMostrada={fechaMostrada} horaMostrada={horaMostrada} identifiersByProduct={identifiersByProduct} />
  }

  return (
    <div className="print-document documento-exportable delivery-a4">
      {pages.map((pageLines, pageIndex) => {
        const startIndex = pageStartIndexes[pageIndex]
        const isFirstPage = pageIndex === 0
        const isLastPage = pageIndex === totalPages - 1
        return (
          <div className="doc-page" key={pageIndex}>
            {isFirstPage ? (
              <header>
                <DocBrand />
                <div className="doc-id-block-with-qr">
                  {doc.orderId && <DocQr content={qrContentForNotaEntrega(doc.orderId, doc.number)} />}
                  <div className="doc-id-block">
                    <strong>NOTA DE<br />ENTREGA</strong>
                    <span className="doc-number-mono">{doc.number}</span>
                    <span className="doc-page-info">Página {pageIndex + 1} de {totalPages}</span>
                  </div>
                </div>
              </header>
            ) : (
              // Brief "Correcciones de impresión" Parte 2: cabecera de una sola línea en
              // páginas 2..N — la completa (membrete + grilla) repetida en cada hoja se
              // comía ~45mm por página, casi una hoja entera perdida en una NE de 4. El QR
              // se mantiene siempre: es lo que le permite al agente de Telegram identificar
              // el pedido si le llega la foto de una hoja suelta.
              <header className="doc-page-header-compact">
                <img className="doc-page-header-compact-logo" src={empresa.logoSrc} alt={empresa.razonSocial} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                <span className="doc-page-header-compact-title">NOTA DE ENTREGA · {doc.number} · {doc.customerName}</span>
                {doc.orderId && <DocQr content={qrContentForNotaEntrega(doc.orderId, doc.number)} />}
                <span className="doc-page-info">Página {pageIndex + 1} de {totalPages}</span>
              </header>
            )}
            {isFirstPage && (
              <>
                <section className="doc-kv-grid">
                  <div className="doc-kv"><div className="k">Cliente</div><div className="v">{doc.customerName}{customerDoc && ` · ${customerDoc}`}</div></div>
                  <div className="doc-kv"><div className="k">Fecha y hora</div><div className="v">{fechaMostrada} · {horaMostrada}</div></div>
                  {doc.originOrderNumber && <div className="doc-kv"><div className="k">Origen</div><div className="v">Pedido #{doc.originOrderNumber}</div></div>}
                  <div className="doc-kv"><div className="k">Canal</div><div className="v">{doc.channel}</div></div>
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
                </section>
                <section className="doc-kv-grid doc-kv-grid-wide">
                  <div className="doc-kv"><div className="k">Transportista (opcional)</div><div className="v"><span className="doc-fill" /></div></div>
                  <div className="doc-kv"><div className="k">Placa</div><div className="v"><span className="doc-fill doc-fill-sm" /></div></div>
                  <div />
                </section>
              </>
            )}
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Nº</th><th>Descripción</th><th>Medida</th><th>Pedido</th><th>Despachado</th>
                  <th className="doc-col-check">C</th><th className="doc-col-check">P</th><th className="doc-col-check">N</th><th className="doc-col-check">R</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {pageLines.map((line, i) => {
                  const factor = line.factorUnidadBase ?? 1
                  const hasEquivalence = factor !== 1
                  return (
                    <Fragment key={line.id}>
                      <tr>
                        <td>{startIndex + i + 1}</td>
                        <td>{line.name}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} /></td>
                        <td>{line.presentacionNombre ?? 'Unidad'}</td>
                        <td>{line.quantity}{hasEquivalence && <span className="doc-equivalence line-equivalence">{line.quantity * factor} u</span>}</td>
                        <td><span className="doc-qty-fill" /></td>
                        <td className="doc-col-check"><span className="doc-checkbox" /></td>
                        <td className="doc-col-check"><span className="doc-checkbox" /></td>
                        <td className="doc-col-check"><span className="doc-checkbox" /></td>
                        <td className="doc-col-check"><span className="doc-checkbox" /></td>
                        <td>{line.sourceLocation ?? '—'}</td>
                      </tr>
                      <tr className="doc-motivo-row">
                        <td></td>
                        <td colSpan={9}>Motivo:<span className="doc-motivo-line" /></td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <div className="doc-legend">
              C = Completo · P = Parcial · N = No despachado (almacén) · R = Rechazado al recibir<br />
              Equivalencia en unidades base debajo de la cantidad pedida.
            </div>
            {isLastPage && (
              <>
                <div className="doc-obs">Observaciones: <span className="doc-fill doc-fill-lg" /></div>
                <div className="doc-manual-signs">
                  <div className="doc-manual-sign"><div className="doc-manual-sign-line" /><span>Entrega (nombre y firma)</span></div>
                  <div className="doc-manual-sign"><div className="doc-manual-sign-line" /><span>Recibe (nombre, CI y firma)</span></div>
                  {empresa.selloUrl && (
                    <div className="doc-stamp-only">
                      <img src={empresa.selloUrl} alt="Sello" className="doc-sello-img" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    </div>
                  )}
                </div>
                <div className="doc-telegram-note">Fotografiar TODAS las páginas y enviarlas al grupo de Telegram al momento del despacho.</div>
              </>
            )}
          </div>
        )
      })}
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
function CotizacionRoll({ doc, lines, customerDoc, asesorNombre, subtotalCents }: {
  doc: ExportableDoc
  lines: WorkflowLine[]
  customerDoc: string
  asesorNombre: string
  subtotalCents: number
}) {
  const totalCents = Math.max(0, subtotalCents - (doc.generalDiscountCents ?? 0))
  return (
    <div className="print-document documento-exportable doc-roll">
      <div className="doc-roll-center">
        <img src={empresa.logoSrc} alt={empresa.razonSocial} className="doc-roll-logo" onError={(e) => { e.currentTarget.style.display = 'none' }} />
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
      <div className="doc-roll-rule" />
      {lines.map((line, index) => {
        const displayName = line.maskName ?? line.name
        return (
          <div className="doc-roll-item" key={line.id}>
            <div className="doc-roll-line">{index + 1}. {displayName.toUpperCase()}</div>
            <div className="doc-roll-line">{line.presentacionNombre ?? 'Unidad'} × {line.quantity}</div>
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
    </div>
  )
}

/** Nota de entrega en rollo: sin paginado — el rollo es continuo. Lleva el mismo QR y los
 * mismos campos operativos que la versión de carta (bultos, transportista/placa, C/P/N/R,
 * motivo, firmas manuscritas), apilados en vez de en tabla. El marcador "— FIN —" es lo
 * que reemplaza al paginado acá: sin él, una tira larga reintroduce exactamente el
 * problema que el paginado resuelve en carta — el agente de Telegram no tendría forma de
 * saber si la última foto llega al final del rollo o si falta más. */
function NotaEntregaRoll({ doc, lines, customerDoc, bultos, onBultosChange, fechaMostrada, horaMostrada, identifiersByProduct }: {
  doc: ExportableDoc
  lines: WorkflowLine[]
  customerDoc: string
  bultos: string
  onBultosChange: (value: string) => void
  fechaMostrada: string
  horaMostrada: string
  identifiersByProduct: Record<string, LineIdentifiers>
}) {
  return (
    <div className="print-document documento-exportable doc-roll">
      <div className="doc-roll-center">
        <img src={empresa.logoSrc} alt={empresa.razonSocial} className="doc-roll-logo" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <div className="doc-roll-line"><b>{empresa.razonSocial}</b></div>
        <div className="doc-roll-line">{empresa.direccion}</div>
      </div>
      {doc.orderId && <DocQr content={qrContentForNotaEntrega(doc.orderId, doc.number)} className="doc-roll-qr" />}
      <div className="doc-roll-center">
        <div className="doc-roll-line"><b>NOTA DE ENTREGA</b></div>
        {doc.originOrderNumber && <div className="doc-roll-line">Pedido #{doc.originOrderNumber}</div>}
        <div className="doc-roll-line">{doc.number}</div>
        <div className="doc-roll-line">{fechaMostrada} · {horaMostrada}</div>
      </div>
      <div className="doc-roll-rule" />
      <div className="doc-roll-line">Cliente: {doc.customerName}{customerDoc && ` · ${customerDoc}`}</div>
      <div className="doc-roll-line">Canal: {doc.channel}</div>
      <div className="doc-roll-line">
        Bultos:{' '}
        <input type="text" value={bultos} onChange={(e) => onBultosChange(e.target.value)} placeholder="Ej. 3 cajas · 1 rollo" className="doc-bultos-input doc-bultos-input-screen" />
        <span className="doc-bultos-print">{bultos ? bultos : <span className="doc-fill doc-fill-sm" />}</span>
      </div>
      <div className="doc-roll-line">Transportista: <span className="doc-fill doc-fill-sm" /></div>
      <div className="doc-roll-line">Placa: <span className="doc-fill doc-fill-sm" /></div>
      <div className="doc-roll-rule" />
      {lines.map((line, index) => {
        const factor = line.factorUnidadBase ?? 1
        const hasEquivalence = factor !== 1
        return (
          <div className="doc-roll-item" key={line.id}>
            <div className="doc-roll-line">{index + 1}. {line.name.toUpperCase()}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} isCustomItem={line.isCustomItem} /></div>
            <div className="doc-roll-line">
              {line.presentacionNombre ?? 'Unidad'} · Pedido: {line.quantity}{hasEquivalence ? ` (${line.quantity * factor} u)` : ''} · {line.sourceLocation ?? '—'}
            </div>
            <div className="doc-roll-line">Despachado: <span className="doc-fill doc-fill-sm" /></div>
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
      <div className="doc-roll-line"><span className="doc-fill doc-fill-lg" /></div>
      <div className="doc-roll-line">Entrega: <span className="doc-fill" /></div>
      <div className="doc-roll-line">Recibe (nombre, CI): <span className="doc-fill" /></div>
      <div className="doc-roll-end">— FIN —</div>
      <div className="doc-roll-center doc-roll-telegram">Fotografiar TODO el rollo y enviarlo al grupo de Telegram al momento del despacho.</div>
    </div>
  )
}
