import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../infrastructure/supabase/supabaseClient'
import { fechaCobro, rolActor, type ActorCobro } from '../../domain/orders/detalleCobro'

interface Evento { id: number; actor: ActorCobro; antes: { estado?: string } | null; despues: { estado: string; revision_motivo?: string | null; motivo_anulacion_liquidacion?: string | null; motivo_revision_base?: string }; creado_en: string }
export function HistorialComision({ id }: { id: string }) {
 const [eventos, setEventos] = useState<Evento[]>([])
 const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
 const [anterior, setAnterior] = useState<number | null>(null)
 const solicitud = useRef(0)
 useEffect(() => {
  const n = ++solicitud.current
  void Promise.resolve(supabase.rpc('comision_historial', { p_devengo_id: Number(id), p_antes_id: anterior })).then(({ data, error }) => {
   if (n !== solicitud.current) return
   if (error || !Array.isArray(data) || data.some(e => !Number.isSafeInteger(e.id) || !e.actor?.nombre || !e.despues?.estado)) { setEstado('error'); return }
   setEventos(data as Evento[]); setEstado('listo')
  }).catch(() => { if (n === solicitud.current) setEstado('error') })
  return () => { solicitud.current += 1 }
 }, [id, anterior])
 return <section className="comision-historial" aria-label="Historial de la comisión">
  <h3>Historial de la comisión</h3>
  {estado === 'cargando' ? <p>Cargando historial…</p> : estado === 'error' ? <p role="alert">No se pudo consultar el historial.</p> : !eventos.length ? <p>Sin eventos en esta página. El historial conserva las acciones desde su activación.</p> : <ol>{eventos.map(e => <li key={e.id}>
   <strong>{e.antes?.estado ?? 'Registro'} → {e.despues.estado}</strong> · {fechaCobro(e.creado_en)}
   <p>{e.actor.nombre} · {rolActor(e.actor)}</p>{e.despues.revision_motivo && <p>{e.despues.revision_motivo}</p>}{e.despues.motivo_anulacion_liquidacion && <p>Motivo de anulación: {e.despues.motivo_anulacion_liquidacion}</p>}{e.despues.motivo_revision_base && <p>Motivo de revisión: {e.despues.motivo_revision_base}</p>}
  </li>)}</ol>}
  {estado === 'listo' && eventos.length === 50 && <button className="secondary-button" onClick={() => { setEstado('cargando'); setAnterior(eventos.at(-1)!.id) }}>Ver eventos anteriores</button>}
  {anterior !== null && <button className="secondary-button" onClick={() => { setEstado('cargando'); setAnterior(null) }}>Volver a los más recientes</button>}
 </section>
}
