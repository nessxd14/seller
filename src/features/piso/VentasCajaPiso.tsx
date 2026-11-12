import { useCallback, useEffect, useState } from 'react'
import type { VentaPorReclamar } from '../../application/ports/pisoRepository'
import { pisoRepository } from '../../infrastructure/services'

const REFRESCO_MS = 20_000
const bs = (v: number) => v.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false })
const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const mensaje = (e: unknown, porDefecto: string) => (e instanceof Error && e.message ? e.message : porDefecto)

interface Propia { venta: VentaPorReclamar; deshacerHasta: number }

/** Ventas de caja sin vendedor de los últimos 30 minutos: un toque en «Es mía» las reclama. */
export function VentasCajaPiso({ onVolver }: { onVolver: () => void }) {
  const [ventas, setVentas] = useState<VentaPorReclamar[] | null>(null)
  const [propias, setPropias] = useState<Propia[]>([])
  const [reclamando, setReclamando] = useState<ReadonlySet<number>>(new Set())
  const [errores, setErrores] = useState<Record<number, string>>({})
  const [errorLista, setErrorLista] = useState('')
  // Error al reclamar: va arriba, porque al refrescar la lista la venta ya puede no estar.
  const [errorReclamo, setErrorReclamo] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(() => {
    pisoRepository.ventasPorReclamar()
      .then((lista) => { setVentas(lista); setErrorLista('') })
      .catch((e: unknown) => setErrorLista(mensaje(e, 'No se pudieron cargar las ventas de caja.')))
  }, [])

  useEffect(() => {
    const consultar = () => { if (document.visibilityState === 'visible') cargar() }
    consultar()
    const id = window.setInterval(consultar, REFRESCO_MS)
    window.addEventListener('focus', consultar)
    document.addEventListener('visibilitychange', consultar)
    return () => { window.clearInterval(id); window.removeEventListener('focus', consultar); document.removeEventListener('visibilitychange', consultar) }
  }, [cargar])

  // Reloj de la cuenta regresiva: solo corre mientras haya un reclamo que todavía se pueda deshacer.
  const hayDeshacer = propias.some((p) => p.deshacerHasta > ahora)
  useEffect(() => {
    if (!hayDeshacer) return
    const id = window.setInterval(() => setAhora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hayDeshacer])

  const marcar = (ventaId: number, activo: boolean) => setReclamando((prev) => {
    const siguiente = new Set(prev)
    if (activo) siguiente.add(ventaId); else siguiente.delete(ventaId)
    return siguiente
  })
  const ponerError = (ventaId: number, texto: string | null) => setErrores((prev) => {
    const resto = Object.fromEntries(Object.entries(prev).filter(([id]) => Number(id) !== ventaId))
    return texto == null ? resto : { ...resto, [ventaId]: texto }
  })

  const reclamar = async (venta: VentaPorReclamar) => {
    if (reclamando.has(venta.ventaId)) return
    marcar(venta.ventaId, true)
    setErrorReclamo('')
    try {
      const r = await pisoRepository.reclamar(venta.ventaId)
      setAhora(Date.now())
      setPropias((prev) => [{ venta, deshacerHasta: Date.parse(r.deshacerHasta) }, ...prev.filter((p) => p.venta.ventaId !== venta.ventaId)])
      setVentas((prev) => prev?.filter((v) => v.ventaId !== venta.ventaId) ?? prev)
    } catch (e) {
      setErrorReclamo(mensaje(e, 'No se pudo reclamar la venta.'))
      cargar()
    } finally { marcar(venta.ventaId, false) }
  }

  const deshacer = async (propia: Propia) => {
    const { ventaId } = propia.venta
    if (reclamando.has(ventaId)) return
    marcar(ventaId, true)
    ponerError(ventaId, null)
    try {
      await pisoRepository.deshacerReclamo(ventaId)
      setPropias((prev) => prev.filter((p) => p.venta.ventaId !== ventaId))
      cargar()
    } catch (e) {
      ponerError(ventaId, mensaje(e, 'No se pudo deshacer.'))
    } finally { marcar(ventaId, false) }
  }

  const idsPropias = new Set(propias.map((p) => p.venta.ventaId))
  const libres = (ventas ?? []).filter((v) => !idsPropias.has(v.ventaId))
  const vacio = ventas != null && !libres.length && !propias.length

  return <section className="piso-caja" aria-label="Ventas de caja">
    <button type="button" className="piso-secundario piso-volver" onClick={onVolver}>Volver al inicio</button>
    <p className="piso-nota-rol">Toca <strong>Es mía</strong> solo en las ventas que tú atendiste. Si hay un error, caja lo corrige.</p>
    {errorReclamo && <p className="piso-error" role="alert">{errorReclamo}</p>}
    {errorLista && <p className="piso-error" role="alert">{errorLista}</p>}
    {ventas == null && !errorLista && <p className="piso-vacio" role="status">Cargando…</p>}
    {vacio && <p className="piso-vacio">No hay ventas de caja sin vendedor en los últimos 30 minutos.</p>}
    <ul className="piso-pedidos piso-caja-lista">
      {propias.map((p) => {
        const restante = p.deshacerHasta - ahora
        return <li key={p.venta.ventaId}>
          <article className="piso-venta-card tuya">
            <VentaCuerpo venta={p.venta} />
            <span className="piso-estado cobrado">Tuya</span>
            {restante > 0 && <button type="button" className="piso-secundario" disabled={reclamando.has(p.venta.ventaId)} onClick={() => void deshacer(p)}>Me equivoqué · deshacer ({mmss(restante)})</button>}
            {errores[p.venta.ventaId] && <p className="piso-error" role="alert">{errores[p.venta.ventaId]}</p>}
          </article>
        </li>
      })}
      {libres.map((v) => <li key={v.ventaId}>
        <article className="piso-venta-card">
          <VentaCuerpo venta={v} />
          <button type="button" className="piso-enviar" disabled={reclamando.has(v.ventaId)} onClick={() => void reclamar(v)}>Es mía</button>
        </article>
      </li>)}
    </ul>
    <p className="piso-nota-rol">Si dos personas tocan la misma venta, queda con quien llegó primero. Tienes 5 minutos para deshacer un error.</p>
  </section>
}

function VentaCuerpo({ venta }: { venta: VentaPorReclamar }) {
  const producto = venta.producto ?? 'Venta'
  return <>
    <strong>Bs {bs(venta.total)} · {producto}{venta.nProductos > 1 ? ` y ${venta.nProductos - 1} más` : ''}</strong>
    <small>{hora(venta.completadoEn)} · {venta.numero} · {venta.nProductos} {venta.nProductos === 1 ? 'producto' : 'productos'}</small>
  </>
}
