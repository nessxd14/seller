import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { Product, SalesChannel } from '../../../types'
import { productRepository } from '../../../infrastructure/services'
import { bs } from '../detalle/formato'
import { priceForOrderChannel } from './canal'

/** Búsqueda de producto de una sola elección (para una parte de un ítem partido o el saldo). */
export function BuscadorProducto({ canal, etiqueta, onElegir, autoFocus = false }: { canal: SalesChannel; etiqueta: string; onElegir: (producto: Product) => void; autoFocus?: boolean }) {
  const [consulta, setConsulta] = useState('')
  const [resultados, setResultados] = useState<Product[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelado = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia al vaciar el término, sin esperar al debounce
    setError(false)
    if (!consulta.trim()) { setResultados([]); setCargando(false); return }
    setCargando(true)
    const espera = setTimeout(() => {
      void productRepository.search({ query: consulta, active: true, page: { page: 1, pageSize: 30 } })
        .then((pagina) => { if (!cancelado) { setResultados(pagina.items); setCargando(false) } })
        .catch(() => { if (!cancelado) { setResultados([]); setCargando(false); setError(true) } })
    }, 250)
    return () => { cancelado = true; clearTimeout(espera) }
  }, [consulta])

  return <div className="ped-buscador">
    <label><span className="ped-sr">{etiqueta}</span>
      <Search aria-hidden />
      <input autoFocus={autoFocus} value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder={etiqueta} aria-label={etiqueta} />
    </label>
    {error && <p className="ped-nota ped-rojo" role="alert">No se pudo buscar. Intenta nuevamente.</p>}
    {cargando && <p className="ped-nota" aria-busy="true">Buscando…</p>}
    {resultados.length > 0 && <ul className="ped-buscador-lista">
      {resultados.map((producto) => <li key={producto.id}>
        <button type="button" onClick={() => { onElegir(producto); setConsulta(''); setResultados([]) }}>
          <strong>{producto.nombre}</strong><small>{producto.sku}</small><span>{bs(priceForOrderChannel(producto, canal))}</span>
        </button>
      </li>)}
    </ul>}
  </div>
}
