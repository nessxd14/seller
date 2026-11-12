import { useEffect, useState } from 'react'
import type { CajaVendedorPiso } from '../../application/ports/pisoRepository'
import { authSessionProvider, pisoRepository } from '../../infrastructure/services'

// Mismos roles que acepta caja_reclamos / caja_asignar_vendedor.
const ROLES_QUE_ASIGNAN = ['cajero', 'supervisor', 'gerente', 'admin']
const SIN_VENDEDOR = ''
const mensaje = (e: unknown, porDefecto: string) => (e instanceof Error && e.message ? e.message : porDefecto)

interface Dueno { perfilId: string; nombre: string }

/** "Vendedor: Ana · Cambiar" en el detalle de una venta cobrada. Solo para caja y gerencia. */
export function VendedorDeVenta({ ventaId, onChanged }: { ventaId: string; onChanged?: () => void }) {
  const [permitido, setPermitido] = useState(false)
  const [dueno, setDueno] = useState<Dueno | null>(null)
  const [cargado, setCargado] = useState(false)
  const [editando, setEditando] = useState(false)
  const [vendedores, setVendedores] = useState<CajaVendedorPiso[]>([])
  const [elegido, setElegido] = useState(SIN_VENDEDOR)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const ventaNumero = Number(ventaId)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        const sesion = await authSessionProvider.getSession()
        if (!sesion || !ROLES_QUE_ASIGNAN.includes(sesion.user.role) || !Number.isFinite(ventaNumero)) return
        const filas = await pisoRepository.cajaReclamos([ventaNumero])
        if (cancelado) return
        setPermitido(true)
        setDueno(filas[0] ? { perfilId: filas[0].perfilId, nombre: filas[0].nombre } : null)
        setCargado(true)
      } catch { /* sin el dato (o sin permiso) la fila simplemente no aparece */ }
    })()
    return () => { cancelado = true }
  }, [ventaNumero])

  if (!permitido || !cargado) return null

  const abrir = async () => {
    setError('')
    setElegido(dueno?.perfilId ?? SIN_VENDEDOR)
    setMotivo('')
    setEditando(true)
    try { setVendedores(await pisoRepository.cajaVendedoresPiso()) } catch (e) { setError(mensaje(e, 'No se pudo cargar la lista de vendedores.')) }
  }

  const actual = dueno?.perfilId ?? SIN_VENDEDOR
  const cambia = elegido !== actual
  // Cambiar o quitar a un dueño que ya existe exige motivo; asignar una venta sin dueño, no.
  const exigeMotivo = dueno != null && cambia
  const puedeGuardar = cambia && (!exigeMotivo || motivo.trim().length > 0) && !guardando

  const guardar = async () => {
    if (!puedeGuardar) return
    setGuardando(true)
    setError('')
    try {
      await pisoRepository.cajaAsignarVendedor(ventaNumero, elegido === SIN_VENDEDOR ? null : elegido, exigeMotivo ? motivo.trim() : undefined)
      const nombre = vendedores.find((v) => v.perfilId === elegido)?.nombre
      setDueno(elegido === SIN_VENDEDOR || !nombre ? null : { perfilId: elegido, nombre })
      setEditando(false)
      onChanged?.()
    } catch (e) { setError(mensaje(e, 'No se pudo cambiar el vendedor.')) } finally { setGuardando(false) }
  }

  return <div className="venta-vendedor">
    <p>Vendedor: <strong>{dueno?.nombre ?? 'sin vendedor'}</strong> {!editando && <button type="button" className="aprobacion-link" onClick={() => void abrir()}>Cambiar</button>}</p>
    {editando && <div className="venta-vendedor-form">
      <label>Vendedor
        <select value={elegido} onChange={(e) => setElegido(e.target.value)}>
          <option value={SIN_VENDEDOR}>Sin vendedor</option>
          {vendedores.map((v) => <option key={v.perfilId} value={v.perfilId}>{v.nombre}{v.enTurno ? ' · en turno' : ''}</option>)}
        </select>
      </label>
      {exigeMotivo && <label>Motivo
        <input type="text" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
      </label>}
      {error && <p role="alert">{error}</p>}
      <div className="venta-vendedor-acciones">
        <button type="button" className="secondary-button" onClick={() => setEditando(false)}>Cancelar</button>
        <button type="button" className="primary-button" disabled={!puedeGuardar} onClick={() => void guardar()}>Guardar</button>
      </div>
    </div>}
  </div>
}
