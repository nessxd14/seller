import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Modal } from '../../../components/Modal'
import type { ResumenCambio } from '../../../domain/orders/edicionPedido'
import type { CambioPedido, PedidoDetalle, PrevisualizacionEdicion } from '../../../domain/orders/pedidoEdicion.types'
import { featureFlags } from '../../../config/featureFlags'
import { pedidoEdicionService, sensitiveOperations, simularCambioDeAlmacen } from '../../../infrastructure/services'
import { EdicionPedidoError, mapErrorEdicion } from '../../../infrastructure/supabase/PedidoEdicion.supabase'
import { Chip } from '../detalle/Chip'
import { bs, deltaBs } from '../detalle/formato'

const MENSAJE_VERSION = mapErrorEdicion('VERSION_CAMBIADA')

function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return <section className="ped-paso"><h4><span className="ped-paso-numero" aria-hidden>{numero}</span>{titulo}</h4>{children}</section>
}

/**
 * Revisión antes de guardar: pide la previsualización al servidor (que no escribe nada),
 * muestra cambios, efecto en la cuenta y en Almacén, y exige el motivo. Confirmar llama a
 * editar_pedido, que es atómico: aplica todo, recalcula total y partida, y guarda la versión.
 */
export function ConfirmarEdicionModal({ base, cambios, resumen, onClose, onRecargar, onGuardado }: {
  base: PedidoDetalle
  cambios: CambioPedido[]
  resumen: ResumenCambio[]
  onClose: () => void
  /** Vuelve a pedir el pedido y reaplica la edición; devuelve lo que ya no aplicó. */
  onRecargar: () => Promise<Array<{ texto: string }>>
  onGuardado: (resultado: { version: number; total: number }) => void
}) {
  const { pedido } = base
  const [previa, setPrevia] = useState<PrevisualizacionEdicion | null>(null)
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [versionCambiada, setVersionCambiada] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)
  const [descartados, setDescartados] = useState<Array<{ texto: string }>>([])
  const [recargando, setRecargando] = useState(false)
  const operacionId = useRef(crypto.randomUUID())
  const huella = useMemo(() => JSON.stringify([pedido.id, pedido.version, cambios, motivo.trim()]), [pedido.id, pedido.version, cambios, motivo])

  useEffect(() => {
    let cancelado = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se vuelve a pedir la previsualización cuando cambia la versión base o los cambios
    setPrevia(null)
    setErrorPrevia(null)
    pedidoEdicionService.previsualizar(pedido.id, pedido.version, cambios)
      .then((resultado) => {
        if (cancelado) return
        setPrevia(resultado)
        if (resultado.errores.some((error) => error.codigo === 'VERSION_CAMBIADA')) setVersionCambiada(true)
      })
      .catch((error: unknown) => { if (!cancelado) setErrorPrevia(error instanceof Error ? error.message : 'No se pudo calcular la previsualización.') })
    return () => { cancelado = true }
  }, [pedido.id, pedido.version, cambios])

  const erroresReales = previa?.errores.filter((error) => error.codigo !== 'VERSION_CAMBIADA') ?? []
  const puedeConfirmar = !!previa && erroresReales.length === 0 && !versionCambiada && motivo.trim().length > 0 && !guardando

  const confirmar = async () => {
    if (!puedeConfirmar) return
    setGuardando(true)
    setErrorGuardar(null)
    try {
      const resultado = await sensitiveOperations.ejecutarIdempotente('edit_order', operacionId.current, huella, () => pedidoEdicionService.editar(pedido.id, pedido.version, cambios, motivo.trim()))
      onGuardado({ version: resultado.version, total: resultado.total_nuevo })
    } catch (error) {
      if (error instanceof EdicionPedidoError && error.codigo === 'VERSION_CAMBIADA') setVersionCambiada(true)
      else setErrorGuardar(error instanceof Error ? error.message : 'No se pudo guardar la edición.')
    } finally { setGuardando(false) }
  }

  const recargar = async () => {
    setRecargando(true)
    try {
      setDescartados(await onRecargar())
      setVersionCambiada(false)
      setErrorGuardar(null)
    } catch (error) {
      setErrorGuardar(error instanceof Error ? error.message : 'No se pudo recargar el pedido.')
    } finally { setRecargando(false) }
  }

  return <Modal title="Revisar cambios" subtitle={`${pedido.numero} · versión ${pedido.version}`} onClose={onClose} wide className="commercial-modal ped-confirmar">
    <div className="modal-body">
      {errorPrevia && <p className="ped-aviso-caja ped-aviso-caja-rojo" role="alert"><TriangleAlert aria-hidden />{errorPrevia}</p>}
      {!previa && !errorPrevia && <p className="ped-nota" aria-busy="true">Calculando efecto de los cambios…</p>}
      {versionCambiada && <div className="ped-aviso-caja ped-aviso-caja-ambar" role="alert">
        <TriangleAlert aria-hidden />
        <div><p>{MENSAJE_VERSION}</p><button type="button" className="ped-btn ped-btn-suave" disabled={recargando} onClick={() => void recargar()}><RefreshCw aria-hidden />Recargar</button></div>
      </div>}
      {descartados.length > 0 && <div className="ped-aviso-caja ped-aviso-caja-ambar" role="status">
        <TriangleAlert aria-hidden />
        <div><p>Estos cambios ya no aplican con la versión nueva y se quitaron de tu edición:</p><ul>{descartados.map((d, i) => <li key={i}>{d.texto}</li>)}</ul></div>
      </div>}
      {previa && <>
        <Paso numero={1} titulo="Cambios en el pedido">
          <ul className="ped-diff">
            {resumen.map((r) => <li key={r.indice}><span>{r.texto}</span>{r.delta !== 0 && <b className={r.delta > 0 ? 'ped-mas' : 'ped-menos'}>{deltaBs(r.delta)}</b>}</li>)}
          </ul>
          <p className="ped-diff-total"><span>Total del pedido {bs(previa.total_anterior)} → <strong>{bs(previa.total_nuevo)}</strong></span><Chip tone={previa.delta < 0 ? 'red' : 'orange'}>{deltaBs(previa.delta)}</Chip></p>
        </Paso>
        {previa.cuenta.tiene_cuenta !== false && <Paso numero={2} titulo="Cuenta del cliente (Hermes)">
          <dl className="ped-cuenta-diff">
            <div><dt>Partida</dt><dd>{bs(previa.cuenta.partida_antes)} → <strong>{bs(previa.cuenta.partida_despues)}</strong></dd></div>
            <div><dt>Pagado</dt><dd>{bs(previa.cuenta.pagado)}</dd></div>
            <div><dt>Saldo</dt><dd>{bs(previa.cuenta.saldo_antes)} → <strong>{bs(previa.cuenta.saldo_despues)}</strong></dd></div>
          </dl>
          {previa.cuenta.saldo_a_favor > 0 && <p className="ped-nota ped-ambar">Queda saldo a favor del cliente: {bs(previa.cuenta.saldo_a_favor)}</p>}
        </Paso>}
        <Paso numero={3} titulo="Qué le llega a almacén">
          {previa.almacen.length === 0 ? <p className="ped-nota">Nada: estos cambios no mueven el surtido.</p> : <ul className="ped-almacen">{previa.almacen.map((a, i) => <li key={i}><Chip tone={a.accion === 'LINEA_NUEVA' ? 'blue' : a.accion === 'LINEA_CANCELADA' ? 'red' : 'amber'}>{{ LINEA_NUEVA: 'Línea nueva', LINEA_CANCELADA: 'Línea cancelada', LINEA_REDUCIDA: 'Línea reducida' }[a.accion]}</Chip><span>{a.texto}</span></li>)}</ul>}
        </Paso>
        {previa.advertencias.map((a, i) => <p key={i} className="ped-aviso-caja ped-aviso-caja-ambar" role="status"><TriangleAlert aria-hidden />{a.texto}</p>)}
        {erroresReales.map((e, i) => <p key={i} className="ped-aviso-caja ped-aviso-caja-rojo" role="alert"><TriangleAlert aria-hidden />{e.texto}{(e.codigo === 'REDUCCION_BAJO_PAGADO' || e.codigo === 'PARTIDA_DESFASADA') && ' Tus cambios se conservan; se resuelve en Hermes.'}</p>)}
      </>}
      <label className="ped-motivo"><span className="ped-campo-etiqueta">Motivo del cambio</span>
        <textarea rows={3} required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente aceptó el sustituto a Bs 2,00 y pidió 5 Fixocola más" />
      </label>
      <p className="ped-aviso-caja ped-aviso-caja-ambar ped-aviso-fino"><TriangleAlert aria-hidden />Si almacén toca el pedido mientras confirmas, no se guarda nada y te pediremos recargar para no pisar su trabajo.</p>
      {errorGuardar && <p className="ped-aviso-caja ped-aviso-caja-rojo" role="alert"><TriangleAlert aria-hidden />{errorGuardar}</p>}
    </div>
    <footer className="modal-actions ped-pie-modal">
      {!featureFlags.supabase && <button type="button" className="ped-btn ped-btn-enlace" onClick={() => simularCambioDeAlmacen(pedido.id)}>Simular cambio de almacén (solo demo)</button>}
      <button type="button" className="ped-btn ped-btn-suave" onClick={onClose}>Volver a la edición</button>
      <button type="button" className="ped-btn ped-btn-primario" disabled={!puedeConfirmar} onClick={() => void confirmar()}>{guardando ? 'Guardando…' : 'Confirmar cambios'}</button>
    </footer>
  </Modal>
}
