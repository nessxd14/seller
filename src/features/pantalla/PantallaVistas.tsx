import { useLayoutEffect, useRef, useState } from 'react'
import type { PantallaCobro, PantallaEstado, PantallaLinea } from '../../domain/pantalla/pantallaCliente'
import type { CorreccionLinea } from './pantallaVista'

const dinero = (valor: number) => valor.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FACTURA = '¿Factura? Pídala al cajero con su NIT o CI'

const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((palabra) => palabra[0]?.toUpperCase() ?? '').join('') || '?'

/** Foto del producto; sin URL o si falla la carga, mosaico con las iniciales. */
export function FotoProducto({ url, nombre, className }: { url: string | null; nombre: string; className: string }) {
  const [fallida, setFallida] = useState<string | null>(null)
  if (!url || fallida === url) return <div className={`${className} pc-foto-vacia`} aria-hidden="true"><span>{iniciales(nombre)}</span></div>
  return <div className={`${className} pc-foto`}><img src={url} alt="" loading="eager" onError={() => setFallida(url)} /></div>
}

export function Reposo({ cajaId }: { cajaId: number }) {
  return <section className="pc-reposo" aria-label="Pantalla en espera">
    <h1>Caja {cajaId}</h1>
    <p className="pc-bienvenido">¡Bienvenido!</p>
    <div className="pc-metodos"><span>Efectivo</span><i aria-hidden="true">·</i><span>QR</span></div>
    <p className="pc-factura">{FACTURA}</p>
  </section>
}

/** Cuántas filas caben en la lista: se mide la primera fila contra el alto del contenedor. */
function useFilasQueCaben(contenedor: React.RefObject<HTMLDivElement | null>) {
  const [capacidad, setCapacidad] = useState<number>(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => {
    const el = contenedor.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => {
      const fila = el.querySelector<HTMLElement>('[data-fila]')
      if (!fila) return
      const hueco = parseFloat(getComputedStyle(el).rowGap) || 0
      setCapacidad(Math.max(1, Math.floor((el.clientHeight + hueco) / (fila.offsetHeight + hueco))))
    }
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [contenedor])
  return capacidad
}

const detalleLinea = (linea: PantallaLinea) => `${linea.cantidad} × Bs ${dinero(linea.precioUnitario)} · ${linea.presentacion}`

function Fila({ linea, destacada, correccion }: { linea: PantallaLinea; destacada: boolean; correccion: CorreccionLinea | null }) {
  const cambiada = correccion?.tipo === 'cantidad' && correccion.key === linea.key
  const clase = ['pc-fila', destacada ? 'pc-fila--nueva' : '', cambiada ? 'pc-fila--cantidad' : ''].filter(Boolean).join(' ')
  return <div className={clase} data-fila>
    <FotoProducto url={linea.imagenUrl} nombre={linea.nombre} className="pc-fila-foto" />
    <div className="pc-fila-texto">
      <strong>{linea.nombre}</strong>
      <span>{cambiada && <s className="pc-qty-vieja">{correccion.cantidadAnterior}</s>}{cambiada ? ` ${linea.cantidad} × Bs ${dinero(linea.precioUnitario)} · ${linea.presentacion}` : detalleLinea(linea)}</span>
    </div>
    <b className="pc-fila-subtotal">Bs {dinero(linea.subtotal)}</b>
  </div>
}

function FilaQuitada({ linea }: { linea: PantallaLinea }) {
  return <div className="pc-fila pc-fila--quitada" data-fila>
    <FotoProducto url={linea.imagenUrl} nombre={linea.nombre} className="pc-fila-foto" />
    <div className="pc-fila-texto"><strong>{linea.nombre}</strong><span>{detalleLinea(linea)}</span></div>
    <b className="pc-fila-subtotal">Quitado</b>
  </div>
}

/** La línea destacada: la última agregada o cambiada si sigue en el carrito; si no, la última del carrito. */
export function lineaReciente(estado: PantallaEstado): PantallaLinea | null {
  return estado.lineas.find((linea) => linea.key === estado.ultimaKey) ?? estado.lineas[estado.lineas.length - 1] ?? null
}

export function Venta({ estado, correccion }: { estado: PantallaEstado; correccion: CorreccionLinea | null }) {
  const lista = useRef<HTMLDivElement>(null)
  const capacidad = useFilasQueCaben(lista)
  const reciente = lineaReciente(estado)
  const ordenadas = reciente ? [reciente, ...[...estado.lineas].reverse().filter((linea) => linea.key !== reciente.key)] : []
  const quitada = correccion?.tipo === 'quitado' ? correccion.lineaQuitada : undefined
  const hayQuitada = quitada != null && !estado.lineas.some((linea) => linea.key === quitada.key)
  const filas = ordenadas.length + (hayQuitada ? 1 : 0)
  // La línea «+ N más» siempre ocupa su sitio (oculta si no hace falta): el alto de la lista no cambia al recortarla.
  const visibles = Math.min(filas, capacidad)
  const visiblesLineas = hayQuitada ? Math.max(0, visibles - 1) : visibles
  const ocultas = ordenadas.length - visiblesLineas
  return <>
    <div className="pc-venta">
      <section className="pc-panel pc-hero" aria-label="Recién agregado">
        <h2 className="pc-panel-titulo">Recién agregado</h2>
        {reciente && <div className="pc-hero-cuerpo" key={`${reciente.key}:${reciente.cantidad}`}>
          <FotoProducto url={reciente.imagenUrl} nombre={reciente.nombre} className="pc-hero-foto" />
          <h3>{reciente.nombre}</h3>
          <p className="pc-hero-presentacion">{reciente.presentacion}</p>
          <p className="pc-hero-cuenta">{reciente.cantidad} × Bs {dinero(reciente.precioUnitario)}</p>
          <div className="pc-hero-subtotal"><span>Subtotal</span><strong>Bs {dinero(reciente.subtotal)}</strong></div>
        </div>}
      </section>
      <section className="pc-panel pc-lista" aria-label="Su compra">
        <h2 className="pc-panel-titulo">Su compra · {estado.lineas.length} {estado.lineas.length === 1 ? 'producto' : 'productos'}</h2>
        <div className="pc-filas" ref={lista}>
          {hayQuitada && <FilaQuitada linea={quitada} />}
          {ordenadas.slice(0, visiblesLineas).map((linea, indice) => <Fila key={linea.key} linea={linea} destacada={indice === 0} correccion={correccion} />)}
        </div>
        <p className="pc-mas" aria-hidden={ocultas <= 0} style={ocultas > 0 ? undefined : { visibility: 'hidden' }}>{ocultas > 0 ? `+ ${ocultas} ${ocultas === 1 ? 'producto más' : 'productos más'} arriba en la lista` : ' '}</p>
      </section>
    </div>
    <footer className="pc-totales">
      <dl>
        <div><dt>Productos</dt><dd>{estado.lineas.length}</dd></div>
        <div><dt>Unidades</dt><dd>{estado.unidades}</dd></div>
        <div><dt>Subtotal</dt><dd>Bs {dinero(estado.subtotal)}</dd></div>
        {estado.descuento > 0 && <div className="pc-descuento"><dt>Descuento</dt><dd>− Bs {dinero(estado.descuento)}</dd></div>}
      </dl>
      <div className="pc-total"><span>Total a pagar</span><strong>Bs {dinero(estado.total)}</strong></div>
    </footer>
  </>
}

function CuerpoCobro({ cobro, total }: { cobro: PantallaCobro | undefined; total: number }) {
  if (cobro?.metodo === 'efectivo') {
    return <div className="pc-cobro-efectivo">
      <div className="pc-cobro-dato"><span>Total</span><strong>Bs {dinero(total)}</strong></div>
      <div className="pc-cobro-dato"><span>Recibido</span><strong>{cobro.recibido != null ? `Bs ${dinero(cobro.recibido)}` : '—'}</strong></div>
      <div className="pc-cobro-cambio"><span>Cambio</span><strong>Bs {dinero(cobro.cambio ?? 0)}</strong></div>
    </div>
  }
  if (cobro?.metodo === 'qr') return <div className="pc-cobro-simple"><p>Escanee el QR del cajero para pagar</p><strong>Bs {dinero(total)}</strong></div>
  if (cobro?.metodo === 'transferencia') return <div className="pc-cobro-simple"><strong>Bs {dinero(total)}</strong><p>Pago por transferencia</p></div>
  if (cobro?.metodo === 'mixto') {
    const efectivo = cobro.efectivo ?? 0
    const resta = cobro.digital ?? Math.max(0, total - efectivo)
    return <div className="pc-cobro-mixto">
      <div className="pc-cobro-dato"><span>Total</span><strong>Bs {dinero(total)}</strong></div>
      <div className="pc-cobro-dato"><span>Efectivo</span><strong>Bs {dinero(efectivo)}</strong></div>
      <div className="pc-cobro-dato pc-cobro-resta"><span>Resta por QR/transferencia</span><strong>Bs {dinero(resta)}</strong></div>
    </div>
  }
  return <div className="pc-cobro-simple"><p>Total a pagar</p><strong>Bs {dinero(total)}</strong></div>
}

export function Cobro({ estado }: { estado: PantallaEstado }) {
  return <section className="pc-cobro" aria-label="Cobro"><h2>Pago</h2><CuerpoCobro cobro={estado.cobro} total={estado.total} /></section>
}

export function Gracias({ estado }: { estado: PantallaEstado }) {
  const efectivo = estado.cobro?.metodo === 'efectivo' ? estado.cobro : null
  return <section className="pc-gracias" aria-label="Gracias">
    <h1>¡Gracias por su compra!</h1>
    {estado.ticket && <p className="pc-ticket">Ticket <strong>{estado.ticket}</strong></p>}
    <p className="pc-gracias-total">Total <strong>Bs {dinero(estado.total)}</strong></p>
    {efectivo && efectivo.recibido != null && <p className="pc-gracias-efectivo">Recibido Bs {dinero(efectivo.recibido)} · Cambio Bs {dinero(efectivo.cambio ?? 0)}</p>}
    <p className="pc-factura">{FACTURA}</p>
  </section>
}
