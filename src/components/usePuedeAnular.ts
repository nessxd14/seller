import { useEffect, useState } from 'react'
import { anulacionService, authSessionProvider } from '../infrastructure/services'

/**
 * ¿Puede este usuario anular directo? Lo decide la base (app_puede_anular), nunca el rol ni el
 * permiso `cancel`. El repositorio cachea la respuesta por usuario; aquí solo se reconsulta cuando
 * cambia quien inició sesión. Mientras carga (o si falla) es false: se ofrece "Solicitar anulación",
 * que es la acción segura.
 */
export function usePuedeAnular(): boolean {
  const [puede, setPuede] = useState(false)
  useEffect(() => {
    let active = true
    const consultar = () => {
      anulacionService.puedeAnular().then((v) => { if (active) setPuede(v) }).catch(() => { if (active) setPuede(false) })
    }
    consultar()
    const unsubscribe = authSessionProvider.subscribe(() => { setPuede(false); consultar() })
    return () => { active = false; unsubscribe() }
  }, [])
  return puede
}
