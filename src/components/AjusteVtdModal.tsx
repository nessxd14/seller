import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ventaDirectaService } from '../infrastructure/services'
import type { CajaAlmacenVtd } from '../application/shared/cajaAlmacen'

export type DestinoDevolucion = 'EFECTIVO' | 'QR' | 'TRANSFERENCIA' | 'SALDO_FAVOR'
export interface AjusteVtdPayload {
  venta_id: number
  version: number
  motivo: string
  lineas: { linea_id: number; cantidad_presentacion: number }[]
  devolucion?: { destino: DestinoDevolucion; referencia?: string; realizada: true }
}

const bs = (cents: number) => `Bs ${(cents / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const destinos: [DestinoDevolucion, string][] = [['EFECTIVO', 'Efectivo'], ['QR', 'QR'], ['TRANSFERENCIA', 'Transferencia'], ['SALDO_FAVOR', 'Saldo a favor']]

export function AjusteVtdModal({ vtd, paid, busy, error, onCancel, onConfirm }: { vtd: CajaAlmacenVtd; paid: boolean; busy: boolean; error?: string; onCancel: () => void; onConfirm: (payload: AjusteVtdPayload) => void | Promise<void> }) {
  const lineas = vtd.lineas ?? []
  const disponible = useMemo(() => new Map((vtd.faltante ?? []).map(f => [f.linea_id, f.cantidad_presentacion_disponible])), [vtd.faltante])
  const [cantidades, setCantidades] = useState<Record<number, string>>(() => Object.fromEntries(lineas.map(l => [l.linea_id, String(disponible.get(l.linea_id) ?? l.cantidad_presentacion)])))
  const [motivo, setMotivo] = useState(() => vtd.faltante ? 'Almacén reportó faltante' : '')
  const [destino, setDestino] = useState<DestinoDevolucion>('EFECTIVO')
  const [referencia, setReferencia] = useState('')
  const [refunded, setRefunded] = useState(false)
  // Precio y descuento vienen de la venta: el reparto del descuento no se deduce de la VTD.
  const [venta, setVenta] = useState<{ precios: Map<number, number>; descuentoCents: number } | null>(null)
  const [cargaError, setCargaError] = useState('')
  useEffect(() => {
    let alive = true
    ventaDirectaService.getById(String(vtd.venta_id)).then(v => {
      if (!alive) return
      if (!v) { setCargaError('No se encontró la venta para calcular el ajuste.'); return }
      setVenta({ precios: new Map(v.lines.map(l => [Number(l.id), l.precioUnitarioCents])), descuentoCents: v.discountCents })
    }, e => { if (alive) setCargaError(e instanceof Error ? e.message : 'No se pudo cargar la venta.') })
    return () => { alive = false }
  }, [vtd.venta_id])

  const parsed = lineas.map(l => ({ l, nueva: Number(cantidades[l.linea_id]) }))
  const lineasValidas = parsed.every(({ l, nueva }) => Number.isFinite(nueva) && nueva >= 0 && nueva <= l.cantidad_presentacion)
  const cambios = parsed.filter(({ l, nueva }) => nueva < l.cantidad_presentacion)
  const unidades = parsed.reduce((sum, { nueva }) => sum + (Number.isFinite(nueva) ? nueva : 0), 0)
  const totalActual = Math.round(Number(vtd.total) * 100)
  const subtotalNuevo = venta ? parsed.reduce((sum, { l, nueva }) => sum + Math.round((venta.precios.get(l.linea_id) ?? 0) * nueva), 0) : null
  const totalNuevo = venta && subtotalNuevo !== null ? subtotalNuevo - venta.descuentoCents : null
  const devolver = paid && totalNuevo !== null ? Math.max(totalActual - totalNuevo, 0) : 0
  const cubreDescuento = venta && subtotalNuevo !== null ? subtotalNuevo >= venta.descuentoCents : false
  const noEfectivo = destino === 'QR' || destino === 'TRANSFERENCIA'
  const devolucionOk = devolver === 0 || (destino === 'SALDO_FAVOR' ? true : refunded && (!noEfectivo || referencia.trim().length >= 3))
  const valido = lineasValidas && cambios.length > 0 && unidades > 0 && motivo.trim().length >= 5 && !!venta && cubreDescuento && devolucionOk

  const confirmar = () => {
    const payload: AjusteVtdPayload = {
      venta_id: vtd.venta_id, version: vtd.version, motivo: motivo.trim(),
      lineas: cambios.map(({ l, nueva }) => ({ linea_id: l.linea_id, cantidad_presentacion: nueva })),
    }
    if (devolver > 0) payload.devolucion = { destino, ...(referencia.trim() ? { referencia: referencia.trim() } : {}), realizada: true }
    return onConfirm(payload)
  }

  return <Modal title="Ajustar VTD por faltante" subtitle={vtd.numero} onClose={() => { if (!busy) onCancel() }} escapeToClose={!busy}>
    <div className="modal-body">
      <p>Solo se puede reducir. Si no queda ninguna unidad, usa Rechazar.</p>
      {vtd.faltante && <p className="caja-almacen-faltante">Almacén reportó la cantidad disponible; ya está cargada abajo.</p>}
      {lineas.map(l => <label key={l.linea_id}>{l.nombre}{l.presentacion ? ` · ${l.presentacion}` : ''} (pedido: {l.cantidad_presentacion})
        <input type="number" inputMode="decimal" min={0} max={l.cantidad_presentacion} step="any" aria-label={`Cantidad de ${l.nombre}`} value={cantidades[l.linea_id] ?? ''} disabled={busy}
          onChange={e => setCantidades(c => ({ ...c, [l.linea_id]: e.target.value }))} /></label>)}
      <label>Motivo<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={1000} disabled={busy} /></label>
      {venta ? <p aria-live="polite">Nuevo total: <b>{totalNuevo !== null ? bs(totalNuevo) : '—'}</b>{paid && <> · A devolver: <b>{bs(devolver)}</b></>}</p> : <p>{cargaError || 'Calculando el nuevo total…'}</p>}
      {venta && !cubreDescuento && <p role="alert">El nuevo subtotal no cubre el descuento de la venta.</p>}
      {paid && devolver > 0 && <>
        <p>El pago original se conserva. La devolución puede ser por un medio distinto al del cobro.</p>
        <label>Devolver por<select value={destino} onChange={e => { setDestino(e.target.value as DestinoDevolucion); setRefunded(false) }} disabled={busy}>
          {destinos.filter(([value]) => value !== 'SALDO_FAVOR' || vtd.cliente_id).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {destino !== 'SALDO_FAVOR' && <>
          <label><input type="checkbox" checked={refunded} onChange={e => setRefunded(e.target.checked)} disabled={busy} />Confirmo que devolví el importe</label>
          <label>Referencia de devolución{noEfectivo ? '' : ' (opcional)'}<input value={referencia} onChange={e => setReferencia(e.target.value)} disabled={busy} maxLength={200} /></label></>}
        {destino === 'SALDO_FAVOR' && <p>Se acredita {bs(devolver)} a la cuenta del cliente; el dinero queda en el cajón.</p>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
    <footer className="modal-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>Volver</button>
      <button className="primary-button" disabled={busy || !valido} onClick={() => void confirmar()}>Confirmar ajuste</button></footer>
  </Modal>
}
