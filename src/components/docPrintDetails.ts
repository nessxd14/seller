export interface DocPrintDetails {
  address: string
  contact: string
  phone: string
  leadTime: string
  bultos: string
  carrier: string
  plate: string
  observations: string
  deliveryReference: string
}

export const docPrintDetailsKey = (mode: string, number: string, customerId?: string) =>
  `cation:print-details:v1:${JSON.stringify([mode, number, customerId ?? ''])}`

export function readDocPrintDetails(key: string): Partial<DocPrintDetails> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([field, value]) =>
      ['address', 'contact', 'phone', 'leadTime', 'bultos', 'carrier', 'plate', 'observations', 'deliveryReference'].includes(field)
        && typeof value === 'string' && value.length <= 2000))
  } catch { return {} }
}

export function saveDocPrintDetails(key: string, values: Partial<DocPrintDetails>): boolean {
  try { localStorage.setItem(key, JSON.stringify(values)); return true } catch { return false }
}
