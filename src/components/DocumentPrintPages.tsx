/** Los contadores del motor de impresión corresponden a hojas físicas, incluso
 * cuando cambia la altura de una descripción, el papel o la escala del usuario. */
export function DocumentPrintPages({ number, lineCount }: { number: string; lineCount: number }) {
  const label = JSON.stringify(`${number} · ${lineCount} ítems`)
  return <style>{`@media print {
    @page pos-document {
      size: letter;
      margin: 12mm;
      @bottom-left { content: ${label}; font: 8pt Arial, sans-serif; color: #555; }
      @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial, sans-serif; color: #555; }
    }
  }`}</style>
}

export function DocumentTableColumns({ widths }: { widths: number[] }) {
  return <colgroup>{widths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
}
