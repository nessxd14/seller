// No-dependency CSV export helper (Reportes' "Exportar CSV" buttons). Excel in
// Spanish-locale configurations treats ',' as a decimal separator and expects ';' as
// the field separator, so this uses ';' rather than the "standard" ',' — a well-known
// Excel/CSV gotcha worth getting right rather than assuming ',' works universally.
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

const escapeField = (raw: string): string => {
  const needsQuoting = raw.includes(';') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')
  const escaped = raw.replace(/"/g, '""')
  return needsQuoting ? `"${escaped}"` : escaped
}

export const buildCsv = <T>(rows: T[], columns: Array<CsvColumn<T>>): string => {
  const lines = [columns.map((column) => escapeField(column.header)).join(';')]
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = column.value(row)
      return escapeField(value === null || value === undefined ? '' : String(value))
    }).join(';'))
  }
  return lines.join('\r\n')
}

// Prepends a UTF-8 BOM so Excel correctly detects UTF-8 and renders Spanish
// accents/ñ correctly, then triggers a browser download via a Blob + temporary <a>.
export const downloadCsv = (filename: string, csv: string): void => {
  const BOM = '﻿'
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
