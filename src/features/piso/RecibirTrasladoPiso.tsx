import { ArrowLeft, ScanLine } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { TransferRecord } from '../../application/shared/models'
import { AmbiguousScanPicker } from '../../components/AmbiguousScanPicker'
import { cuandoTexto, despachadaEnPresentacion, factorLinea, nombrePresentacion, nombreSucursalPiso, numeroCorto, recepcionDesdeConteo } from '../../domain/sales/trasladoPiso'
import { mensajeErrorTraslado, recibibleTraslado } from '../../domain/sales/transfers'
import { productRepository, transferService } from '../../infrastructure/services'
import { EscanerContinuo, vibrarDesconocido } from './EscanerContinuo'
import { StepperPiso } from './StepperPiso'
import { FotoProductoPiso } from './FotoProductoPiso'

const fmt = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 })

interface Props {
  traslado: TransferRecord
  onVolver: () => void
  onRecibido: () => void
  aviso: (mensaje: string) => void
}

export function RecibirTrasladoPiso({ traslado, onVolver, onRecibido, aviso }: Props) {
  const lineas = traslado.lines.filter(recibibleTraslado)
  const [llegaron, setLlegaron] = useState<Record<string, number>>(() => Object.fromEntries(lineas.map((l) => [l.id, despachadaEnPresentacion(l)])))
  const [contando, setContando] = useState(false)
  const [linterna, setLinterna] = useState(false)
  const [conte, setConte] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [ambiguos, setAmbiguos] = useState<number[] | null>(null)
  const [ahora] = useState(() => Date.now())

  const llegaronDe = (id: string, porDefecto: number) => llegaron[id] ?? porDefecto
  const faltaDe = (l: (typeof lineas)[number]) => Math.max(0, despachadaEnPresentacion(l) - llegaronDe(l.id, despachadaEnPresentacion(l)))
  const lineasConFalta = lineas.filter((l) => faltaDe(l) > 0)

  const sumarUno = useCallback((productId: string) => {
    const linea = lineas.find((l) => l.productId === productId)
    if (!linea) { vibrarDesconocido(); aviso('Ese producto no está en este traslado'); return }
    setLlegaron((prev) => ({ ...prev, [linea.id]: Math.min(despachadaEnPresentacion(linea), (prev[linea.id] ?? 0) + 1) }))
    aviso(`+1 ${linea.name}`)
  }, [lineas, aviso])

  // Contar escaneando parte de cero: cada lectura suma una presentación.
  const empezarConteo = () => { setLlegaron(Object.fromEntries(lineas.map((l) => [l.id, 0]))); setContando(true) }

  const alEscanear = async (codigo: string) => {
    try {
      const r = await productRepository.resolveScannedCode(codigo)
      if (r.kind === 'found') sumarUno(String(r.product.id))
      else if (r.kind === 'ambiguous') { vibrarDesconocido(); setAmbiguos(r.productIds) }
      else { vibrarDesconocido(); aviso('Código no reconocido') }
    } catch (e) { aviso(mensajeErrorTraslado(e, 'No se pudo leer el código')) }
  }

  const confirmar = async () => {
    if (!conte || enviando) return
    setEnviando(true); setError('')
    try {
      await transferService.receive(traslado.id, recepcionDesdeConteo(traslado.lines, llegaron))
      aviso('Recepción registrada')
      onRecibido()
    } catch (e) { setError(mensajeErrorTraslado(e, 'No se pudo registrar la recepción')) } finally { setEnviando(false) }
  }

  const hora = cuandoTexto(traslado.despachadoEn, ahora)
  return <>
    <header className="piso-header">
      <button type="button" className="piso-icono" aria-label="Volver a Traslados" onClick={onVolver}><ArrowLeft /></button>
      <div><h1>Recibir traslado {numeroCorto(traslado.numero)}</h1><small>De {nombreSucursalPiso(traslado.sucursalOrigenId)} · salió {hora} · {lineas.length} {lineas.length === 1 ? 'producto' : 'productos'}</small></div>
    </header>
    <section className="traslado-cuerpo piso-marco-traslado" aria-label="Conteo">
      {contando
        ? <div className="piso-captura traslado-escaner"><EscanerContinuo onCodigo={(c) => void alEscanear(c)} plegado={false} linterna={linterna} onLinterna={setLinterna} onCerrar={() => { setContando(false); setLinterna(false) }} /></div>
        : <button type="button" className="piso-secundario traslado-escanear" onClick={empezarConteo}><ScanLine /> Contar escaneando</button>}
      {lineas.map((l) => {
        const salieron = despachadaEnPresentacion(l)
        const actual = llegaronDe(l.id, salieron)
        const falta = Math.max(0, salieron - actual)
        const unidad = nombrePresentacion(l)
        return <article key={l.id} className={`traslado-linea${falta > 0 ? ' faltante' : ''}`}>
          <div className="piso-linea-nombre piso-con-foto"><FotoProductoPiso nombre={l.name} sku={l.sku} productoId={l.productId} /><div><strong>{l.name}</strong><small>Salieron {fmt(salieron)} {unidad}{factorLinea(l) !== 1 ? ` · ${fmt(salieron * factorLinea(l))} u` : ''}</small></div></div>
          <div className="traslado-llegaron"><span>Llegaron</span><StepperPiso etiqueta={`Llegaron ${l.name}`} valor={actual} min={0} max={salieron} onCambio={(n) => setLlegaron((prev) => ({ ...prev, [l.id]: n }))} /><small>{unidad}</small></div>
          {falta > 0 && <p className="traslado-falta">Faltan {fmt(falta)}: quedan como faltante en Tienda y almacén lo ve.</p>}
        </article>
      })}
      {error && <p className="piso-error" role="alert">{error}</p>}
    </section>
    <footer className="piso-pie traslado-pie">
      <label className="traslado-check"><input type="checkbox" checked={conte} onChange={(e) => setConte(e.target.checked)} /> Conté todo con mis manos</label>
      <button type="button" className="piso-enviar" disabled={!conte || enviando || !lineas.length} onClick={() => void confirmar()}>{enviando ? 'Registrando…' : `Confirmar recepción${lineasConFalta.length ? ` · ${lineasConFalta.length} faltante${lineasConFalta.length === 1 ? '' : 's'}` : ''}`}</button>
    </footer>
    {ambiguos && <AmbiguousScanPicker productIds={ambiguos} onPick={(p) => { setAmbiguos(null); sumarUno(String(p.id)) }} onClose={() => setAmbiguos(null)} />}
  </>
}
