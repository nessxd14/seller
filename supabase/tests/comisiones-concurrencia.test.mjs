import pg from 'pg'
import assert from 'node:assert/strict'

// Se ejecuta después de la suite financiera, exclusivamente en PostgreSQL local.
export async function validarConcurrencia(connectionString) {
 const url=new URL(connectionString)
 if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.startsWith('/cation_pruebas'))throw Error('Sólo base de pruebas local')
 const clientes=await Promise.all([0,1,2].map(async()=>{const c=new pg.Client({connectionString});await c.connect();return c}))
 const [a,b,control]=clientes
 const claim=async c=>{await c.query('begin');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:'00000000-0000-0000-0000-000000000004',role:'authenticated'})]);await c.query('set local role authenticated')}
 const esperaBloqueo=async pid=>{
  for(let i=0;i<100;i++) {const r=(await control.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0];if(r?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20))}
  throw Error('No se observó el bloqueo concurrente esperado')
 }
 try {
  const dev=(await control.query('select id from public.comision_devengo where pedido_id=886020')).rows[0].id
  const liquidar=c=>c.query("select public.comision_crear_liquidacion('vendedor@test.invalid',array[$1]::bigint[],'EFECTIVO','Concurrencia') id",[dev])
  await claim(a);await claim(b)
  const lote=(await liquidar(a)).rows[0].id
  const segundo=liquidar(b).then(value=>({value}),error=>({error}))
  await esperaBloqueo(b.processID);await a.query('commit')
  const respuesta=await segundo
  assert(respuesta.error);assert.match(respuesta.error.message,/ya fue liquidada/)
  await b.query('rollback')
  assert.equal(String((await control.query('select liquidacion_id from public.comision_devengo where id=$1',[dev])).rows[0].liquidacion_id),String(lote))
  await claim(a);await a.query("select public.comision_anular_liquidacion($1,'Validar cancelación concurrente')",[lote]);await a.query('commit')
  const version=(await control.query('select hermes.version_resolucion(886020) v')).rows[0].v
  await claim(a);await claim(b)
  const resolver=c=>c.query("select hermes.resolver_incidencia_pedido(886020,'CANCELACION_RESUELTA','SALDO_FAVOR','Cancelación concurrente',$1,'concurrencia-resolucion-886020') r",[version])
  const cancelado=(await resolver(a)).rows[0].r
  const intento=liquidar(b).then(value=>({value}),error=>({error}))
  await esperaBloqueo(b.processID);await a.query('commit')
  assert((await intento).error,'Una cancelación en curso impide liquidar el devengo antiguo')
  await b.query('rollback')
  await claim(b);assert.deepEqual((await resolver(b)).rows[0].r,cancelado);await b.query('commit')
  assert.equal((await control.query('select estado from public.comision_devengo where id=$1',[dev])).rows[0].estado,'ANULADA')
  assert.equal(Number((await control.query("select count(*) n from hermes.resolucion_operacion where idempotencia_clave='concurrencia-resolucion-886020'")).rows[0].n),1)
  console.log('OK: dos conexiones no duplican liquidación; cancelación concurrente bloquea el lote antiguo; reintento conserva una resolución')
 } finally { await Promise.all(clientes.map(c=>c.end())) }
}
