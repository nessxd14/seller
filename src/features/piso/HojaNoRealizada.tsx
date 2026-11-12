import { Camera, ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DemandaCanal, DemandaPrevia, DemandaUnidad } from '../../application/ports/demandaRepository'
import type { MotivoNoRealizada, NoRealizadaLineaInput } from '../../application/ports/pisoRepository'
import { Modal } from '../../components/Modal'
import { demandaRepository, pisoRepository } from '../../infrastructure/services'
import type { Product } from '../../types'
import { BannerPrevio, CANALES, esSinConexion, lineaStock, MIN_CARACTERES, UNIDADES, useCoincidencias } from './demandaComun'

const MAX_LINEAS = 20
const MAX_MOTIVO_TEXTO = 60
const MENSAJE_SIN_CONEXION = 'Sin conexión: no se pudo guardar.'

const MOTIVOS: Array<{ valor: MotivoNoRealizada; texto: string }> = [
  { valor: 'NO_HAY', texto: 'No hay' }, { valor: 'MUY_CARO', texto: 'Muy caro' }, { valor: 'OTRO', texto: 'Otro' },
]

type Elegido = { tipo: 'producto'; id: number; nombre: string } | { tipo: 'libre' } | null

interface LineaForm {
  key: number
  entrada: string
  elegido: Elegido
  cantidad: string
  unidad: DemandaUnidad
  motivo: MotivoNoRealizada | null
  motivoTexto: string
}

export interface HojaNoRealizadaProps {
  textoInicial?: string
  productoInicial?: { id: number; nombre: string }
  onClose: () => void
  /** `vecesSemana`: el mayor número de pedidos de la semana entre los productos "No hay" (0 si ninguno). */
  onGuardado: (vecesSemana: number) => void
}

const lineaNueva = (key: number, textoInicial = '', productoInicial?: { id: number; nombre: string }): LineaForm => ({
  key,
  entrada: productoInicial?.nombre ?? textoInicial,
  elegido: productoInicial ? { tipo: 'producto', id: productoInicial.id, nombre: productoInicial.nombre } : textoInicial.trim() ? { tipo: 'libre' } : null,
  cantidad: '1', unidad: 'UNIDADES', motivo: null, motivoTexto: '',
})

const productoDe = (l: LineaForm): number | null => (l.elegido?.tipo === 'producto' ? l.elegido.id : null)
const descripcionDe = (l: LineaForm): string | null => (productoDe(l) == null && l.entrada.trim() ? l.entrada.trim() : null)
const cantidadDe = (l: LineaForm): number => {
  const n = Math.floor(Number(l.cantidad.replace(',', '.')))
  return Number.isFinite(n) && n >= 1 ? n : 1
}
const lineaCompleta = (l: LineaForm): boolean =>
  (productoDe(l) != null || descripcionDe(l) != null) && l.motivo != null && (l.motivo !== 'OTRO' || l.motivoTexto.trim().length > 0)

export function HojaNoRealizada({ textoInicial = '', productoInicial, onClose, onGuardado }: HojaNoRealizadaProps) {
  const [lineas, setLineas] = useState<LineaForm[]>(() => [lineaNueva(1, textoInicial, productoInicial)])
  const siguienteKey = useRef(2)
  const [canal, setCanal] = useState<DemandaCanal>('TIENDA')
  const [avisoAbierto, setAvisoAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [quiereAviso, setQuiereAviso] = useState(false)
  const [foto, setFoto] = useState<File | null>(null)
  const [miniatura, setMiniatura] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const fotoSubida = useRef<{ archivo: File; path: string } | null>(null)
  const urlActual = useRef<string | null>(null)
  useEffect(() => () => { if (urlActual.current) URL.revokeObjectURL(urlActual.current) }, [])

  const hayNoHay = lineas.some((l) => l.motivo === 'NO_HAY')
  // El contacto, el aviso y la foto solo valen para las líneas "No hay".
  const avisoActivo = hayNoHay && quiereAviso
  const avisoSinTelefono = avisoActivo && !telefono.trim()
  const puedeGuardar = lineas.every(lineaCompleta) && !avisoSinTelefono && !enviando

  const cambiar = (key: number, parche: Partial<LineaForm>) => setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...parche } : l)))
  const quitar = (key: number) => setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  const agregar = () => setLineas((prev) => {
    if (prev.length >= MAX_LINEAS) return prev
    const key = siguienteKey.current
    siguienteKey.current += 1
    return [...prev, lineaNueva(key)]
  })

  const cambiarFoto = (archivo: File | null) => {
    if (urlActual.current) URL.revokeObjectURL(urlActual.current)
    urlActual.current = archivo && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(archivo) : null
    setMiniatura(urlActual.current)
    setFoto(archivo)
    fotoSubida.current = null
  }

  const guardar = async () => {
    if (!puedeGuardar) return
    setEnviando(true)
    setError('')
    try {
      let fotoPath: string | null = null
      if (hayNoHay && foto) {
        if (fotoSubida.current?.archivo !== foto) fotoSubida.current = { archivo: foto, path: await demandaRepository.subirFoto(foto) }
        fotoPath = fotoSubida.current.path
      }
      const payload: NoRealizadaLineaInput[] = lineas.map((l) => ({
        productoId: productoDe(l), descripcion: descripcionDe(l), cantidad: cantidadDe(l), unidad: l.unidad,
        motivo: l.motivo as MotivoNoRealizada, motivoTexto: l.motivo === 'OTRO' ? l.motivoTexto.trim() : null,
      }))
      const r = await pisoRepository.registrarNoRealizada({
        lineas: payload, canal,
        contactoNombre: hayNoHay ? nombre.trim() || null : null,
        contactoTel: hayNoHay ? telefono.trim() || null : null,
        quiereAviso: avisoActivo, fotoPath,
      })
      onGuardado(Math.max(0, ...r.lineas.map((l) => l.vecesSemana ?? 0)))
    } catch (e) {
      setError(esSinConexion(e) ? MENSAJE_SIN_CONEXION : e instanceof Error && e.message ? e.message : 'No se pudo guardar. Inténtalo de nuevo.')
      setEnviando(false)
    }
  }

  return <Modal title="Venta no realizada" subtitle="lo que el cliente quería y no se llevó" onClose={onClose} className="piso-hoja hoja-demanda">
    <div className="modal-body piso-hoja-cuerpo">
      {lineas.map((l, i) => <LineaEditor key={l.key} n={i + 1} linea={l} puedeQuitar={lineas.length > 1} onCambio={(p) => cambiar(l.key, p)} onQuitar={() => quitar(l.key)} />)}
      <button type="button" className="piso-secundario no-realizada-agregar" disabled={lineas.length >= MAX_LINEAS} onClick={agregar}><Plus /> Agregar otro producto</button>

      <div className="piso-campo" role="group" aria-label="Era para">Era para
        <div className="piso-chips demanda-segmentado">
          {CANALES.map((c) => <button key={c.valor} type="button" aria-pressed={canal === c.valor} className={canal === c.valor ? 'activo' : ''} onClick={() => setCanal(c.valor)}>{c.texto}</button>)}
        </div>
      </div>

      <section className="no-realizada-aviso">
        <button type="button" className="no-realizada-aviso-titulo" aria-expanded={avisoAbierto && hayNoHay} disabled={!hayNoHay} onClick={() => setAvisoAbierto((v) => !v)}>
          Avisar al cliente cuando llegue (opcional) <ChevronDown />
        </button>
        {!hayNoHay && <p className="piso-hoja-sub">Se activa cuando algún producto es «No hay».</p>}
        {hayNoHay && avisoAbierto && <fieldset className="demanda-cliente">
          <label className="piso-campo">Nombre<input className="piso-input" type="text" autoComplete="off" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></label>
          <label className="piso-campo">Teléfono<input className="piso-input" type="tel" inputMode="tel" placeholder="7xxxxxxx" autoComplete="off" value={telefono} maxLength={20} aria-invalid={avisoSinTelefono} aria-describedby={avisoSinTelefono ? 'no-realizada-tel-error' : undefined} onChange={(e) => setTelefono(e.target.value)} /></label>
          {avisoSinTelefono && <p id="no-realizada-tel-error" className="piso-error">Para avisarle hace falta su teléfono.</p>}
          <label className="demanda-aviso"><input type="checkbox" checked={quiereAviso} onChange={(e) => setQuiereAviso(e.target.checked)} /> Quiere que le avisen cuando llegue</label>
          <div className="demanda-foto">
            {foto && miniatura
              ? <div className="demanda-miniatura"><img src={miniatura} alt="Foto de referencia" /><button type="button" aria-label="Quitar foto" onClick={() => cambiarFoto(null)}><X /></button></div>
              : <label className="piso-secundario demanda-foto-boton"><Camera /> Foto de referencia (opcional)
                <input type="file" accept="image/*" capture="environment" className="demanda-foto-input" aria-label="Foto de referencia (opcional)" onChange={(e) => { cambiarFoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
              </label>}
            {foto && !miniatura && <p className="piso-hoja-sub">{foto.name}</p>}
          </div>
        </fieldset>}
      </section>
      {error && <p className="piso-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions"><button type="button" className="piso-enviar" disabled={!puedeGuardar} onClick={() => void guardar()}>{enviando ? 'Guardando…' : 'Guardar venta no realizada'}</button></footer>
  </Modal>
}

interface LineaEditorProps { n: number; linea: LineaForm; puedeQuitar: boolean; onCambio: (parche: Partial<LineaForm>) => void; onQuitar: () => void }

function LineaEditor({ n, linea, puedeQuitar, onCambio, onQuitar }: LineaEditorProps) {
  const [previaCargada, setPrevia] = useState<{ clave: string; previa: DemandaPrevia } | null>(null)
  const eligiendo = linea.elegido == null
  const { productos, stock } = useCoincidencias(linea.entrada, eligiendo)
  const textoLibre = linea.entrada.trim()
  const productoId = productoDe(linea)

  // Misma regla de agrupación que anotar_demanda: lo que se ve acá es donde cae la nota. Solo para "No hay".
  const claveBanner = linea.motivo === 'NO_HAY' && linea.elegido ? (productoId != null ? `p:${productoId}` : `t:${textoLibre}`) : null
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

  const elegirProducto = (p: Product) => onCambio({ entrada: p.nombre, elegido: { tipo: 'producto', id: p.id, nombre: p.nombre } })
  const mostrarOpciones = eligiendo && textoLibre.length >= MIN_CARACTERES

  return <fieldset className="no-realizada-linea">
    <legend className="demanda-titulo">PRODUCTO {n}</legend>
    {puedeQuitar && <button type="button" className="no-realizada-quitar" aria-label={`Quitar producto ${n}`} onClick={onQuitar}><X /></button>}
    <label className="piso-campo">Producto
      <input className="piso-input" type="text" autoComplete="off" aria-label={`Producto ${n}`} value={linea.entrada} maxLength={160} onChange={(e) => onCambio({ entrada: e.target.value, elegido: null })} />
    </label>
    {mostrarOpciones && <div className="demanda-opciones">
      {productos.length > 0 && <p className="demanda-titulo">EN EL CATÁLOGO</p>}
      <ul className="piso-resultados">
        {productos.map((p) => {
          const s = stock.get(p.id)
          const detalle = lineaStock(s)
          const sinStock = s != null && s.tienda <= 0 && s.almacen <= 0
          return <li key={p.id}><button type="button" onClick={() => elegirProducto(p)}>
            <strong>{p.nombre}</strong>
            {detalle && <small>{detalle}</small>}
            {sinStock && <b className="demanda-chip-sin-stock">Sin stock</b>}
          </button></li>
        })}
        <li><button type="button" className="demanda-opcion-libre" onClick={() => onCambio({ elegido: { tipo: 'libre' } })}>Anotar «{textoLibre}» como producto que no tenemos</button></li>
      </ul>
    </div>}

    <div className="demanda-fila">
      <label className="piso-campo">Cant.
        <input className="piso-input" type="text" inputMode="numeric" aria-label={`Cantidad ${n}`} value={linea.cantidad} onFocus={(e) => e.currentTarget.select()} onChange={(e) => onCambio({ cantidad: e.target.value.replace(/[^\d]/g, '') })} onBlur={() => onCambio({ cantidad: String(cantidadDe(linea)) })} />
      </label>
      <label className="piso-campo">Unidad
        <select className="demanda-select" aria-label={`Unidad ${n}`} value={linea.unidad} onChange={(e) => onCambio({ unidad: e.target.value as DemandaUnidad })}>
          {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.texto}</option>)}
        </select>
      </label>
    </div>

    <div className="piso-campo" role="group" aria-label={`Por qué no lo llevó, producto ${n}`}>¿Por qué no lo llevó?
      <div className="piso-chips demanda-segmentado">
        {MOTIVOS.map((m) => <button key={m.valor} type="button" aria-pressed={linea.motivo === m.valor} className={linea.motivo === m.valor ? 'activo' : ''} onClick={() => onCambio({ motivo: m.valor })}>{m.texto}</button>)}
      </div>
    </div>
    {linea.motivo === 'OTRO' && <label className="piso-campo">Motivo, en una palabra
      <input className="piso-input" type="text" autoComplete="off" aria-label={`Motivo en una palabra, producto ${n}`} value={linea.motivoTexto} maxLength={MAX_MOTIVO_TEXTO} onChange={(e) => onCambio({ motivoTexto: e.target.value })} />
    </label>}
    <BannerPrevio previa={previaCargada?.clave === claveBanner ? previaCargada.previa : null} />
  </fieldset>
}
