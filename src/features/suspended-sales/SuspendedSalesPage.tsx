import { FileText, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { readSuspendedSales, removeSuspendedSale, type SuspendedSale } from '../../infrastructure/local/suspendedSales'
import { quoteService } from '../../infrastructure/services'
import type { QuoteDraft } from '../../application/shared/models'

export type { SuspendedSale }

const channelLabel: Record<string, string> = { retail: 'Retail', mayoreo: 'Mayoreo', institucional: 'Institucional', corporativo: 'Corporativo' }

// Brief S11 Bloque C2: total de una cotización — misma fórmula que QuotationsPage (línea
// neta de descuento por línea, menos el descuento general del encabezado).
const quoteTotalCents = (quote: QuoteDraft) =>
  quote.lines.reduce((sum, line) => sum + Math.round(line.unitPriceCents * line.quantity * (10_000 - line.discountBasisPoints) / 10_000), 0) - quote.generalDiscountCents

type SuspendedType = 'retail' | 'cotizacion'

interface UnifiedRow {
  id: string
  type: SuspendedType
  channel: string
  customer: string
  totalCents: number
  date: string
  number?: string
  sale?: SuspendedSale
}

/**
 * Brief S11 Bloque C2: "puede que estén manejando una venta retail y de la nada se vaya
 * la luz y puff" — pero las ventas retail suspendidas viven en localStorage (por
 * navegador: si Cristian suspende algo en la caja, Rony no lo ve desde su máquina) y una
 * cotización que puede tardar días y retomar otra persona necesita vivir en la base. Una
 * cotización en BORRADOR *es* una venta suspendida — no hace falta un mecanismo nuevo,
 * solo que esta pantalla las muestre juntas, cada una con su tipo. El corte es el estado:
 * BORRADOR aparece acá, cualquier otro (una vez que se guarda formalmente) sale de esta
 * lista — "ya cuando se guarda ahí ya pasa a ser una cotización".
 * No hacer: las ventas retail NO se mueven a la base en esta ronda (localStorage está
 * bien para su ciclo de vida corto; migrarlas es otro trabajo).
 */
export function SuspendedSalesPage({ hasCurrentCart, onRestore, onOpenCotizaciones, notify }: { hasCurrentCart: boolean; onRestore: (sale: SuspendedSale) => void; onOpenCotizaciones?: () => void; notify: (message: string) => void }) {
  const [sales, setSales] = useState(readSuspendedSales)
  const [quotesBorrador, setQuotesBorrador] = useState<QuoteDraft[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | SuspendedType>('all')

  useEffect(() => {
    void quoteService.list().then((quotes) => setQuotesBorrador(quotes.filter((q) => q.status === 'draft')))
  }, [])

  const rows: UnifiedRow[] = useMemo(() => [
    ...sales.map((sale): UnifiedRow => ({
      id: `retail:${sale.id}`,
      type: 'retail',
      channel: channelLabel[sale.channel] ?? sale.channel,
      customer: sale.customer,
      totalCents: Math.round(sale.total * 100),
      date: sale.date,
      sale,
    })),
    ...quotesBorrador.map((quote): UnifiedRow => ({
      id: `cotizacion:${quote.id}`,
      type: 'cotizacion',
      channel: channelLabel[quote.channel] ?? quote.channel,
      customer: quote.customerName || 'Sin cliente',
      totalCents: quoteTotalCents(quote),
      date: quote.createdAt,
      number: quote.number || `COT-${quote.id}`,
    })),
  ], [sales, quotesBorrador])

  const filtered = useMemo(() =>
    rows.filter((row) => (typeFilter === 'all' || row.type === typeFilter) && `${row.customer} ${row.channel} ${row.number ?? ''}`.toLowerCase().includes(query.toLowerCase())),
  [rows, query, typeFilter])

  const restore = (sale: SuspendedSale) => { if (hasCurrentCart && !confirm('Hay una operación actual. ¿Deseas reemplazarla por la venta suspendida?')) return; onRestore(sale); notify('Venta suspendida restaurada') }
  const remove = (id: string) => { if (!confirm('¿Eliminar definitivamente esta venta suspendida local?')) return; removeSuspendedSale(id); setSales(readSuspendedSales()); notify('Venta suspendida eliminada') }

  return <FeatureShell eyebrow="BANDEJA UNIFICADA" title="Suspendidas" subtitle="Ventas retail (este dispositivo) y cotizaciones en borrador (compartidas)">
    <FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por cliente, canal o número...">
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
        <option value="all">Todos los tipos</option>
        <option value="retail">Venta retail</option>
        <option value="cotizacion">Cotización</option>
      </select>
    </FeatureToolbar>
    {!filtered.length ? <FeatureState type={rows.length ? 'no-results' : 'empty'} text="No hay operaciones suspendidas" /> : <div className="suspended-grid">
      {filtered.map((row) => <article key={row.id}>
        <header>
          <div>
            <strong>{row.type === 'retail' ? 'Venta retail' : 'Cotización'}{row.number ? ` · ${row.number}` : ''} · {row.channel}</strong>
            <span>{new Date(row.date).toLocaleString('es-BO')}</span>
          </div>
          <i>{row.customer}</i>
        </header>
        <div>
          <span>Tipo<b>{row.type === 'retail' ? 'Venta retail' : 'Cotización'}</b></span>
          <span>Canal<b>{row.channel}</b></span>
          <span>Total<b>Bs {(row.totalCents / 100).toFixed(2)}</b></span>
        </div>
        <footer>
          {row.type === 'retail' && row.sale ? <>
            <button onClick={() => remove(row.sale!.id)}><Trash2 /> Eliminar</button>
            <button className="restore-sale" onClick={() => restore(row.sale!)}><RotateCcw /> Restaurar</button>
          </> : <button className="restore-sale" onClick={() => onOpenCotizaciones?.()}><FileText /> Ver en Cotizaciones</button>}
        </footer>
      </article>)}
    </div>}
  </FeatureShell>
}
