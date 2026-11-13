import { useEffect, useState } from 'react'
import type { ArqueoProgramado, Denominaciones } from '../../../application/shared/models'
import { DENOMINACIONES } from '../../../components/DenominationCount'
import { turnoService } from '../../../infrastructure/services'
import { estadoArqueoUi, horaCorta, resultadoArqueo } from './arqueoUi'

const bs = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function Resultado({ diferenciaBs }: { diferenciaBs?: number | null }) {
  if (diferenciaBs == null) return <>—</>
  const r = resultadoArqueo(diferenciaBs, bs)
  return <span className={`arqueo-resultado es-${r.tono}`}>{r.texto}</span>
}

/** Lee los arqueos de un turno. Un fallo se traga: es informativo y nunca rompe la pantalla. */
export function useArqueosDelTurno(sesionId: string): { arqueos: ArqueoProgramado[]; ahoraMs: number } | null {
  const [data, setData] = useState<{ arqueos: ArqueoProgramado[]; ahoraMs: number } | null>(null)
  useEffect(() => {
    let cancelado = false
    Promise.resolve()
      .then(() => turnoService.arqueos(sesionId))
      .then((r) => { if (!cancelado) setData({ arqueos: r.arqueos, ahoraMs: Date.parse(r.ahoraServidor) || Date.now() }) })
      .catch(() => { if (!cancelado) setData(null) })
    return () => { cancelado = true }
  }, [sesionId])
  return data
}

/**
 * Fila del cajero: `1 · 10:42 ✓`, `2 · 12:05 pendiente`, `3 · 13:20`. Solo horas y estado,
 * nunca dinero. No bloquea nada: si falta un arqueo el cierre sigue igual.
 */
export function ArqueosDelTurno({ sesionId }: { sesionId: string }) {
  const data = useArqueosDelTurno(sesionId)
  if (!data || data.arqueos.length === 0) return null
  return <div className="arqueos-fila" aria-label="Arqueos del turno">
    <strong>Arqueos del turno</strong>
    {data.arqueos.map((a) => {
      const ui = estadoArqueoUi(a, data.ahoraMs)
      const marca = a.estado === 'CUMPLIDO' ? '✓' : a.estado === 'CUMPLIDO_TARDE' ? '✓ tarde' : a.estado === 'VENCIDO' ? 'no realizado' : a.estado === 'PROGRAMADO' && ui.tono === 'pendiente' ? 'pendiente' : ''
      return <span key={a.numero} className={`es-${ui.tono}`}>{a.numero} · {horaCorta(a.programadoEn)}{marca && ` ${marca}`}</span>
    })}
  </div>
}

const denominacionesTexto = (d?: Denominaciones) => d ? DENOMINACIONES.filter((x) => d[String(x)]).map((x) => `${d[String(x)]} × Bs ${x}`).join(' · ') : ''

/**
 * Arqueos con dinero (gerente/admin): una fila por arqueo en columnas alineadas; bajo 768 px
 * cada fila se apila como tarjeta. El resultado va en palabras, no solo en color.
 */
export function ArqueosGerente({ arqueos, ahoraMs }: { arqueos: ArqueoProgramado[]; ahoraMs: number }) {
  if (arqueos.length === 0) return null
  return <section className="arqueos-gerente" aria-label="Arqueos del turno">
    <strong>Arqueos del turno</strong>
    <div className="arqueo-gerente-cabecera" aria-hidden="true"><span>Arqueo</span><span>Programado / Respondido</span><span>Estado</span><span>Contado</span><span>Esperado</span><span>Resultado</span></div>
    {arqueos.map((a) => {
      const ui = estadoArqueoUi(a, ahoraMs)
      const billetes = denominacionesTexto(a.denominaciones)
      return <details key={a.numero} className="arqueo-gerente-linea">
        <summary>
          <b data-etiqueta="Arqueo">Arqueo {a.numero}</b>
          <span data-etiqueta="Programado / Respondido">{horaCorta(a.programadoEn)}{a.respondidoEn ? ` / ${horaCorta(a.respondidoEn)}` : ''}</span>
          <span data-etiqueta="Estado"><span className={`arqueo-estado es-${ui.tono}`}>{ui.texto}</span></span>
          <span className="num" data-etiqueta="Contado">{a.contadoBs != null ? `Bs ${bs(a.contadoBs)}` : '—'}</span>
          <span className="num" data-etiqueta="Esperado">{a.esperadoBs != null ? `Bs ${bs(a.esperadoBs)}` : '—'}</span>
          <span className="resultado" data-etiqueta="Resultado"><Resultado diferenciaBs={a.diferenciaBs} /></span>
        </summary>
        <div className="detalle">{billetes ? `Desglose: ${billetes}` : 'Sin desglose de billetes.'}</div>
      </details>
    })}
  </section>
}

/** "Mi turno": el cajero sigue ciego (solo horas y estado); gerente/admin ve el resultado con dinero. */
export function ArqueosMiTurno({ sesionId, esGerente }: { sesionId: string; esGerente: boolean }) {
  if (!esGerente) return <ArqueosDelTurno sesionId={sesionId} />
  return <ArqueosGerenteDelTurno sesionId={sesionId} />
}

function ArqueosGerenteDelTurno({ sesionId }: { sesionId: string }) {
  const data = useArqueosDelTurno(sesionId)
  if (!data) return null
  return <ArqueosGerente arqueos={data.arqueos} ahoraMs={data.ahoraMs} />
}

export interface EtapaCierre { etiqueta: string; declaradoBs: number | null; diferenciaBs: number | null }

/** Arma apertura → 1 → 2 → 3 → cierre con lo declarado en cada etapa y su diferencia. */
export function etapasDeTurno(input: { aperturaBs: number; diferenciaRelevoBs?: number | null; arqueos: ArqueoProgramado[]; cierreContadoBs: number | null; cierreEsperadoBs: number | null }): EtapaCierre[] {
  const cierreDif = input.cierreContadoBs != null && input.cierreEsperadoBs != null ? Math.round((input.cierreContadoBs - input.cierreEsperadoBs) * 100) / 100 : null
  return [
    { etiqueta: 'Apertura', declaradoBs: input.aperturaBs, diferenciaBs: input.diferenciaRelevoBs ?? null },
    ...input.arqueos.map((a) => ({ etiqueta: `Arqueo ${a.numero}`, declaradoBs: a.contadoBs ?? null, diferenciaBs: a.diferenciaBs ?? null })),
    { etiqueta: 'Cierre', declaradoBs: input.cierreContadoBs, diferenciaBs: cierreDif },
  ]
}

/** Desglose en la tarjeta de cierre. `arqueos === null` (falló la lectura) deja "—" en los arqueos. */
export function DesgloseCierre({ aperturaBs, diferenciaRelevoBs, arqueos, cierreContadoBs, cierreEsperadoBs }: { aperturaBs: number; diferenciaRelevoBs?: number | null; arqueos: ArqueoProgramado[] | null | undefined; cierreContadoBs: number | null | undefined; cierreEsperadoBs: number | null | undefined }) {
  const etapas = etapasDeTurno({ aperturaBs, diferenciaRelevoBs, arqueos: arqueos ?? [], cierreContadoBs: cierreContadoBs ?? null, cierreEsperadoBs: cierreEsperadoBs ?? null })
  return <div className="arqueo-desglose" aria-label="Desglose del turno: apertura, arqueos y cierre">
    {etapas.map((e) => <div key={e.etiqueta}>
      <span>{e.etiqueta}</span>
      <b>{e.declaradoBs != null ? `Bs ${bs(e.declaradoBs)}` : '—'}</b>
      <span><Resultado diferenciaBs={e.diferenciaBs} /></span>
    </div>)}
    {arqueos == null && <small>Los arqueos del turno no se pudieron leer.</small>}
  </div>
}
