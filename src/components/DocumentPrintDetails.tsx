import type { DocPrintDetails } from './docPrintDetails'

export function DocumentPrintDetails({ mode, values, onChange, onSave, message }: {
  mode: 'cotizacion' | 'pedido' | 'nota-entrega'
  values: DocPrintDetails
  onChange: (field: keyof DocPrintDetails, value: string) => void
  onSave: () => void
  message: string
}) {
  const fields: Array<[keyof DocPrintDetails, string]> = [
    ['address', 'Lugar / dirección de entrega'], ['contact', 'Contacto / destinatario'], ['phone', 'Teléfono de contacto'],
    ...(mode === 'cotizacion' ? [['leadTime', 'Plazo de entrega']] as Array<[keyof DocPrintDetails, string]> : []),
    ...(mode === 'nota-entrega' ? [
      ['deliveryReference', 'Referencia de esta entrega (opcional)'], ['bultos', 'Bultos'], ['carrier', 'Transportista'], ['plate', 'Placa'],
    ] as Array<[keyof DocPrintDetails, string]> : []),
  ]
  return <details className="doc-details-editor">
    <summary>Completar datos para impresión</summary>
    <p>Los datos guardados se conservan para este documento en este navegador.</p>
    <div className="doc-details-fields">
      {fields.map(([field, label]) => <label key={field}>{label}<input value={values[field]} maxLength={300} onChange={(e) => onChange(field, e.target.value)} /></label>)}
      <label className="doc-details-full">Observaciones<textarea aria-label="Observaciones" rows={2} value={values.observations} maxLength={2000} onChange={(e) => onChange('observations', e.target.value)} /></label>
    </div>
    <div className="doc-details-save"><button type="button" className="secondary-button" onClick={onSave}>Guardar datos para reimpresión</button><span role="status">{message}</span></div>
  </details>
}

export function DocumentRecipient({ values, showLeadTime = false }: { values: DocPrintDetails; showLeadTime?: boolean }) {
  if (!values.address && !values.contact && !values.phone && !(showLeadTime && values.leadTime)) return null
  return <section className="doc-recipient-grid">
    {values.address && <div className="doc-kv"><div className="k">Lugar de entrega</div><div className="v">{values.address}</div></div>}
    {(values.contact || values.phone) && <div className="doc-kv"><div className="k">Contacto</div><div className="v">{[values.contact, values.phone].filter(Boolean).join(' · ')}</div></div>}
    {showLeadTime && values.leadTime && <div className="doc-kv"><div className="k">Plazo de entrega</div><div className="v">{values.leadTime}</div></div>}
  </section>
}
