import { RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FeatureShell, FeatureState, FeatureToolbar } from '../shared/FeatureShell'
import { readSuspendedSales, removeSuspendedSale, type SuspendedSale } from '../../infrastructure/local/suspendedSales'

export type { SuspendedSale }

export function SuspendedSalesPage({ hasCurrentCart, onRestore, notify }:{hasCurrentCart:boolean;onRestore:(sale:SuspendedSale)=>void;notify:(message:string)=>void}) {
  const [sales,setSales]=useState(readSuspendedSales)
  const [query,setQuery]=useState('')
  const filtered=useMemo(()=>sales.filter((sale)=>`${sale.customer} ${sale.channel} ${sale.seller}`.toLowerCase().includes(query.toLowerCase())),[sales,query])
  const restore=(sale:SuspendedSale)=>{if(hasCurrentCart&&!confirm('Hay una operación actual. ¿Deseas reemplazarla por la venta suspendida?'))return;onRestore(sale);notify('Venta suspendida restaurada')}
  const remove=(id:string)=>{if(!confirm('¿Eliminar definitivamente esta venta suspendida local?'))return;removeSuspendedSale(id);setSales(readSuspendedSales());notify('Venta suspendida eliminada')}
  return <FeatureShell eyebrow="BANDEJA LOCAL" title="Ventas suspendidas" subtitle="Operaciones guardadas en este dispositivo"><FeatureToolbar query={query} onQuery={setQuery} placeholder="Buscar por cliente, vendedor o canal..."/>{!filtered.length?<FeatureState type={sales.length?'no-results':'empty'} text="No hay ventas suspendidas"/>:<div className="suspended-grid">{filtered.map((sale)=><article key={sale.id}><header><div><strong>{sale.customer}</strong><span>{new Date(sale.date).toLocaleString('es-BO')}</span></div><i>{sale.channel}</i></header><div><span>Vendedor<b>{sale.seller}</b></span><span>Productos<b>{sale.cart.reduce((sum,item)=>sum+item.cantidad,0)}</b></span><span>Total<b>Bs {sale.total.toFixed(2)}</b></span></div><footer><button onClick={()=>remove(sale.id)}><Trash2/> Eliminar</button><button className="restore-sale" onClick={()=>restore(sale)}><RotateCcw/> Restaurar</button></footer></article>)}</div>}</FeatureShell>
}
