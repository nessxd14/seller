import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, LogOut, RefreshCw, WalletCards } from 'lucide-react'
import { authSessionProvider, turnoService } from '../../infrastructure/services'
import { supabaseAuthSessionProvider } from '../../infrastructure/supabase/SupabaseAuthSessionProvider'
import { hasPermission, type AuthSession } from '../../application/auth/AuthSessionProvider'
import type { TurnoSesion } from '../../application/shared/models'
import { CashSessionProvider } from '../../context/CashSessionContext'
import { CashPage, MiTurnoPanel, SupervisionPanel } from './CashPage'
import { useCashRefresh } from './useCashRefresh'
import logo from '../../assets/logo-cation.png'

function companionUrl(configured: string | undefined, port: number): string {
  const url = new URL(configured || `${window.location.protocol}//${window.location.hostname}:${port}`)
  if (['localhost', '127.0.0.1'].includes(url.hostname)) url.hostname = window.location.hostname
  return url.toString()
}

export function RemoteCashApp() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  useEffect(() => {
    let active = true
    const received = (value: AuthSession | null) => { if (active) { setSession(value); setLoading(false); setError('') } }
    void authSessionProvider.getSession().then(received).catch(() => { if (active) { setError('No se pudo comprobar la sesión. Revisa tu conexión.'); setLoading(false) } })
    const unsubscribe = authSessionProvider.subscribe(received)
    return () => { active = false; unsubscribe() }
  }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 6000); return () => clearTimeout(id) }, [toast])
  const signOut = async () => { try { await supabaseAuthSessionProvider.signOut() } catch { setToast('No se pudo cerrar la sesión. Reintenta.') } }
  return <div className="remote-cash-app">
    <header className="remote-topbar"><a className="remote-brand" href="/"><img src={logo} alt="Cation" /><span>Caja</span></a>{session && <div className="remote-user"><span>{session.user.name}<small>{session.user.role}</small></span><button aria-label="Cerrar sesión" onClick={() => void signOut()}><LogOut /></button></div>}</header>
    {loading ? <main className="remote-login"><p role="status">Comprobando tu sesión…</p></main> : error ? <main className="remote-login"><p role="alert">{error}</p><button onClick={() => window.location.reload()}>Reintentar</button></main> : !session ? <CashLogin /> : !hasPermission(session, 'cash_own') && !hasPermission(session, 'cash_supervise') ? <main className="remote-login"><h1>Acceso a caja restringido</h1><p>Tu cuenta necesita un perfil activo de cajero, administrador o gerente.</p><button onClick={() => void signOut()}>Cambiar cuenta</button></main> : <CashSessionProvider key={`${session.user.id}:${session.user.role}`}><RemoteCashPanel session={session} notify={setToast} /></CashSessionProvider>}
    {toast && <div className="remote-toast" role="status">{toast}<button aria-label="Cerrar aviso" onClick={() => setToast('')}>×</button></div>}
  </div>
}

function CashLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (busy || !email.trim() || !password) return
    setBusy(true); setError('')
    try { await supabaseAuthSessionProvider.signIn(email.trim(), password) }
    catch { setError('No se pudo ingresar. Comprueba el correo, la contraseña y tu conexión.') }
    finally { setBusy(false) }
  }
  return <main className="remote-login"><section><WalletCards /><h1>Tu caja, donde estés.</h1><p>Consulta los turnos y los cobros de tus cajeros desde el celular.</p><form onSubmit={(e) => { e.preventDefault(); void submit() }}><label>Correo de Seller<input autoComplete="username" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Contraseña<input autoComplete="current-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <p className="cash-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar a caja'}</button></form><small>Usa tu misma cuenta de Seller. Cada cuenta conserva sus permisos.</small></section></main>
}

function RemoteCashPanel({ session, notify }: { session: AuthSession; notify: (message: string) => void }) {
  const manager = hasPermission(session, 'cash_supervise')
  const [tab, setTab] = useState(manager ? 'live' : 'own')
  const [turnos, setTurnos] = useState<TurnoSesion[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const navigate = (value: string) => {
    setTab(value)
    setSelected(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const load = useCallback(async () => {
    if (!manager) return
    try { setTurnos(await turnoService.list()); setUpdatedAt(new Date()); setError('') }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron consultar los turnos') }
  }, [manager])
  useCashRefresh(load, 'remote-list')
  const active = turnos.find((t) => t.estado === 'ABIERTA')
  const detail = tab === 'live' ? active : tab === 'history' ? turnos.find((t) => t.id === selected) : undefined
  return <div className="remote-frame">
    <div className="remote-title"><div><h1>{manager ? 'Control de caja' : 'Mi caja'}</h1><p>{manager ? 'Los cobros de cada cajero, en su turno.' : 'Apertura, movimientos y cierre de tu turno.'}</p></div><div className="remote-links"><a href={companionUrl(import.meta.env.VITE_SELLER_URL, 5180)} target="_blank" rel="noreferrer">Seller <ExternalLink /></a><a href={companionUrl(import.meta.env.VITE_CONCILIADOR_URL, 3000)} target="_blank" rel="noreferrer">Conciliador <ExternalLink /></a></div></div>
    {manager && <nav className="remote-tabs" aria-label="Vistas de caja">{[['live', 'En vivo'], ['history', 'Turnos'], ['review', 'Revisión'], ['own', 'Mi caja']].map(([value, label]) => <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => navigate(value)}>{label}</button>)}</nav>}
    {manager && (error || (!detail && tab !== 'own')) && <div className="remote-connection"><span className={error ? 'cash-error' : ''} role={error ? 'alert' : undefined}>{error || (updatedAt ? `Actualizado ${updatedAt.toLocaleTimeString('es-BO')} · cada 15 s` : 'Consultando turnos…')}</span><button aria-label="Actualizar turnos" onClick={() => void load()}><RefreshCw /></button></div>}
    {tab === 'own' ? <CashPage notify={notify} /> : tab === 'review' ? <div className="cash-workspace"><SupervisionPanel notify={notify} /></div> : detail ? <div className="cash-workspace">{tab === 'history' && <button className="cash-back" onClick={() => setSelected(null)}><ArrowLeft /> Todos los turnos</button>}<MiTurnoPanel key={detail.id} sesion={detail} isManager notify={notify} readOnly onClosed={() => void load()} /></div> : tab === 'history' ? <section className="remote-history"><header><h2>Turnos de caja</h2><p>Últimos 50 turnos. Abre uno para ver sus ventas, anticipos y gastos.</p></header>{turnos.map((t) => <button className="remote-turno-row" key={t.id} onClick={() => setSelected(t.id)}><div><strong>{t.cajaNombre} · #{t.id}</strong><span>{t.abiertaPor || 'Cajero sin nombre registrado'}</span><small>{new Date(t.abiertaEn).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })}</small></div><span className={`cash-status ${t.estado.toLowerCase()}`}>{t.estado === 'ABIERTA' ? 'Abierto' : t.estado === 'EN_REVISION' ? 'En revisión' : 'Cerrado'}</span><ArrowLeft className="remote-row-arrow" /></button>)}{!turnos.length && !error && <p>No hay turnos registrados.</p>}</section> : <section className="remote-no-turno"><WalletCards /><h2>No hay una caja abierta</h2><p>Cuando un cajero abra su turno, sus ventas y cobros aparecerán aquí.</p><button onClick={() => setTab('history')}>Consultar turnos anteriores</button></section>}
  </div>
}
