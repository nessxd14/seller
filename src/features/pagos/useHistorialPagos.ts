import { useCallback, useEffect, useRef, useState } from 'react'
import { consultarHistorialPagos } from '../../infrastructure/hermes/client'
import { SinAccesoPagosError, TIPOS_PAGO, type FilaPago, type HistorialPagos, type ParamsHistorialPagos, type TipoPago } from '../../domain/pagos/historialPagos'

export const TAMANO_PAGINA = 100

const mensajeDe = (err: unknown, fallback: string) => err instanceof Error && err.message ? err.message : fallback

interface Resultado { clave: string; datos?: HistorialPagos; error?: string; sinAcceso?: boolean }
interface Extra { clave: string; filas: FilaPago[]; cargando: boolean; error?: string }

/**
 * Consulta paginada de `historial_pagos`. Sin `setState` síncrono en el efecto: «cargando» se deduce de que
 * el resultado guardado todavía no corresponde a los parámetros vigentes. `params = null` no consulta.
 */
export function useHistorialPagos(params: ParamsHistorialPagos | null) {
  const [reintentos, setReintentos] = useState(0)
  const clave = `${params ? JSON.stringify(params) : ''}#${reintentos}`
  const claveVigente = useRef(clave)
  useEffect(() => { claveVigente.current = clave }, [clave])
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [extra, setExtra] = useState<Extra | null>(null)

  useEffect(() => {
    const [json] = clave.split('#')
    if (!json) return
    let cancelado = false
    const consulta = JSON.parse(json) as ParamsHistorialPagos
    consultarHistorialPagos({ ...consulta, limite: TAMANO_PAGINA, offset: 0 })
      .then(datos => { if (!cancelado) setResultado({ clave, datos }) })
      .catch((err: unknown) => { if (!cancelado) setResultado({ clave, error: mensajeDe(err, 'No se pudieron consultar los pagos.'), sinAcceso: err instanceof SinAccesoPagosError }) })
    return () => { cancelado = true }
  }, [clave])

  const vigente = resultado?.clave === clave ? resultado : null
  const extraVigente = extra?.clave === clave ? extra : null
  const filas = [...(vigente?.datos?.filas ?? []), ...(extraVigente?.filas ?? [])]
  const total = vigente?.datos?.total ?? 0

  const cargarMas = useCallback(async () => {
    const [json] = clave.split('#')
    if (!json || !vigente?.datos || extraVigente?.cargando) return
    const previas = extraVigente?.filas ?? []
    const offset = vigente.datos.filas.length + previas.length
    setExtra({ clave, filas: previas, cargando: true })
    try {
      const r = await consultarHistorialPagos({ ...(JSON.parse(json) as ParamsHistorialPagos), limite: TAMANO_PAGINA, offset })
      if (claveVigente.current === clave) setExtra({ clave, filas: [...previas, ...r.filas], cargando: false })
    } catch (err) {
      if (claveVigente.current === clave) setExtra({ clave, filas: previas, cargando: false, error: mensajeDe(err, 'No se pudo cargar más.') })
    }
  }, [clave, vigente, extraVigente])

  return {
    cargando: !!params && !vigente,
    error: vigente?.error ?? null,
    sinAcceso: vigente?.sinAcceso ?? false,
    filas, total,
    resumen: vigente?.datos?.resumen ?? null,
    cliente: vigente?.datos?.cliente,
    hayMas: !!vigente?.datos && filas.length < total,
    cargandoMas: extraVigente?.cargando ?? false,
    errorMas: extraVigente?.error ?? null,
    cargarMas,
    reintentar: () => setReintentos(n => n + 1),
  }
}

export type ConteosPorTipo = Record<TipoPago, number>

/** Cuántos movimientos hay de cada tipo con los demás filtros vigentes (el filtro de tipo se ignora). */
export function useConteosPorTipo(params: Omit<ParamsHistorialPagos, 'tipo' | 'limite' | 'offset'> | null): ConteosPorTipo | null {
  const clave = params ? JSON.stringify(params) : ''
  const [estado, setEstado] = useState<{ clave: string; conteos: ConteosPorTipo | null } | null>(null)
  useEffect(() => {
    if (!clave) return
    let cancelado = false
    const base = JSON.parse(clave) as ParamsHistorialPagos
    Promise.all(TIPOS_PAGO.map(tipo => consultarHistorialPagos({ ...base, tipo, limite: 1, offset: 0 }).then(r => [tipo, r.total] as const)))
      .then(pares => { if (!cancelado) setEstado({ clave, conteos: Object.fromEntries(pares) as ConteosPorTipo }) })
      .catch(() => { if (!cancelado) setEstado({ clave, conteos: null }) })
    return () => { cancelado = true }
  }, [clave])
  return estado?.clave === clave ? estado.conteos : null
}
