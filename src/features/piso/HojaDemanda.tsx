import { Camera, Minus, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnotarDemandaInput, DemandaCanal, DemandaPrevia, DemandaUnidad } from '../../application/ports/demandaRepository'
import { Modal } from '../../components/Modal'
import { demandaRepository, getStockBySucursalBatch, productRepository } from '../../infrastructure/services'
import type { Product } from '../../types'

const MIN_CARACTERES = 2
const DEBOUNCE_MS = 250
const MAX_COINCIDENCIAS = 5
const MENSAJE_SIN_CONEXION = 'Sin conexión: no se pudo anotar. Inténtalo de nuevo.'

const UNIDADES: Array<{ valor: DemandaUnidad; texto: string }> = [
  { valor: 'UNIDADES', texto: 'Unidades' }, { valor: 'HOJAS', texto: 'Hojas' }, { valor: 'PAQUETES', texto: 'Paquetes' }, { valor: 'CAJAS', texto: 'Cajas' },
]
const CANALES: Array<{ valor: DemandaCanal; texto: string }> = [{ valor: 'TIENDA', texto: 'Tienda' }, { valor: 'MAYOR', texto: 'Por mayor' }]

interface Stock { tienda: number; almacen: number }
type Elegido = { tipo: 'producto'; id: number; nombre: string } | { tipo: 'libre' } | null

export interface HojaDemandaProps {
  textoInicial?: string
  productoInicial?: { id: number; nombre: string }
  onClose: () => void
  onAnotado: (vecesSemana: number) => void
}

const lineaStock = (s: Stock | undefined): string | null => {
  if (!s) return null
  if (s.tienda <= 0 && s.almacen <= 0) return 'sin stock en Tienda ni Almacén'
  if (s.tienda <= 0) return `sin stock en Tienda · ${s.almacen} en Almacén`
  if (s.almacen <= 0) return `${s.tienda} en Tienda · sin stock en Almacén`
  return `${s.tienda} en Tienda · ${s.almacen} en Almacén`
}

const esSinConexion = (e: unknown): boolean =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) || (e instanceof Error && /failed to fetch|network|load failed/i.test(e.message))

function useCoincidencias(texto: string, activo: boolean) {
  const [encontrados, setEncontrados] = useState<{ q: string; productos: Product[]; stock: Map<number, Stock> }>({ q: '', productos: [], stock: new Map() })
  const q = texto.trim()
  useEffect(() => {
    if (!activo || q.length < MIN_CARACTERES) return
    let cancelado = false
    const id = window.setTimeout(() => {
      productRepository.search({ query: q, active: true, page: { page: 1, pageSize: MAX_COINCIDENCIAS } })
        .then(async (page) => {
          if (cancelado) return
          setEncontrados({ q, productos: page.items, stock: new Map() })
          try {
            const lote = await getStockBySucursalBatch(page.items.map((p) => p.id))
            if (!cancelado) setEncontrados({ q, productos: page.items, stock: new Map([...lote].map(([pid, s]) => [pid, { tienda: s.tiendaVendible, almacen: s.almacenVendible }])) })
          } catch { /* sin stock fiable no se muestra la línea */ }
        })
        .catch(() => { if (!cancelado) setEncontrados({ q, productos: [], stock: new Map() }) })
    }, DEBOUNCE_MS)
    return () => { cancelado = true; window.clearTimeout(id) }
  }, [q, activo])
  // Solo valen los resultados de lo que está escrito ahora.
  return encontrados.q === q && activo ? encontrados : { q, productos: [] as Product[], stock: new Map<number, Stock>() }
}

function BannerPrevio({ previa }: { previa: DemandaPrevia | null }) {
  if (!previa || (previa.vecesSemana <= 0 && previa.estado !== 'TRAER' && previa.estado !== 'LLEGO')) return null
  return <div className="demanda-previa" role="status">
    {previa.vecesSemana > 0 && <p>Ya la pidieron {previa.vecesSemana} veces esta semana. Tu anotación se suma a esas.</p>}
    {previa.estado === 'TRAER' && <p>Ya se está trayendo.</p>}
    {previa.estado === 'LLEGO' && <p>Ya llegó: avisa a caja/almacén.</p>}
  </div>
}

export function HojaDemanda({ textoInicial = '', productoInicial, onClose, onAnotado }: HojaDemandaProps) {
  const [entrada, setEntrada] = useState(productoInicial?.nombre ?? textoInicial)
  const [elegido, setElegido] = useState<Elegido>(productoInicial ? { tipo: 'producto', id: productoInicial.id, nombre: productoInicial.nombre } : textoInicial.trim() ? { tipo: 'libre' } : null)
  const [cantidad, setCantidad] = useState('1')
  const [unidad, setUnidad] = useState<DemandaUnidad>('UNIDADES')
  const [canal, setCanal] = useState<DemandaCanal>('TIENDA')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [quiereAviso, setQuiereAviso] = useState(false)
  const [foto, setFoto] = useState<File | null>(null)
  const [miniatura, setMiniatura] = useState<string | null>(null)
  const [previaCargada, setPrevia] = useState<{ clave: string; previa: DemandaPrevia } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const fotoSubida = useRef<{ archivo: File; path: string } | null>(null)

  const eligiendo = elegido == null
  const { productos, stock } = useCoincidencias(entrada, eligiendo)
  const textoLibre = entrada.trim()
  const hayAlgo = elegido?.tipo === 'producto' || textoLibre.length > 0
  const productoId = elegido?.tipo === 'producto' ? elegido.id : null
  const descripcion = productoId == null && textoLibre ? textoLibre : null

  // Misma regla de agrupación que anotar_demanda: lo que se ve acá es donde cae la nota.
  const claveBanner = elegido ? (productoId != null ? `p:${productoId}` : `t:${textoLibre}`) : null
  useEffect(() => {
    if (claveBanner == null) return
    let cancelado = false
    demandaRepository.previa(productoId, productoId == null ? textoLibre : null)
      .then((p) => { if (!cancelado) setPrevia({ clave: claveBanner, previa: p }) })
      .catch(() => { if (!cancelado) setPrevia(null) })
    return () => { cancelado = true }
    // productoId y textoLibre quedan cubiertos por claveBanner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveBanner])

  const urlActual = useRef<string | null>(null)
  useEffect(() => () => { if (urlActual.current) URL.revokeObjectURL(urlActual.current) }, [])
  const cambiarFoto = (archivo: File | null) => {
    if (urlActual.current) URL.revokeObjectURL(urlActual.current)
    urlActual.current = archivo && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(archivo) : null
    setMiniatura(urlActual.current)
    setFoto(archivo)
    fotoSubida.current = null
  }

  const cantidadNumero = useMemo(() => {
    const n = Math.floor(Number(cantidad.replace(',', '.')))
    return Number.isFinite(n) && n >= 1 ? n : 1
  }, [cantidad])
  const avisoSinTelefono = quiereAviso && !telefono.trim()
  const puedeAnotar = hayAlgo && !avisoSinTelefono && !enviando

  const alEscribir = (valor: string) => { setEntrada(valor); setElegido(null) }
  const elegirProducto = (p: Product) => { setEntrada(p.nombre); setElegido({ tipo: 'producto', id: p.id, nombre: p.nombre }) }

  const anotar = async () => {
    if (!puedeAnotar) return
    setEnviando(true)
    setError('')
    try {
      let fotoPath: string | null = null
      if (foto) {
        if (fotoSubida.current?.archivo !== foto) fotoSubida.current = { archivo: foto, path: await demandaRepository.subirFoto(foto) }
        fotoPath = fotoSubida.current.path
      }
      const input: AnotarDemandaInput = {
        productoId, descripcion, canal, cantidadAprox: cantidadNumero, unidad,
        contactoNombre: nombre.trim() || null, contactoTel: telefono.trim() || null, quiereAviso, fotoPath,
      }
      const r = await demandaRepository.anotar(input)
      onAnotado(r.vecesSemana)
    } catch (e) {
      setError(esSinConexion(e) ? MENSAJE_SIN_CONEXION : e instanceof Error && e.message ? e.message : 'No se pudo anotar. Inténtalo de nuevo.')
      setEnviando(false)
    }
  }

  const mostrarOpciones = eligiendo && textoLibre.length >= MIN_CARACTERES
  return <Modal title="Un cliente busca algo" subtitle="que no tenemos o se nos acabó" onClose={onClose} className="piso-hoja hoja-demanda">
    <div className="modal-body piso-hoja-cuerpo">
      <label className="piso-campo">¿Qué buscó?
        <input className="piso-input" type="text" autoComplete="off" value={entrada} maxLength={160} onChange={(e) => alEscribir(e.target.value)} />
      </label>
      {mostrarOpciones && <div className="demanda-opciones">
        {productos.length > 0 && <p className="demanda-titulo">EN EL CATÁLOGO</p>}
        <ul className="piso-resultados">
          {productos.map((p) => {
            const s = stock.get(p.id)
            const linea = lineaStock(s)
            const sinStock = s != null && s.tienda <= 0 && s.almacen <= 0
            return <li key={p.id}><button type="button" onClick={() => elegirProducto(p)}>
              <strong>{p.nombre}</strong>
              {linea && <small>{linea}</small>}
              {sinStock && <b className="demanda-chip-sin-stock">Sin stock</b>}
            </button></li>
          })}
          <li><button type="button" className="demanda-opcion-libre" onClick={() => setElegido({ tipo: 'libre' })}>Anotar «{textoLibre}» como producto que no tenemos</button></li>
        </ul>
      </div>}
      <BannerPrevio previa={previaCargada?.clave === claveBanner ? previaCargada.previa : null} />

      <div className="demanda-fila">
        <div className="piso-campo" role="group" aria-label="Cantidad aproximada">Cantidad aproximada
          <div className="demanda-stepper">
            <button type="button" aria-label="Menos" disabled={cantidadNumero <= 1} onClick={() => setCantidad(String(cantidadNumero - 1))}><Minus /></button>
            <input type="text" inputMode="numeric" aria-label="Cantidad" value={cantidad} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value.replace(/[^\d]/g, ''))} onBlur={() => setCantidad(String(cantidadNumero))} />
            <button type="button" aria-label="Más" onClick={() => setCantidad(String(cantidadNumero + 1))}><Plus /></button>
          </div>
        </div>
        <label className="piso-campo">Unidad
          <select className="demanda-select" value={unidad} onChange={(e) => setUnidad(e.target.value as DemandaUnidad)}>
            {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.texto}</option>)}
          </select>
        </label>
      </div>

      <div className="piso-campo" role="group" aria-label="Era para">Era para
        <div className="piso-chips demanda-segmentado">
          {CANALES.map((c) => <button key={c.valor} type="button" aria-pressed={canal === c.valor} className={canal === c.valor ? 'activo' : ''} onClick={() => setCanal(c.valor)}>{c.texto}</button>)}
        </div>
      </div>

      <fieldset className="demanda-cliente">
        <legend className="demanda-titulo">CLIENTE (OPCIONAL)</legend>
        <label className="piso-campo">Nombre<input className="piso-input" type="text" autoComplete="off" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="piso-campo">Teléfono<input className="piso-input" type="tel" inputMode="tel" placeholder="7xxxxxxx" autoComplete="off" value={telefono} maxLength={20} aria-invalid={avisoSinTelefono} aria-describedby={avisoSinTelefono ? 'demanda-tel-error' : undefined} onChange={(e) => setTelefono(e.target.value)} /></label>
        {avisoSinTelefono && <p id="demanda-tel-error" className="piso-error">Para avisarle hace falta su teléfono.</p>}
        <label className="demanda-aviso"><input type="checkbox" checked={quiereAviso} onChange={(e) => setQuiereAviso(e.target.checked)} /> Quiere que le avisen cuando llegue</label>
      </fieldset>

      <div className="demanda-foto">
        {foto && miniatura
          ? <div className="demanda-miniatura"><img src={miniatura} alt="Foto de referencia" /><button type="button" aria-label="Quitar foto" onClick={() => cambiarFoto(null)}><X /></button></div>
          : <label className="piso-secundario demanda-foto-boton"><Camera /> Foto de referencia (opcional)
            <input type="file" accept="image/*" capture="environment" className="demanda-foto-input" aria-label="Foto de referencia (opcional)" onChange={(e) => { cambiarFoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </label>}
        {foto && !miniatura && <p className="piso-hoja-sub">{foto.name}</p>}
      </div>
      {error && <p className="piso-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions"><button type="button" className="piso-enviar" disabled={!puedeAnotar} onClick={() => void anotar()}>{enviando ? 'Anotando…' : 'Anotar'}</button></footer>
  </Modal>
}
