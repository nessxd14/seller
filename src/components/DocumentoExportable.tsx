import { useEffect, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import type { WorkflowLine } from '../application/shared/models'
import { customerService } from '../infrastructure/services'
import { formatMoney, money } from '../domain/common/money'
import { Modal } from './Modal'
import { empresa } from '../config/empresa'

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
 * Print/export document, parameterized for two modes:
 * - 'cotizacion': full document with prices (replaces QuotationsPage's old bare preview).
 * - 'nota-entrega': same layout, also surfaces each line's origin (Tienda/Almacén) since
 *   delivery notes care about where stock comes from. Prices are kept visible in both modes
 *   (the brief left this "según se decida" — showing prices consistently was simpler than
 *   building a second price-stripped layout for a single, rarely-used document type).
 */
export function DocumentoExportable({ doc, mode, onClose }: { doc: ExportableDoc; mode: 'cotizacion' | 'nota-entrega'; onClose: () => void }) {
  const [customerDoc, setCustomerDoc] = useState('')
  useEffect(() => {
    void customerService.list().then((customers) => {
      const match = doc.customerId ? customers.find((c) => c.id === doc.customerId) : customers.find((c) => c.name === doc.customerName)
      if (match) setCustomerDoc(match.document)
    })
  }, [doc.customerId, doc.customerName])

  const catalogLines = doc.lines.filter((line) => !line.isCustomItem)
  const customLines = doc.lines.filter((line) => line.isCustomItem)
  const subtotalCents = doc.lines.reduce((sum, line) => sum + lineTotalCents(line), 0)
  const title = mode === 'cotizacion' ? 'COTIZACIÓN' : 'NOTA DE ENTREGA'

  return (
    <Modal title={mode === 'cotizacion' ? 'Vista previa de cotización' : 'Vista previa de nota de entrega'} subtitle={empresa.razonSocial} onClose={onClose} wide>
      <div className="print-document quote-a4 documento-exportable">
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
              return (
                <tr key={line.id}>
                  <td>{index + 1}</td>
                  <td>{line.name}</td>
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
                  <tr key={line.id}><td>{line.name}</td><td>{line.quantity}</td><td>{formatMoney(money(line.unitPriceCents))}</td>{mode === 'nota-entrega' && <td>{line.sourceLocation ?? '—'}</td>}<td>{formatMoney(money(lineTotalCents(line)))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="doc-totals">
          <div><span>Subtotal</span><strong>{formatMoney(money(subtotalCents))}</strong></div>
          <div className="doc-total-line"><span>Total en Bs</span><strong>{formatMoney(money(Math.max(0, subtotalCents)))}</strong></div>
        </footer>
        {(doc.validUntil || doc.conditionPago) && (
          <div className="doc-footer-notes">
            {doc.validUntil && <span>Vigencia: {doc.validUntil}</span>}
            {doc.conditionPago && <span>Condición de pago: {conditionPagoLabel[doc.conditionPago] ?? doc.conditionPago}</span>}
          </div>
        )}
      </div>
      <footer className="modal-actions">
        <button className="secondary-button" onClick={() => window.print()}><FileDown /> Guardar PDF</button>
        <button className="primary-button" onClick={() => window.print()}><Printer /> Imprimir</button>
      </footer>
    </Modal>
  )
}
