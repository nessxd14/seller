import { useEffect, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { WorkflowLine } from '../application/shared/models'
import { customerService, listLineIdentifiers } from '../infrastructure/services'
import { formatMoney, money } from '../domain/common/money'
import { Modal } from './Modal'
import { empresaStore as empresa } from '../config/empresaStore'
import { LineIdentifiersRow, type LineIdentifiers } from './LineIdentifiersRow'

export interface ExportableDoc {
  number: string
  customerId?: string
  customerName: string
  channel: string
  lines: WorkflowLine[]
  validUntil?: string
  conditionPago?: string
  asunto?: string
  documentDate?: string
  /** Descuento general del encabezado, en centavos. Ausente = sin descuento. */
  generalDiscountCents?: number
}

const conditionPagoLabel: Record<string, string> = {
  CONTADO: 'Contado',
  PAGO_PARCIAL: 'Pago parcial',
  SIGEP: 'SIGEP',
  TRANSFERENCIA_BANCARIA: 'Transferencia bancaria',
  QR: 'QR',
}

const lineTotalCents = (line: WorkflowLine) => Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000)

/**
 * Print/export document, parameterized for three modes:
 * - 'cotizacion': full document with prices (replaces QuotationsPage's old bare preview).
 * - 'pedido': same priced layout as 'cotizacion' (Nº·Descripción·Medida·Cant·Equiv.·P/U·Desc.·Total)
 *   but sourced from an OrderView — a proper "Pedido A4" document, distinct from the delivery note.
 * - 'nota-entrega': same layout, also surfaces each line's origin (Tienda/Almacén) since
 *   delivery notes care about where stock comes from. Prices are kept visible in both modes
 *   (the brief left this "según se decida" — showing prices consistently was simpler than
 *   building a second price-stripped layout for a single, rarely-used document type).
 */
export function DocumentoExportable({ doc, mode, onClose }: { doc: ExportableDoc; mode: 'cotizacion' | 'nota-entrega' | 'pedido'; onClose: () => void }) {
  const [customerDoc, setCustomerDoc] = useState('')
  useEffect(() => {
    void customerService.list().then((customers) => {
      const match = doc.customerId ? customers.find((c) => c.id === doc.customerId) : customers.find((c) => c.name === doc.customerName)
      if (match) setCustomerDoc(match.document)
    })
  }, [doc.customerId, doc.customerName])

  // Item 2.2: batch-fetch barra/fábrica/marca for every catalog line's product in one call
  // when the document loads, not one lookup per rendered row.
  const [identifiersByProduct, setIdentifiersByProduct] = useState<Record<string, LineIdentifiers>>({})
  useEffect(() => {
    const ids = Array.from(new Set(doc.lines.filter((line) => !line.isCustomItem && line.productId).map((line) => line.productId)))
    if (!ids.length) return
    void listLineIdentifiers(ids).then(setIdentifiersByProduct)
  }, [doc.lines])

  const catalogLines = doc.lines.filter((line) => !line.isCustomItem)
  const customLines = doc.lines.filter((line) => line.isCustomItem)
  const subtotalCents = doc.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)
  const title = mode === 'cotizacion' ? 'COTIZACIÓN' : mode === 'pedido' ? 'PEDIDO' : 'NOTA DE ENTREGA'
  const modalTitle = mode === 'cotizacion' ? 'Vista previa de cotización' : mode === 'pedido' ? 'Vista previa de pedido' : 'Vista previa de nota de entrega'

  return (
    <Modal title={modalTitle} subtitle={empresa.razonSocial} onClose={onClose} wide>
      <div className={`print-document documento-exportable ${mode === 'pedido' ? 'order-a4' : mode === 'nota-entrega' ? 'delivery-a4' : 'quote-a4'}`}>
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
          <div><strong>{title}</strong><span>{doc.number}</span></div>
        </header>
        <section className="doc-meta">
          <p><b>Cliente:</b> {doc.customerName}{customerDoc && ` · ${customerDoc}`}</p>
          <p><b>Canal:</b> {doc.channel}</p>
          {doc.asunto && <p><b>Asunto:</b> {doc.asunto}</p>}
          {doc.documentDate && <p><b>Fecha:</b> {doc.documentDate}</p>}
        </section>
        <table className="doc-table">
          <thead>
            <tr><th>Nº</th><th>Descripción</th><th>Medida</th><th>Cant</th><th>Equiv.</th><th>P/U</th><th>Desc.</th>{mode === 'nota-entrega' && <th>Origen</th>}<th>Total</th></tr>
          </thead>
          <tbody>
            {catalogLines.map((line, index) => {
              const factor = line.factorUnidadBase ?? 1
              const hasEquivalence = factor !== 1
              // TAREA 1 (Ronda 10): la máscara (descripcion) es para el cliente — cotización
              // y pedido la imprimen si existe; la nota de entrega siempre muestra el nombre
              // real de catálogo (quien despacha tiene que agarrar lo que dice el estante).
              // Nunca los dos juntos.
              const displayName = mode !== 'nota-entrega' && line.maskName ? line.maskName : line.name
              return (
                <tr key={line.id}>
                  <td>{index + 1}</td>
                  <td>{displayName}<LineIdentifiersRow identifiers={identifiersByProduct[line.productId]} /></td>
                  <td>{line.presentacionNombre ?? 'Unidad'}</td>
                  <td>{line.quantity}</td>
                  <td className="doc-equivalence">{hasEquivalence ? `${line.quantity * factor} u` : '—'}</td>
                  <td>{formatMoney(money(line.unitPriceCents))}</td>
                  <td>{(line.discountBasisPoints / 100).toFixed(1)}%</td>
                  {mode === 'nota-entrega' && <td>{line.sourceLocation ?? '—'}</td>}
                  <td>{formatMoney(money(lineTotalCents(line)))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {customLines.length > 0 && (
          <div className="doc-custom-block">
            <h4>Ítems especiales / a pedido</h4>
            <table className="doc-table">
              <thead><tr><th>Descripción</th><th>Cant</th><th>P/U</th>{mode === 'nota-entrega' && <th>Origen</th>}<th>Total</th></tr></thead>
              <tbody>
                {customLines.map((line) => (
                  <tr key={line.id}><td>{line.name}<LineIdentifiersRow isCustomItem /></td><td>{line.quantity}</td><td>{formatMoney(money(line.unitPriceCents))}</td>{mode === 'nota-entrega' && <td>{line.sourceLocation ?? '—'}</td>}<td>{formatMoney(money(lineTotalCents(line)))}</td></tr>
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
        {(doc.validUntil || doc.conditionPago) && (
          <div className="doc-footer-notes">
            {doc.validUntil && <span>Vigencia: {doc.validUntil}</span>}
            {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
          </div>
        )}
        {/* Brief S11 Bloque A: sello y firma superpuestos (el sello pisa un poco la
            firma), como en un documento real. Sin firma cargada se muestra una línea en
            blanco para firmar a mano — nunca el hueco vacío. Sin sello, nada (no hay
            fallback razonable para un sello). Mismo onError que el logo del encabezado. */}
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
      </div>
      <p className="print-header-footer-hint">Si el PDF sale con fecha y URL arriba/abajo, es el encabezado que agrega el navegador — desactivalo en el diálogo de impresión, en "Más ajustes" → "Encabezados y pies de página".</p>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={() => window.print()}><FileDown /> Guardar PDF</button>
        <button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button>
      </footer>
    </Modal>
  )
}
