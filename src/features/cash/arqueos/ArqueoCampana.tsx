import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CajaRegistradoraIcon } from './CajaRegistradoraIcon'
import { ArqueoPeriodicoModal } from './ArqueoPeriodicoModal'
import { estadoArqueoUi, formatoCuentaRegresiva, horaCorta } from './arqueoUi'
import { useArqueoPendiente } from './useArqueoPendiente'
import '../../../styles/pos-arqueos.css'

const PATRON_VIBRACION = [200, 100, 200]
const MINUTOS_PARA_CONTAR = 30
// Un arqueo se anuncia (toast + vibración) una sola vez por estado, aunque la pantalla se recargue.
const anunciados = new Set<string>()

const vibrar = () => { try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(PATRON_VIBRACION) } catch { /* solo existe en Android */ } }

/**
 * Campana de arqueos periódicos. Solo se pinta con un cajero con turno abierto. Nunca bloquea
 * la venta: el diálogo se cierra con "Más tarde" y la campana sigue activa.
 */
export function ArqueoCampana({ notify, variante = 'escritorio' }: { notify: (message: string) => void; variante?: 'escritorio' | 'movil' }) {
  const { activo, estado, arqueo, restanteMs, total, arqueos, ahoraMs, refrescar, registrar } = useArqueoPendiente()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [listaAbierta, setListaAbierta] = useState(false)
  const [anuncio, setAnuncio] = useState('')
  const raiz = useRef<HTMLDivElement>(null)

  const clave = arqueo ? `${arqueo.programadoEn}|${estado}` : ''
  useEffect(() => {
    if (!arqueo || !clave || anunciados.has(clave)) return
    anunciados.add(clave)
    vibrar()
    if (estado === 'pendiente') {
      notify(`Es hora del arqueo ${arqueo.numero} de ${total} — tienes ${MINUTOS_PARA_CONTAR} min`)
      void Promise.resolve().then(() => setAnuncio(`Es hora del arqueo ${arqueo.numero} de ${total}`))
    } else {
      void Promise.resolve().then(() => setAnuncio(`El arqueo ${arqueo.numero} de ${total} está fuera de hora`))
    }
  }, [clave, arqueo, estado, total, notify])

  useEffect(() => {
    if (!listaAbierta) return
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setListaAbierta(false) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setListaAbierta(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [listaAbierta])

  if (!activo) return null
  const hayArqueo = estado !== 'nada' && arqueo !== undefined
  const tarde = estado === 'fuera_de_hora'
  const minutos = Math.max(1, Math.ceil((restanteMs ?? 0) / 60_000))
  const etiqueta = !hayArqueo
    ? 'Arqueos del turno'
    : tarde
      ? `Arqueo ${arqueo.numero} de ${total} fuera de hora`
      : `Arqueo ${arqueo.numero} de ${total} pendiente, quedan ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`

  const alHacerClic = () => {
    if (hayArqueo) { setListaAbierta(false); setModalAbierto(true); return }
    setListaAbierta((v) => !v)
  }

  return <div ref={raiz} className={`arqueo-campana arqueo-campana--${variante}`}>
    <button
      type="button"
      key={hayArqueo ? arqueo.programadoEn : 'idle'}
      className={`arqueo-campana__boton${hayArqueo ? ' esta-pendiente' : ''}${tarde ? ' esta-tarde' : ''}`}
      aria-label={etiqueta}
      aria-haspopup={hayArqueo ? 'dialog' : 'true'}
      aria-expanded={hayArqueo ? undefined : listaAbierta}
      onClick={alHacerClic}
    >
      <span className="arqueo-campana__iconos" aria-hidden="true">
        <Bell className="arqueo-campana__campana" />
        <CajaRegistradoraIcon className="arqueo-campana__caja" />
      </span>
      {hayArqueo && <span className={`arqueo-campana__chip${tarde ? ' es-tarde' : ''}`}>{tarde ? 'Fuera de hora' : formatoCuentaRegresiva(restanteMs ?? 0)}</span>}
    </button>
    <span className="arqueo-campana__anuncio" role="status" aria-live="polite">{anuncio}</span>

    {listaAbierta && !hayArqueo && <div className="arqueo-campana__lista" role="dialog" aria-label="Arqueos del turno">
      <strong>Arqueos del turno</strong>
      {arqueos.length === 0
        ? <p>Sin arqueos programados en este turno.</p>
        : <ul>{arqueos.map((a) => { const ui = estadoArqueoUi(a, ahoraMs); return <li key={a.numero}><span>Arqueo {a.numero}</span><span>{horaCorta(a.programadoEn)}</span><span className={`arqueo-estado es-${ui.tono}`}>{ui.texto}</span></li> })}</ul>}
    </div>}

    {modalAbierto && hayArqueo && <ArqueoPeriodicoModal
      key={arqueo.programadoEn}
      numero={arqueo.numero}
      total={total}
      fueraDeHora={tarde}
      registrar={registrar}
      refrescar={refrescar}
      notify={notify}
      onClose={() => setModalAbierto(false)}
    />}
  </div>
}
