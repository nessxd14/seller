import { useRef, useState } from 'react'
import type { ComisionDevengoRow } from '../../application/ports/comisionesRepository'
import { Modal } from '../../components/Modal'
import { supabase } from '../../infrastructure/supabase/supabaseClient'
import { consultarDetalleCobroPedido } from '../../infrastructure/supabase/CobroPedido.supabase'
import { dineroCobro } from '../../domain/orders/detalleCobro'

export function RevisarBaseComision({ row, onGuardado }: { row: ComisionDevengoRow; onGuardado: () => void }) {
 const [abierto,setAbierto]=useState(false)
 const [total,setTotal]=useState<number|null>(null)
 const [base,setBase]=useState(String(row.baseComisionableCents/100))
 const [monto,setMonto]=useState(String(row.montoCents/100))
 const [motivo,setMotivo]=useState('')
 const [error,setError]=useState('')
 const [ocupado,setOcupado]=useState(false)
 const enviando=useRef(false)
 const version=useRef(0)
 const abrir=async()=>{
  const n=++version.current
  setAbierto(true);setTotal(null);setError('');setMotivo('')
  try { const detalle=await consultarDetalleCobroPedido(row.documentoId); if(n===version.current)setTotal(detalle.pedido?Number(detalle.pedido.total):null) }
  catch { if(n===version.current)setError('No se pudo consultar el importe actual. Cierra y vuelve a intentarlo.') }
 }
 const cerrar=()=>{if(!enviando.current){version.current+=1;setAbierto(false)}}
 const guardar=async()=>{
  if(enviando.current||total===null||!base.trim()||!monto.trim()||!motivo.trim())return
  const b=Number(base),m=Number(monto)
  if(!Number.isFinite(b)||!Number.isFinite(m)||b<=0||m<0||m>b){setError('Revisa la base y el importe de la comisión.');return}
  enviando.current=true;setOcupado(true);setError('')
  try {
   const r=await supabase.rpc('comision_revisar_base',{p_devengo_id:Number(row.id),p_total_revisado:total,p_base:b,p_monto:m,p_motivo:motivo.trim()})
   if(r.error)throw r.error
   setAbierto(false);onGuardado()
  }catch(e){setError(e&&typeof e==='object'&&'message' in e?String(e.message):'No se pudo guardar la revisión')}
  finally{enviando.current=false;setOcupado(false)}
 }
 return <>
  <button className="secondary-button" onClick={()=>void abrir()}>Revisar base de comisión</button>
  {abierto&&<Modal title="Revisar base de comisión" onClose={cerrar}>
   <p>Pedido {row.documentoId} · importe actual: {total===null?'Consultando…':dineroCobro(total)}</p>
   <p>Revisa los productos y los importes antes de guardar. Se conservarán los valores anteriores, el motivo y tu identidad.</p>
   <fieldset className="form-grid" disabled={ocupado||total===null}>
    <label>Base comisionable (Bs)<input type="number" min="0.01" step="0.01" value={base} onChange={e=>setBase(e.target.value)} /></label>
    <label>Comisión revisada (Bs)<input type="number" min="0" step="0.01" value={monto} onChange={e=>setMonto(e.target.value)} /></label>
    <label>Motivo de la revisión<textarea maxLength={2000} value={motivo} onChange={e=>setMotivo(e.target.value)} /></label>
   </fieldset>
   {error&&<p role="alert">{error}</p>}
   <div className="modal-actions"><button disabled={ocupado} onClick={cerrar}>Volver</button><button className="primary-button" disabled={ocupado||total===null||!motivo.trim()} onClick={()=>void guardar()}>{ocupado?'Guardando…':'Guardar revisión'}</button></div>
  </Modal>}
 </>
}
