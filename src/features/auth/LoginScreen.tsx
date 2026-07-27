import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { supabaseAuthSessionProvider } from '../../infrastructure/supabase/SupabaseAuthSessionProvider'
import { empresaStore as empresa } from '../../config/empresaStore'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!email.trim() || !password) return
    setSubmitting(true)
    setError('')
    try {
      await supabaseAuthSessionProvider.signIn(email.trim(), password)
      // No further action needed — PosContent's subscribe() picks up the new session.
    } catch {
      setError('Correo o contraseña incorrectos.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card form-grid" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="full login-brand"><strong>{empresa.razonSocial} · POS</strong><span>Iniciar sesión</span></div>
        <label className="full">Correo<input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" /></label>
        <label className="full">Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" /></label>
        {error && <div className="full login-error">{error}</div>}
        <button type="submit" className="full primary-button login-submit" disabled={submitting || !email.trim() || !password}><LogIn /> {submitting ? 'Ingresando...' : 'Ingresar'}</button>
      </form>
    </div>
  )
}
