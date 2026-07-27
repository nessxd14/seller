import { useEffect, useState } from 'react'
import { Printer, ShieldCheck, Store, User } from 'lucide-react'
import { configService } from '../../infrastructure/services'
import { loadEmpresaConfig } from '../../config/empresaStore'
import type { CajaSummary, EmpresaConfig, SucursalSummary, UserSummary } from '../../application/ports/configRepository'
import { FeatureShell, FeatureState } from '../shared/FeatureShell'
import { PRINT_FORMAT_STORAGE_KEY, type PrintFormat } from '../../components/printFormat'

const emptyEmpresa: EmpresaConfig = { razonSocial: '', nit: '', direccion: '', ciudad: '', telefono: '', email: '', pieDocumento: '' }

export function ConfigPage({ notify }: { notify: (message: string) => void }) {
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
      {empresaStatus === 'loading' ? <FeatureState type="loading" text="Cargando datos de la empresa" /> : empresaStatus === 'error' ? <FeatureState type="error" text="No se pudieron cargar los datos de la empresa" /> : <>
        <div className="modal-body form-grid">
          <label>Razón social<input value={empresa.razonSocial} onChange={(e) => setEmpresa({ ...empresa, razonSocial: e.target.value })} /></label>
          <label>NIT<input value={empresa.nit} onChange={(e) => setEmpresa({ ...empresa, nit: e.target.value })} /></label>
          <label>Dirección<input value={empresa.direccion} onChange={(e) => setEmpresa({ ...empresa, direccion: e.target.value })} /></label>
          <label>Ciudad<input value={empresa.ciudad} onChange={(e) => setEmpresa({ ...empresa, ciudad: e.target.value })} /></label>
          <label>Teléfono<input value={empresa.telefono} onChange={(e) => setEmpresa({ ...empresa, telefono: e.target.value })} /></label>
          <label>Email<input type="email" value={empresa.email} onChange={(e) => setEmpresa({ ...empresa, email: e.target.value })} /></label>
          <label className="full">Pie de documento<textarea value={empresa.pieDocumento} onChange={(e) => setEmpresa({ ...empresa, pieDocumento: e.target.value })} /></label>
        </div>
        <div className="settings-actions"><button className="primary-button" disabled={saving || !empresa.razonSocial.trim()} onClick={() => void saveEmpresa()}>{saving ? 'Guardando...' : 'Guardar cambios'}</button></div>
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
  </FeatureShell>
}
