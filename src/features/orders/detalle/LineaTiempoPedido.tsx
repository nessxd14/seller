import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import type { ComentarioTiempo, EventoTiempo, LineaTiempo, RolActor, VersionTiempo } from '../../../domain/orders/pedidoEdicion.types'
import { diffVersionLines } from '../../../domain/orders/versionDiff'
import { featureFlags } from '../../../config/featureFlags'
import { listVersionesPedido, type PedidoVersion } from '../../../infrastructure/supabase/OrderAdmin.supabase'
import { Chip } from './Chip'
import { bs, cant, deltaBs, etiquetaDia, horaCorta } from './formato'

type FiltroTiempo = 'todo' | RolActor | 'total'

const ROLES: Array<{ id: RolActor; etiqueta: string; rol: string }> = [
  { id: 'SELLER', etiqueta: 'Seller', rol: 'Seller' },
  { id: 'ALMACEN', etiqueta: 'Almacén', rol: 'Almacén' },
  { id: 'CAJA', etiqueta: 'Caja', rol: 'Caja' },
  { id: 'SISTEMA', etiqueta: 'Sistema', rol: 'Sistema' },
]
const rolTexto = (rol: RolActor): string => ROLES.find((r) => r.id === rol)?.rol ?? rol

type Entrada = { clase: 'evento'; fecha: string; evento: EventoTiempo } | { clase: 'comentario'; fecha: string; comentario: ComentarioTiempo }

function ChipsEvento({ evento }: { evento: EventoTiempo }) {
  const delta = evento.delta_total
  return <div className="ped-evento-chips">
    {delta != null && delta !== 0 && <Chip tone={delta > 0 ? 'orange' : 'red'}>{deltaBs(delta)}</Chip>}
    {delta === 0 && <Chip tone="gray">Sin efecto en el total</Chip>}
    {evento.actor_rol === 'ALMACEN' && (evento.tipo === 'SUSTITUCION' || evento.tipo === 'SIN_CUBRIR') && <Chip tone="violet">Aviso enviado al Seller</Chip>}
    {delta != null && delta !== 0 && evento.actor_rol !== 'SISTEMA' && <Chip tone="blue">Partida Hermes actualizada</Chip>}
    {evento.tipo === 'DESPACHO' && <Chip tone="green">Salida registrada en Kardex</Chip>}
  </div>
}

function VersionesPanel({ versiones, activa, onElegir }: { versiones: VersionTiempo[]; activa: number | null; onElegir: (version: number) => void }) {
  return <aside className="ped-versiones" aria-label="Versiones">
    <h4>Versiones</h4>
    <ul>
      {versiones.map((v) => <li key={v.version}>
        <button type="button" className={activa === v.version ? 'activa' : ''} aria-pressed={activa === v.version} onClick={() => onElegir(v.version)}>
          <strong>v{v.version} · {v.etiqueta}</strong>{(v.es_vigente ?? v === versiones[0]) && <Chip tone="green">Vigente</Chip>}<b>{bs(v.total)}</b>
        </button>
      </li>)}
    </ul>
  </aside>
}

/** Una versión vieja en solo lectura (nunca se ofrece restaurarla: ¿qué pasa con lo ya despachado?). */
function VersionLectura({ pedidoId, version, versiones, onVolver }: { pedidoId: number; version: number; versiones: VersionTiempo[]; onVolver: () => void }) {
  const [cargadas, setCargadas] = useState<PedidoVersion[] | null>(null)
  const [fallo, setFallo] = useState(false)
  useEffect(() => {
    if (!featureFlags.supabase) return
    let cancelado = false
    void listVersionesPedido(pedidoId).then((v) => { if (!cancelado) setCargadas(v) }).catch(() => { if (!cancelado) setFallo(true) })
    return () => { cancelado = true }
  }, [pedidoId])
  const resumen = versiones.find((v) => v.version === version)
  const indice = cargadas?.findIndex((v) => v.version === version) ?? -1
  const actual = indice >= 0 ? cargadas![indice] : null
  const previa = indice > 0 ? cargadas![indice - 1] : undefined
  const diff = actual ? diffVersionLines(previa?.lineas, actual.lineas) : null
  return <section className="ped-version-lectura" aria-label={`Versión ${version}`}>
    <p className="version-readonly-banner">Estás viendo v{version}{resumen ? ` · ${resumen.etiqueta}` : ''}: el pedido como estaba antes de ese cambio. Solo lectura. <button type="button" onClick={onVolver}>Volver a la línea de tiempo</button></p>
    {!featureFlags.supabase && <p className="ped-nota">El detalle de líneas por versión solo está disponible con la base conectada. Total de esta versión: {resumen ? bs(resumen.total) : '—'}.</p>}
    {featureFlags.supabase && !cargadas && !fallo && <p className="ped-nota">Cargando versión…</p>}
    {fallo && <p className="ped-nota ped-rojo" role="alert">No se pudo cargar la versión.</p>}
    {actual && <ul className="ped-version-lineas">
      {actual.lineas.map((linea) => {
        const d = diff?.get(linea.lineaId)
        const nombre = linea.esPersonalizado ? (linea.descripcion ?? 'Ítem personalizado') : (linea.descripcion || linea.productoNombre || 'Producto')
        return <li key={linea.lineaId} className={`version-line-${d?.kind ?? 'unchanged'}`}>
          <span>{nombre}</span><span>{cant(linea.cantidadPresentacion ?? linea.cantidadBase)} × {bs(linea.precioUnitario)}</span>
          {d?.kind === 'added' && <Chip tone="green">Agregada</Chip>}
          {d?.kind === 'changed' && <Chip tone="orange">{[d.cantidadCambio && 'cantidad', d.precioCambio && 'precio'].filter(Boolean).join(' y ')} distinto</Chip>}
        </li>
      })}
      {Array.from(diff?.values() ?? []).filter((d) => d.kind === 'removed').map((d) => {
        const quitada = previa?.lineas.find((l) => l.lineaId === d.lineaId)
        return quitada ? <li key={`q${d.lineaId}`} className="version-line-removed"><span>{quitada.descripcion || quitada.productoNombre || 'Producto'}</span><Chip tone="red">Quitada</Chip></li> : null
      })}
    </ul>}
  </section>
}

export function LineaTiempoPedido({ pedidoId, datos, cargando, error, enfocarComentario, onComentar }: {
  pedidoId: number
  datos: LineaTiempo | null
  cargando: boolean
  error: boolean
  /** Cambia cada vez que el encabezado pide "Comentar": enfoca el campo. */
  enfocarComentario: number
  onComentar: (texto: string) => Promise<void>
}) {
  const [filtro, setFiltro] = useState<FiltroTiempo>('todo')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [versionAbierta, setVersionAbierta] = useState<number | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => { if (enfocarComentario > 0) campo.current?.focus() }, [enfocarComentario])

  const entradas = useMemo<Entrada[]>(() => {
    if (!datos) return []
    const eventos = datos.eventos
      .filter((e) => filtro === 'todo' || (filtro === 'total' ? e.delta_total != null && e.delta_total !== 0 : e.actor_rol === filtro))
      .map((evento): Entrada => ({ clase: 'evento', fecha: evento.creado_en, evento }))
    const comentarios = filtro === 'todo' || filtro === 'SELLER'
      ? datos.comentarios.map((comentario): Entrada => ({ clase: 'comentario', fecha: comentario.creado_en, comentario }))
      : []
    return [...eventos, ...comentarios].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  }, [datos, filtro])

  const dias = useMemo(() => {
    const grupos: Array<{ etiqueta: string; entradas: Entrada[] }> = []
    for (const entrada of entradas) {
      const etiqueta = etiquetaDia(entrada.fecha)
      const ultimo = grupos.at(-1)
      if (ultimo?.etiqueta === etiqueta) ultimo.entradas.push(entrada)
      else grupos.push({ etiqueta, entradas: [entrada] })
    }
    return grupos
  }, [entradas])

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (!texto.trim() || enviando) return
    setEnviando(true)
    try { await onComentar(texto.trim()); setTexto('') } finally { setEnviando(false) }
  }

  if (cargando && !datos) return <p className="ped-nota" aria-busy="true">Cargando línea de tiempo…</p>
  if (error || !datos) return <p className="ped-nota ped-rojo" role="alert">No se pudo cargar la línea de tiempo.</p>

  return <div className="ped-tiempo">
    <div className="ped-tiempo-principal">
      {versionAbierta != null
        ? <VersionLectura pedidoId={pedidoId} version={versionAbierta} versiones={datos.versiones} onVolver={() => setVersionAbierta(null)} />
        : <>
          <div className="ped-filtros" role="group" aria-label="Filtrar la línea de tiempo">
            <button type="button" className={filtro === 'todo' ? 'activa' : ''} aria-pressed={filtro === 'todo'} onClick={() => setFiltro('todo')}>Todo</button>
            {ROLES.map((rol) => <button key={rol.id} type="button" className={filtro === rol.id ? 'activa' : ''} aria-pressed={filtro === rol.id} onClick={() => setFiltro(rol.id)}><i className={`ped-punto ped-punto-${rol.id.toLowerCase()}`} aria-hidden />{rol.etiqueta}</button>)}
            <button type="button" className={filtro === 'total' ? 'activa' : ''} aria-pressed={filtro === 'total'} onClick={() => setFiltro('total')}>Solo lo que cambió el total</button>
          </div>
          <form className="ped-comentar" onSubmit={(e) => void enviar(e)}>
            <label className="ped-sr" htmlFor="ped-comentario">Escribe un comentario sobre el pedido</label>
            <MessageSquare aria-hidden />
            <input id="ped-comentario" ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe un comentario sobre el pedido…" maxLength={500} />
            <button type="submit" className="ped-btn ped-btn-primario" disabled={!texto.trim() || enviando}><Send aria-hidden />Comentar</button>
          </form>
          {!dias.length && <p className="ped-nota">No hay movimientos con este filtro.</p>}
          {dias.map((dia) => <section key={dia.etiqueta} className="ped-dia" aria-label={dia.etiqueta}>
            <h4>{dia.etiqueta}</h4>
            <ol>
              {dia.entradas.map((entrada) => entrada.clase === 'comentario'
                ? <li key={`c${entrada.comentario.id}`} className="ped-evento ped-evento-comentario">
                  <span className="ped-avatar ped-avatar-seller" aria-hidden>{entrada.comentario.autor.charAt(0).toUpperCase()}</span>
                  <div className="ped-evento-tarjeta"><p><strong>{entrada.comentario.autor}</strong> comentó <small>{horaCorta(entrada.comentario.creado_en)}</small></p><blockquote>{entrada.comentario.texto}</blockquote></div>
                </li>
                : <li key={`e${entrada.evento.id}`} className="ped-evento">
                  <span className={`ped-avatar ped-avatar-${entrada.evento.actor_rol.toLowerCase()}`} aria-hidden>{entrada.evento.actor.charAt(0).toUpperCase()}</span>
                  <div className="ped-evento-tarjeta">
                    <p><strong>{entrada.evento.actor}</strong> ({rolTexto(entrada.evento.actor_rol)}) {entrada.evento.titulo}
                      <small>{horaCorta(entrada.evento.creado_en)}{entrada.evento.version_antes != null && entrada.evento.version_despues != null ? ` · v${entrada.evento.version_antes} → v${entrada.evento.version_despues}` : ''}</small></p>
                    {entrada.evento.cambios.length > 0 && <ul className="ped-evento-cambios">{entrada.evento.cambios.map((c, i) => <li key={i}>{c.texto}</li>)}</ul>}
                    <ChipsEvento evento={entrada.evento} />
                    {entrada.evento.motivo && <p className="ped-evento-motivo">Motivo: {entrada.evento.motivo}</p>}
                    {entrada.evento.version_despues != null && <button type="button" className="ped-enlace" onClick={() => setVersionAbierta(entrada.evento.version_despues)}>Ver versión {entrada.evento.version_despues}</button>}
                  </div>
                </li>)}
            </ol>
          </section>)}
        </>}
    </div>
    <VersionesPanel versiones={datos.versiones} activa={versionAbierta} onElegir={setVersionAbierta} />
  </div>
}
