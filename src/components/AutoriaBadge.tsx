import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { featureFlags } from '../config/featureFlags'
import { resolveNombrePorEmail } from '../infrastructure/supabase/PerfilRepository.supabase'

/**
 * Brief S3 Parte B: "creado_por es un texto con el email. Resolver el nombre contra
 * perfil... con el email como respaldo si no hay perfil." Modo mock no tiene tabla
 * perfil real — muestra el valor crudo tal cual (ya suele ser un nombre en ese backend).
 */
export function AutoriaBadge({ label, email }: { label: string; email?: string }) {
  const [nombre, setNombre] = useState(email ?? '')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el nombre mostrado con el email que llega por prop, no hay nada async que esperar en estos dos casos
    if (!email) { setNombre(''); return }
    if (!featureFlags.supabase) { setNombre(email); return }
    let cancelled = false
    void resolveNombrePorEmail(email).then((resolved) => { if (!cancelled) setNombre(resolved) })
    return () => { cancelled = true }
  }, [email])
  if (!email) return null
  return <span className="autoria-badge"><UserRound size={11} /><small>{label}</small><strong>{nombre}</strong></span>
}
