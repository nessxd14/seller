import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { featureFlags } from '../../config/featureFlags'
import type { PedidoLocal } from '../../domain/sales/pedidoPiso'
import { pisoRepository } from '../../infrastructure/services'
import { mockAuthSessionProvider } from '../../infrastructure/mock/MockAuthSessionProvider'
import { supabaseAuthSessionProvider } from '../../infrastructure/supabase/SupabaseAuthSessionProvider'
import type { PisoTurno } from '../../application/ports/pisoRepository'
import { horaCorta } from '../../domain/piso/turnoPiso'

const hora = horaCorta
const mensaje = (e: unknown, porDefecto: string) => (e instanceof Error && e.message ? e.message : porDefecto)

export const cerrarSesion = (): Promise<void> => (featureFlags.supabase ? supabaseAuthSessionProvider.signOut() : mockAuthSessionProvider.setMockUser(null))

/** Botón «Salir» de 44 px para el encabezado. */
export function BotonSalir({ onClick }: { onClick: () => void }) {
  return <button type="button" className="piso-icono con-texto" onClick={onClick}><LogOut /> <span>Salir</span></button>
}

interface Props {
  nombre: string
  /** Pedidos en ARMANDO que se quedan guardados al salir. */
  guardados: PedidoLocal[]
  palabra: string
  onClose: () => void
}

export function SalirPiso({ nombre, guardados, palabra, onClose }: Props) {
  // undefined = todavía no se sabe; null = sin turno.
  const [turno, setTurno] = useState<PisoTurno | null | undefined>(undefined)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    pisoRepository.turnoActual().then((t) => { if (!cancelado) setTurno(t) }).catch(() => { if (!cancelado) setTurno(null) })
    return () => { cancelado = true }
  }, [])

  const salir = async (finalizar: boolean) => {
    setTrabajando(true); setError('')
    try {
      if (finalizar) await pisoRepository.finalizarTurno()
      await cerrarSesion()
    } catch (e) { setError(mensaje(e, finalizar ? 'No se pudo finalizar el turno.' : 'No se pudo cerrar la sesión.')); setTrabajando(false) }
  }

  const unica = guardados.length === 1 ? guardados[0] : null
  const nota = guardados.length === 0 ? null
    : unica ? `Tu ${palabra.toLowerCase()}${unica.numeroDia != null ? ` ${unica.numeroDia}` : ''} guardada no se pierde: la ves al volver a entrar, en este u otro celular.`
      : `Tus ${guardados.length} ${palabra.toLowerCase()}s guardadas no se pierden: las ves al volver a entrar, en este u otro celular.`

  return <Modal title={`¿Cerrar sesión, ${nombre}?`} onClose={() => { if (!trabajando) onClose() }} className="piso-hoja">
    <div className="modal-body piso-hoja-cuerpo">
      {turno === undefined && <p className="piso-hoja-sub" role="status">Cargando…</p>}
      {turno && <p className="piso-hoja-sub">Tu turno sigue abierto desde {hora(turno.inicio)}. Si sales sin finalizarlo, sigue contando hasta {turno.cierraA ? `las ${hora(turno.cierraA)}` : 'el próximo corte'} o hasta que caja cierre.</p>}
      {turno === null && <p className="piso-hoja-sub">Saldrás de este celular. Para volver necesitas tu correo y contraseña.</p>}
      {nota && <p className="piso-aviso-azul">{nota}</p>}
      {error && <p className="piso-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-actions piso-salir-acciones">
      {turno && <>
        <button type="button" className="piso-enviar" disabled={trabajando} onClick={() => void salir(true)}>Finalizar turno y salir</button>
        <button type="button" className="piso-secundario" disabled={trabajando} onClick={() => void salir(false)}>Salir y seguir en turno</button>
      </>}
      {turno === null && <button type="button" className="piso-enviar" disabled={trabajando} onClick={() => void salir(false)}>Cerrar sesión</button>}
      <button type="button" className="piso-texto-boton" disabled={trabajando} onClick={onClose}>Cancelar</button>
    </footer>
  </Modal>
}
