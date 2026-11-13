import { useEffect, useState } from 'react'
import type { ArqueoProgramado, Denominaciones } from '../../../application/shared/models'
import { DENOMINACIONES } from '../../../components/DenominationCount'
import { turnoService } from '../../../infrastructure/services'
import { estadoArqueoUi, horaCorta, semaforoDiferencia } from './arqueoUi'

const bs = (n: number) => n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const conSigno = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''} Bs ${bs(Math.abs(n))}`

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

/** Turno en vivo del gerente: una línea por arqueo con tiempos, dinero, semáforo y desglose de billetes. */
export function ArqueosGerente({ arqueos, ahoraMs }: { arqueos: ArqueoProgramado[]; ahoraMs: number }) {
  if (arqueos.length === 0) return null
  return <section className="arqueos-gerente" aria-label="Arqueos del turno">
    <strong>Arqueos del turno</strong>
    {arqueos.map((a) => {
      const ui = estadoArqueoUi(a, ahoraMs)
      const luz = a.diferenciaBs != null ? semaforoDiferencia(a.diferenciaBs) : undefined
      const billetes = denominacionesTexto(a.denominaciones)
      return <details key={a.numero} className="arqueo-gerente-linea">
        <summary>
          <b>Arqueo {a.numero}</b>
          <span>Programado {horaCorta(a.programadoEn)}{a.respondidoEn ? ` · respondido ${horaCorta(a.respondidoEn)}` : ''}</span>
          <span className={`arqueo-estado es-${ui.tono}`}>{ui.texto}</span>
          <span className="num">Contado {a.contadoBs != null ? `Bs ${bs(a.contadoBs)}` : '—'}</span>
          <span className="num">Esperado {a.esperadoBs != null ? `Bs ${bs(a.esperadoBs)}` : '—'}</span>
          <span className="num">{a.diferenciaBs != null ? <><i className={`arqueo-luz ${luz}`} role="img" aria-label={`Semáforo ${luz}`} /> {conSigno(a.diferenciaBs)}</> : '—'}</span>
        </summary>
        <div className="detalle">{billetes ? `Desglose: ${billetes}` : 'Sin desglose de billetes.'}</div>
      </details>
    })}
  </section>
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
      <span>{e.diferenciaBs != null ? <><i className={`arqueo-luz ${semaforoDiferencia(e.diferenciaBs)}`} aria-hidden="true" /> {conSigno(e.diferenciaBs)}</> : '—'}</span>
    </div>)}
    {arqueos == null && <small>Los arqueos del turno no se pudieron leer.</small>}
  </div>
}
