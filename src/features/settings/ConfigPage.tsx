import { useEffect, useState } from 'react'
import { Printer, RefreshCw, ShieldCheck, Store, User } from 'lucide-react'
import { configService } from '../../infrastructure/services'
import { loadEmpresaConfig } from '../../config/empresaStore'
import type { CajaSummary, EmpresaConfig, SucursalSummary, UserSummary } from '../../application/ports/configRepository'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { PRINT_FORMAT_STORAGE_KEY, type PrintFormat } from '../../components/printFormat'
import { featureFlags } from '../../config/featureFlags'
import { pendienteSyncHermesRepository, type PendienteSyncHermes } from '../../infrastructure/supabase/PendienteSyncHermesRepository'
import { pendienteSyncHermesPagoRepository, type PendienteSyncHermesPago } from '../../infrastructure/supabase/PendienteSyncHermesPagoRepository'
import { registrarCargoSaldo, registrarPago } from '../../infrastructure/hermes/client'
import { uploadDocumentoEmpresa } from '../../infrastructure/supabase/DocumentosEmpresaStorage'

const emptyEmpresa: EmpresaConfig = { razonSocial: '', nit: '', direccion: '', ciudad: '', telefono: '', email: '', pieDocumento: '', selloUrl: '', firmaUrl: '', firmaNombre: '', firmaCargo: '' }
const moneyBs = (value: number) => value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ConfigPage({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const [empresa, setEmpresa] = useState<EmpresaConfig>(emptyEmpresa)
  const [empresaStatus, setEmpresaStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<UserSummary[]>([])
  const [usersStatus, setUsersStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sucursales, setSucursales] = useState<SucursalSummary[]>([])
  const [cajas, setCajas] = useState<CajaSummary[]>([])
  const [printFormat, setPrintFormat] = useState<PrintFormat>(() => (localStorage.getItem(PRINT_FORMAT_STORAGE_KEY) as PrintFormat) || 'ticket-80')

  useEffect(() => {
    void configService.getEmpresaConfig().then((value) => { setEmpresa(value); setEmpresaStatus('ready') }).catch(() => setEmpresaStatus('error'))
    void configService.listUsers().then((value) => { setUsers(value); setUsersStatus('ready') }).catch(() => setUsersStatus('error'))
    void configService.listSucursales().then(setSucursales)
    void configService.listCajas().then(setCajas)
  }, [])

  const saveEmpresa = async () => {
    setSaving(true)
    try {
      const saved = await configService.saveEmpresaConfig(empresa)
      setEmpresa(saved)
      // Refresh the shared print-time store in place so any print preview opened
      // right after this save shows the new data without a page reload.
      await loadEmpresaConfig()
      notify('Datos de la empresa guardados')
    } catch {
      notify('No se pudo guardar. Intenta nuevamente')
    } finally {
      setSaving(false)
    }
  }

  const changeFormat = (value: PrintFormat) => { setPrintFormat(value); localStorage.setItem(PRINT_FORMAT_STORAGE_KEY, value) }

  return <FeatureShell eyebrow="SISTEMA" title="Configuración" subtitle="Datos de la empresa, usuarios y preferencias de impresión">
    <section className="settings-section">
      <header><Store size={16} /><h2>Datos de la empresa</h2><p>Aparecen en tickets, cotizaciones, pedidos y notas de entrega</p></header>
      {!canEdit && <p className="settings-note">Solo un administrador puede editar los datos de la empresa.</p>}
      {empresaStatus === 'loading' ? <FeatureState type="loading" text="Cargando datos de la empresa" /> : empresaStatus === 'error' ? <FeatureState type="error" text="No se pudieron cargar los datos de la empresa" /> : <>
        <div className="modal-body form-grid">
          <label>Razón social<input disabled={!canEdit} value={empresa.razonSocial} onChange={(e) => setEmpresa({ ...empresa, razonSocial: e.target.value })} /></label>
          <label>NIT<input disabled={!canEdit} value={empresa.nit} onChange={(e) => setEmpresa({ ...empresa, nit: e.target.value })} /></label>
          <label>Dirección<input disabled={!canEdit} value={empresa.direccion} onChange={(e) => setEmpresa({ ...empresa, direccion: e.target.value })} /></label>
          <label>Ciudad<input disabled={!canEdit} value={empresa.ciudad} onChange={(e) => setEmpresa({ ...empresa, ciudad: e.target.value })} /></label>
          <label>Teléfono<input disabled={!canEdit} value={empresa.telefono} onChange={(e) => setEmpresa({ ...empresa, telefono: e.target.value })} /></label>
          <label>Email<input type="email" disabled={!canEdit} value={empresa.email} onChange={(e) => setEmpresa({ ...empresa, email: e.target.value })} /></label>
          <label className="full">Pie de documento<textarea disabled={!canEdit} value={empresa.pieDocumento} onChange={(e) => setEmpresa({ ...empresa, pieDocumento: e.target.value })} /></label>
        </div>
        {featureFlags.supabase && <div className="modal-body form-grid">
          <label>Nombre de quien firma<input disabled={!canEdit} value={empresa.firmaNombre} placeholder="Ej. Rony Argana" onChange={(e) => setEmpresa({ ...empresa, firmaNombre: e.target.value })} /></label>
          <label>Cargo<input disabled={!canEdit} value={empresa.firmaCargo} placeholder="Ej. Gerente Comercial" onChange={(e) => setEmpresa({ ...empresa, firmaCargo: e.target.value })} /></label>
          <ImageUploadField
            label="Sello"
            hint="PNG con fondo transparente — un JPG con fondo blanco tapa el texto del documento."
            url={empresa.selloUrl}
            disabled={!canEdit}
            onUploaded={(url) => setEmpresa({ ...empresa, selloUrl: url })}
            notify={notify}
          />
          <ImageUploadField
            label="Firma"
            hint="PNG con fondo transparente, igual que el sello."
            url={empresa.firmaUrl}
            disabled={!canEdit}
            onUploaded={(url) => setEmpresa({ ...empresa, firmaUrl: url })}
            notify={notify}
          />
        </div>}
        {canEdit && <div className="settings-actions"><button className="primary-button" disabled={saving || !empresa.razonSocial.trim()} onClick={() => void saveEmpresa()}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div>}
      </>}
    </section>

    <section className="settings-section">
      <header><User size={16} /><h2>Usuarios</h2><p>Solo lectura — la creación y edición de usuarios se gestiona fuera del POS</p></header>
      {usersStatus === 'loading' ? <FeatureState type="loading" text="Cargando usuarios" /> : usersStatus === 'error' ? <FeatureState type="error" text="No se pudieron cargar los usuarios" /> : !users.length ? <FeatureState type="empty" text="No hay usuarios" /> : <div className="feature-table settings-users-table">
        <div className="table-head"><span>Nombre</span><span>Email</span><span>Rol</span><span>Estado</span></div>
        {users.map((user) => <article key={user.id}><span>{user.nombre}</span><span>{user.email || '—'}</span><span>{user.rol}</span><span className={`status-chip ${user.activo ? 'ok' : 'problem'}`}>{user.activo ? 'Activo' : 'Inactivo'}</span></article>)}
      </div>}
    </section>

    <section className="settings-section">
      <header><ShieldCheck size={16} /><h2>Sucursales y caja</h2><p>Configuración operativa actual</p></header>
      <div className="settings-sucursales">
        {sucursales.map((sucursal) => <div key={sucursal.id} className="settings-sucursal-card"><strong>{sucursal.nombre}</strong><span>Sucursal #{sucursal.id}</span></div>)}
      </div>
      {cajas.map((caja) => <div key={caja.id} className="settings-caja-row"><span>{caja.nombre}</span><span className={`status-chip ${caja.activa ? 'ok' : 'problem'}`}>{caja.activa ? 'Activa' : 'Inactiva'}</span></div>)}
      <p className="settings-note">Actualmente solo una caja está habilitada.</p>
    </section>

    <section className="settings-section">
      <header><Printer size={16} /><h2>Impresión</h2><p>Formato de ticket por defecto (puede cambiarse por impresión desde la vista previa)</p></header>
      <div className="settings-print-format">
        <button className={printFormat === 'ticket-58' ? 'active' : ''} onClick={() => changeFormat('ticket-58')}>Térmico 58 mm</button>
        <button className={printFormat === 'ticket-80' ? 'active' : ''} onClick={() => changeFormat('ticket-80')}>Térmico 80 mm</button>
      </div>
    </section>

    {featureFlags.supabase && <HermesSyncSection notify={notify} canEdit={canEdit} />}
    {featureFlags.supabase && <HermesPagosSyncSection notify={notify} canEdit={canEdit} />}
  </FeatureShell>
}

function HermesSyncSection({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const [pendientes, setPendientes] = useState<PendienteSyncHermes[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const fetchPendientes = () => pendienteSyncHermesRepository.listPendientes().then((value) => { setPendientes(value); setStatus('ready') }).catch(() => setStatus('error'))
  const load = () => { setStatus('loading'); void fetchPendientes() }
  useEffect(() => { void fetchPendientes() }, [])

  const retry = async (pendiente: PendienteSyncHermes) => {
    setRetryingId(pendiente.id)
    try {
      await registrarCargoSaldo({ clienteId: Number(pendiente.clienteId), monto: pendiente.monto, ventaId: pendiente.ventaId, usuarioPos: pendiente.usuarioPos ?? 'config' })
      await pendienteSyncHermesRepository.marcarSincronizado(pendiente.id)
      notify(`Venta #${pendiente.ventaId} sincronizada con Hermes`)
      load()
    } catch (err) {
      await pendienteSyncHermesRepository.registrarFallo({
        ventaId: pendiente.ventaId,
        clienteId: pendiente.clienteId,
        monto: pendiente.monto,
        usuarioPos: pendiente.usuarioPos ?? 'config',
        error: err instanceof Error ? err.message : 'No se pudo registrar el cargo en Hermes',
      })
      notify('No se pudo sincronizar. Se mantiene en la cola de reintentos')
      load()
    } finally {
      setRetryingId(null)
    }
  }

  return <section className="settings-section">
    <header><RefreshCw size={16} /><h2>Sincronización con Hermes</h2><p>Cargos a saldo a favor que no se pudieron registrar en Hermes al momento de la venta</p></header>
    {status === 'loading' ? <FeatureState type="loading" text="Cargando pendientes" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar los pendientes" /> : !pendientes.length ? <FeatureState type="empty" text="No hay sincronizaciones pendientes" /> : <div className="hermes-pendientes-list">
      {pendientes.map((p) => <div key={p.id} className="hermes-pendiente-row">
        <div className="hermes-pendiente-info">
          <strong>Venta #{p.ventaId} · Bs {moneyBs(p.monto)}</strong>
          <small>{p.intentos} intento{p.intentos === 1 ? '' : 's'}{p.ultimoIntento ? ` · último ${new Date(p.ultimoIntento).toLocaleString('es-BO')}` : ''}</small>
          {p.ultimoError && <span className="hermes-pendiente-error">{p.ultimoError}</span>}
        </div>
        {canEdit && <button className="secondary-button" disabled={retryingId === p.id} onClick={() => void retry(p)}>{retryingId === p.id ? 'Reintentando...' : 'Reintentar'}</button>}
      </div>)}
    </div>}
  </section>
}

function HermesPagosSyncSection({ notify, canEdit }: { notify: (message: string) => void; canEdit: boolean }) {
  const [pendientes, setPendientes] = useState<PendienteSyncHermesPago[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const fetchPendientes = () => pendienteSyncHermesPagoRepository.listPendientes().then((value) => { setPendientes(value); setStatus('ready') }).catch(() => setStatus('error'))
  const load = () => { setStatus('loading'); void fetchPendientes() }
  useEffect(() => { void fetchPendientes() }, [])

  const retry = async (pendiente: PendienteSyncHermesPago) => {
    setRetryingId(pendiente.id)
    try {
      await registrarPago({
        clienteId: Number(pendiente.clienteId),
        monto: pendiente.monto,
        medio: pendiente.metodo,
        pedidoId: pendiente.pedidoId,
        movimientoCajaId: pendiente.movimientoCajaId,
        usuarioPos: pendiente.usuarioPos ?? 'config',
      })
      await pendienteSyncHermesPagoRepository.marcarSincronizado(pendiente.id)
      notify(`Pago del movimiento #${pendiente.movimientoCajaId} sincronizado con Hermes`)
      load()
    } catch (err) {
      await pendienteSyncHermesPagoRepository.registrarFallo({
        movimientoCajaId: pendiente.movimientoCajaId,
        clienteId: pendiente.clienteId,
        pedidoId: pendiente.pedidoId,
        monto: pendiente.monto,
        metodo: pendiente.metodo,
        usuarioPos: pendiente.usuarioPos ?? 'config',
        error: err instanceof Error ? err.message : 'No se pudo registrar el pago en Hermes',
      })
      notify('No se pudo sincronizar. Se mantiene en la cola de reintentos')
      load()
    } finally {
      setRetryingId(null)
    }
  }

  return <section className="settings-section">
    <header><RefreshCw size={16} /><h2>Sincronización de pagos con Hermes</h2><p>Pagos de clientes que no se pudieron proponer en Hermes al momento de cobrarlos</p></header>
    {status === 'loading' ? <FeatureState type="loading" text="Cargando pendientes" /> : status === 'error' ? <FeatureState type="error" text="No se pudieron cargar los pendientes" /> : !pendientes.length ? <FeatureState type="empty" text="No hay sincronizaciones pendientes" /> : <div className="hermes-pendientes-list">
      {pendientes.map((p) => <div key={p.id} className="hermes-pendiente-row">
        <div className="hermes-pendiente-info">
          <strong>Movimiento #{p.movimientoCajaId} · Bs {moneyBs(p.monto)}{p.pedidoId ? ` · Pedido ${p.pedidoId}` : ''}</strong>
          <small>{p.intentos} intento{p.intentos === 1 ? '' : 's'}{p.ultimoIntento ? ` · último ${new Date(p.ultimoIntento).toLocaleString('es-BO')}` : ''}</small>
          {p.ultimoError && <span className="hermes-pendiente-error">{p.ultimoError}</span>}
        </div>
        {canEdit && <button className="secondary-button" disabled={retryingId === p.id} onClick={() => void retry(p)}>{retryingId === p.id ? 'Reintentando...' : 'Reintentar'}</button>}
      </div>)}
    </div>}
  </section>
}

// Brief S11 Bloque A: sube al bucket `documentos-empresa` (escritura solo admin, ver
// política RLS) y devuelve la ruta pública — el llamador la guarda con saveEmpresaConfig
// en el siguiente "Guardar cambios", no acá (subir no es lo mismo que confirmar).
function ImageUploadField({ label, hint, url, disabled, onUploaded, notify }: { label: string; hint: string; url: string; disabled: boolean; onUploaded: (url: string) => void; notify: (message: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const uploaded = await uploadDocumentoEmpresa(file, label === 'Sello' ? 'sello' : 'firma')
      onUploaded(uploaded)
      notify(`${label} actualizado — guardá los cambios para confirmar`)
    } catch {
      notify(`No se pudo subir ${label.toLowerCase()}`)
    } finally {
      setUploading(false)
    }
  }
  return <label className="full image-upload-field">
    {label}
    <div className="image-upload-row">
      {url ? <img src={url} alt={label} onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <span className="image-upload-empty">Sin {label.toLowerCase()}</span>}
      <input type="file" accept="image/png,image/*" disabled={disabled || uploading} onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
    <small>{hint}</small>
  </label>
}
