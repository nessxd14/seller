// Transporte de la pantalla del cliente. Supabase Realtime broadcast en un canal PRIVADO
// (las políticas de realtime.messages deciden quién emite y quién escucha). En modo mock se usa
// un BroadcastChannel del navegador, para probar con dos pestañas sin base de datos.
import { featureFlags } from '../../config/featureFlags'
import { supabase } from '../../infrastructure/supabase/supabaseClient'
import { PANTALLA_EVENT, PANTALLA_TOPIC, esPantallaEstado, type PantallaEstado } from '../../domain/pantalla/pantallaCliente'

export interface PantallaEmisorTransporte {
  enviar(estado: PantallaEstado): Promise<void>
  cerrar(): void
}

export interface PantallaReceptorTransporte {
  cerrar(): void
}

const canalMock = (cajaId: number) => `pantalla-caja-${cajaId}`

export async function abrirEmisor(cajaId: number): Promise<PantallaEmisorTransporte> {
  if (!featureFlags.supabase) {
    const canal = new BroadcastChannel(canalMock(cajaId))
    return { enviar: async (estado) => { canal.postMessage(estado) }, cerrar: () => canal.close() }
  }
  // Los canales privados necesitan el JWT del usuario.
  await supabase.realtime.setAuth()
  let suscrito = false
  let ultimo: PantallaEstado | null = null
  const canal = supabase.channel(PANTALLA_TOPIC(cajaId), { config: { private: true, broadcast: { self: false, ack: false } } })
  const emitir = (estado: PantallaEstado) => canal.send({ type: 'broadcast', event: PANTALLA_EVENT, payload: estado })
  canal.subscribe((status) => {
    suscrito = status === 'SUBSCRIBED'
    // Al (re)unirse se reenvía el último snapshot: la tablet no espera al próximo latido.
    if (suscrito && ultimo) void Promise.resolve(emitir(ultimo)).catch((error) => console.warn('[pantalla-cliente] reenvío falló', error))
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[pantalla-cliente] canal no disponible:', status)
  })
  return {
    enviar: async (estado) => {
      ultimo = estado
      if (!suscrito) return
      const resultado = await emitir(estado)
      if (resultado !== 'ok') throw new Error(`broadcast ${String(resultado)}`)
    },
    cerrar: () => { void supabase.removeChannel(canal) },
  }
}

export interface PantallaReceptorOpciones {
  cajaId: number
  onEstado: (estado: PantallaEstado) => void
}

export async function abrirReceptor({ cajaId, onEstado }: PantallaReceptorOpciones): Promise<PantallaReceptorTransporte> {
  const recibir = (payload: unknown) => { if (esPantallaEstado(payload, cajaId)) onEstado(payload) }
  if (!featureFlags.supabase) {
    const canal = new BroadcastChannel(canalMock(cajaId))
    canal.onmessage = (evento: MessageEvent) => recibir(evento.data)
    return { cerrar: () => canal.close() }
  }
  await supabase.realtime.setAuth()
  const canal = supabase.channel(PANTALLA_TOPIC(cajaId), { config: { private: true } })
    .on('broadcast', { event: PANTALLA_EVENT }, (mensaje: { payload?: unknown }) => recibir(mensaje.payload))
  canal.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[pantalla-cliente] canal no disponible:', status)
  })
  return { cerrar: () => { void supabase.removeChannel(canal) } }
}

/** Caja que escucha esta tablet: rpc('pantalla_caja_actual'). En mock, la caja 1. */
export async function cajaDeEstaPantalla(): Promise<number | null> {
  if (!featureFlags.supabase) return 1
  const { data, error } = await supabase.rpc('pantalla_caja_actual')
  if (error) throw error
  return typeof data === 'number' ? data : data == null ? null : Number(data)
}
