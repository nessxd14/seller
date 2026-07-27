// Secondary "barra · fábrica · marca" line shown under a product/quote/order line's
// name, both in DraftOrderEditor's catalog rows and DocumentoExportable's printed lines
// (item 2.2). Codes render in monospace, marca in the normal body font; any missing piece
// is skipped entirely (no dashes/empty gaps). Personalized items never get a lookup — they
// always show the literal "Ítem a pedido · sin código" placeholder instead.
export interface LineIdentifiers { barra?: string; fabrica?: string; marca?: string }

export function LineIdentifiersRow({ identifiers, isCustomItem }: { identifiers?: LineIdentifiers; isCustomItem?: boolean }) {
  if (isCustomItem) return <small className="line-identifiers">Ítem a pedido · sin código</small>
  if (!identifiers) return null
  const parts: Array<{ value: string; mono: boolean }> = []
  if (identifiers.barra) parts.push({ value: identifiers.barra, mono: true })
  if (identifiers.fabrica) parts.push({ value: identifiers.fabrica, mono: true })
  if (identifiers.marca) parts.push({ value: identifiers.marca, mono: false })
  if (!parts.length) return null
  return (
    <small className="line-identifiers">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && ' · '}
          <span style={part.mono ? { fontFamily: 'monospace' } : undefined}>{part.value}</span>
        </span>
      ))}
    </small>
  )
}
