import { useEffect, useState } from 'react'
import type { MiCuentaPedido, MiCuentaVendedor } from '../../application/shared/models'
import { hoyLocal } from '../../domain/common/fechas'
import { etiquetaEstadoVenta, rangoPeriodo, rpcNoDisponible, type PeriodoCuenta } from '../../domain/sales/cuentaVendedor'
import { pedidoVendedorService } from '../../infrastructure/services'

const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PERIODOS: Array<{ id: PeriodoCuenta; texto: string }> = [{ id: 'hoy', texto: 'Hoy' }, { id: 'semana', texto: 'Semana' }, { id: 'mes', texto: 'Mes' }]
const NO_DISPONIBLE = 'Todavía no está disponible'

interface Props {
  /** Pedidos de hoy que existen en este teléfono (pedidoId → abrir). Los demás quedan como tarjeta de solo lectura. */
  abribles: ReadonlySet<string>
  onAbrir: (pedidoId: string) => void
}

export function MisVentasPiso({ abribles, onAbrir }: Props) {
  const [periodo, setPeriodo] = useState<PeriodoCuenta>('hoy')
  // El resultado guarda el periodo que lo pidió: mientras no coincida con el elegido, se está cargando.
  const [resultado, setResultado] = useState<{ periodo: PeriodoCuenta; cuenta: MiCuentaVendedor | null; error: string } | null>(null)

  useEffect(() => {
    let cancelado = false
    const { desde, hasta } = rangoPeriodo(periodo, hoyLocal())
    pedidoVendedorService.misCuentaVendedor(desde, hasta)
      .then((c) => { if (!cancelado) setResultado({ periodo, cuenta: c, error: '' }) })
      .catch((e: unknown) => { if (!cancelado) setResultado({ periodo, cuenta: null, error: rpcNoDisponible(e) ? NO_DISPONIBLE : e instanceof Error ? e.message : 'No se pudo cargar tu cuenta' }) })
    return () => { cancelado = true }
  }, [periodo])
  const vigente = resultado?.periodo === periodo ? resultado : null
  const cuenta = vigente?.cuenta ?? null
  const error = vigente?.error ?? ''
  const cargando = vigente == null

  const hoy = hoyLocal()
  return <section className="piso-ventas" aria-label="Mis ventas">
    <div className="piso-periodos" role="group" aria-label="Periodo">
      {PERIODOS.map((p) => <button key={p.id} type="button" aria-pressed={periodo === p.id} className={periodo === p.id ? 'activo' : ''} onClick={() => setPeriodo(p.id)}>{p.texto}</button>)}
    </div>
    {error && <p className="piso-error" role="alert">{error}</p>}
    {cargando && !cuenta && !error && <p className="piso-vacio" role="status">Cargando…</p>}
    {cuenta && <>
      <div className="piso-cuenta">
        <span>Tu parte cobrada</span>
        <strong>Bs {bs(cuenta.parte)}</strong>
        <ul className="piso-contadores">
          <li><b>{cuenta.cobradas}</b> cobradas</li>
          <li><b>{cuenta.porCobrar}</b> por cobrar</li>
          <li><b>{cuenta.guardadas}</b> guardadas</li>
        </ul>
        <small>Cuenta solo lo que tú anotaste, al precio que cobró caja. Lo que caja agregó no suma para ti.</small>
      </div>
      {!cuenta.pedidos.length && <p className="piso-vacio">Sin ventas en este periodo</p>}
      <ul className="piso-pedidos piso-ventas-lista">
        {cuenta.pedidos.map((p) => <li key={p.pedidoId}><TarjetaVenta venta={p} abrible={p.fecha === hoy && abribles.has(p.pedidoId)} onAbrir={() => onAbrir(p.pedidoId)} /></li>)}
      </ul>
    </>}
  </section>
}

function TarjetaVenta({ venta, abrible, onAbrir }: { venta: MiCuentaPedido; abrible: boolean; onAbrir: () => void }) {
  const cuerpo = <>
    <strong>Venta {venta.numeroDia}</strong>
    <span className={`piso-estado ${venta.estado.toLowerCase()}`}>{etiquetaEstadoVenta(venta)}</span>
    <b>Bs {bs(venta.estado === 'COBRADO' && venta.parte != null ? venta.parte : venta.totalEnviado)}</b>
    {venta.estado === 'COBRADO' && (venta.agregadoCaja ?? 0) > 0 && <small>Caja agregó productos (Bs {bs(venta.agregadoCaja as number)}). No cuentan para ti.</small>}
    {venta.estado === 'COBRADO' && venta.preciosCorregidos > 0 && <small>Caja corrigió {venta.preciosCorregidos} precio{venta.preciosCorregidos === 1 ? '' : 's'}. Tu parte usa el precio de caja.</small>}
    {venta.estado === 'ANULADO' && venta.anuladoMotivo && <small>Motivo: {venta.anuladoMotivo}</small>}
  </>
  return abrible
    ? <button type="button" className="piso-venta-card" onClick={onAbrir}>{cuerpo}</button>
    : <article className="piso-venta-card">{cuerpo}</article>
}
