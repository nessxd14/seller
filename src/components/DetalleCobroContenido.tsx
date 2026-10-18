import { dineroCobro, fechaCobro, nombreEventoCobro, rolActor, type ActorCobro, type DetalleCobro, type TurnoCobro } from '../domain/orders/detalleCobro'

function Actor({ value, label }: { value: ActorCobro | null; label: string }) {
  return <div className="cobro-traza-actor"><dt>{label}</dt><dd>{value?.nombre ?? 'Usuario no registrado'}{value && <small>{rolActor(value)}</small>}</dd></div>
}
function Turno({ value }: { value: TurnoCobro | null }) {
  return <><div><dt>Caja y turno</dt><dd>{value ? `${value.caja ?? 'Caja sin nombre'} · Turno #${value.id}` : 'No registrado'}</dd></div>{value && <Actor value={value.responsable} label="Responsable del turno" />}</>
}
export function DetalleCobroContenido({ data, onMas, cargandoMas = false }: { data: DetalleCobro; onMas?: () => void; cargandoMas?: boolean }) {
  const { resumen } = data
  const cancelado = data.pedido?.estado === 'CANCELADO'
  const totalVigente = data.partidas.filter(p => p.estado !== 'ANULADA').reduce((sum, p) => sum + Math.round(Number(p.total) * 100), 0)
  const importeInconsistente = !!data.pedido && resumen.vigentes > 0 && totalVigente !== Math.round(Number(data.pedido.total) * 100)
  const nombrePartida = (id: number) => data.partidas.find(p => p.id === id)?.documento ?? `Partida #${id}`
  return <div className="cobro-traza-contenido">
    {cancelado && resumen.vigentes > 0 && <p role="status">Pedido cancelado con partidas vigentes: revisa la resolución del dinero.</p>}
    {importeInconsistente && <p role="status">El total de las partidas vigentes no coincide con el pedido. Revisa la diferencia antes de considerar resuelta la cuenta.</p>}
    <div className={`cobro-traza-resumen ${!cancelado && !importeInconsistente && resumen.vigentes > 0 && resumen.saldadas === resumen.vigentes ? 'saldado' : ''}`}>
      <strong>{resumen.vigentes ? `${resumen.saldadas} de ${resumen.vigentes} partidas saldadas` : 'Sin partidas vigentes'}</strong>
      <span>{resumen.anuladas > 0 ? `${resumen.anuladas} partida(s) anulada(s), fuera del conteo vigente.` : 'El cobro y la entrega mantienen estados independientes.'}</span>
    </div>
    <h3>{data.pedido ? 'Partidas del pedido' : 'Partida de la cuenta'}</h3>
    {data.partidas.length === 0 ? <p>No hay partidas vinculadas a este pedido.</p> : <div className="cobro-traza-partidas">{data.partidas.map(p => <article key={p.id} className={`cobro-traza-partida ${p.id === data.partida_enfocada ? 'enfocada' : ''}`}>
      <header><strong>{p.documento}</strong><span className={`cobro-traza-estado ${p.saldada ? 'saldada' : p.estado === 'ANULADA' ? 'anulada' : 'pendiente'}`}>{p.estado === 'ANULADA' ? 'Anulada' : p.saldada ? 'Saldada' : Number(p.en_revision) > 0 ? 'Por verificar' : 'Pendiente'}</span></header>
      <small>{p.parent_id ? `Entrega ${p.entrega_numero ?? 'adicional'} · partida hija` : 'Partida principal'}{p.referencia ? ` · ${p.referencia}` : ''}</small>
      <dl className="cobro-traza-importes"><div><dt>Total</dt><dd>{dineroCobro(p.total)}</dd></div><div><dt>Aplicado confirmado</dt><dd>{dineroCobro(p.aplicado)}</dd></div><div><dt>Por verificar</dt><dd>{dineroCobro(p.en_revision)}</dd></div><div><dt>Saldo contable</dt><dd>{dineroCobro(p.pendiente)}</dd></div></dl>
      {p.saldada && <p className="cobro-traza-fecha">{p.fecha_saldado_fuente === 'AUDITADA' ? `Saldada el ${fechaCobro(p.saldada_en)}` : 'Fecha de saldado no registrada en el historial anterior.'}</p>}
    </article>)}</div>}
    <h3>Quién cobró y verificó cada pago</h3>
    {data.pagos.length === 0 ? <p>No hay pagos de dinero vinculados. Las aplicaciones de saldo existente se muestran por separado.</p> : data.pagos.map(p => <article key={p.id} className="cobro-traza-pago">
      <header><strong>Pago #{p.id} · {dineroCobro(p.monto)}</strong><span>{p.estado.replaceAll('_', ' ')}</span></header>
      <p>{p.medio} · {fechaCobro(p.creado_en)} · {p.referencia || 'Sin referencia'}</p>
      <dl className="cobro-traza-personas"><Actor value={p.cobrado_por} label="Cobrado / recibido por" /><Actor value={p.verificado_por} label="Verificación o decisión por" /><Turno value={p.turno} /></dl>
      {p.verificado_en && <p>Verificación o decisión: {fechaCobro(p.verificado_en)}</p>}
      <p><strong>Aplicado a estas partidas: {dineroCobro(p.aplicado_pedido)}</strong>{p.estado === 'PROPUESTO' && ' · Por verificar, todavía no confirmado.'}</p>
      {p.aplicaciones.length > 0 ? <ul>{p.aplicaciones.map((a, i) => <li key={`${a.partida_id}-${i}`}>{nombrePartida(a.partida_id)}: {dineroCobro(a.monto)}</li>)}</ul> : <p>Este pago no tiene una aplicación vigente a estas partidas.</p>}
      {Number(p.devuelto) > 0 && <p>Devolución registrada: {dineroCobro(p.devuelto)}</p>}
    </article>)}
    {data.saldos.length > 0 && <><h3>Saldo a favor utilizado</h3>{data.saldos.map(s => <article key={s.id} className="cobro-traza-pago">
      <header><strong>Aplicación #{s.id} · {dineroCobro(s.monto)}</strong><span>{s.anulado_en ? 'Revertida' : 'Aplicada'}</span></header>
      <p>{fechaCobro(s.creado_en)} · Uso de saldo existente del cliente.</p><dl className="cobro-traza-personas"><Actor value={s.aplicado_por} label="Aplicado por" /><Turno value={s.turno} /></dl>
      <ul>{s.aplicaciones.map(a => <li key={a.partida_id}>{nombrePartida(a.partida_id)}: {dineroCobro(a.monto)}</li>)}</ul>
      {s.anulado_en && <p>Revertida el {fechaCobro(s.anulado_en)} · {s.motivo || 'Motivo no registrado'}</p>}
    </article>)}</>}
    <h3>Historial de cobros y aplicaciones</h3>
    <p className="cobro-traza-nota">Los eventos conservan nombre y rol al realizar la acción. Los cobros anteriores muestran los datos disponibles, sin atribuirles un rol histórico que no se registró.{data.captura_desde && ` Historial detallado desde ${fechaCobro(data.captura_desde)}.`}</p>
    {data.historial.length === 0 ? <p>No hay eventos nuevos registrados para este pedido. Los pagos anteriores aparecen arriba.</p> : <ol className="cobro-traza-historial">{data.historial.map(e => <li key={e.id}>
      <strong>{nombreEventoCobro(e.accion)}</strong><span>{fechaCobro(e.creado_en)}</span><p>{e.actor.nombre} · {rolActor(e.actor)}</p>
      <small>{[e.pago_id ? `Pago #${e.pago_id}` : '', e.partida_id ? nombrePartida(e.partida_id) : '', e.uso_id ? `Uso de saldo #${e.uso_id}` : ''].filter(Boolean).join(' · ')}</small>
      {e.antes?.monto != null && e.despues?.monto != null && String(e.antes.monto) !== String(e.despues.monto) && <p>Importe: {dineroCobro(String(e.antes.monto))} → {dineroCobro(String(e.despues.monto))}</p>}
      {typeof e.despues?.motivo === 'string' && <p>{e.despues.motivo}</p>}
    </li>)}</ol>}
    <footer className="cobro-traza-paginacion"><span>{data.historial.length} de {data.historial_total} eventos</span>{data.siguiente != null && onMas && <button type="button" disabled={cargandoMas} onClick={onMas}>{cargandoMas ? 'Consultando…' : 'Ver eventos anteriores'}</button>}</footer>
  </div>
}
