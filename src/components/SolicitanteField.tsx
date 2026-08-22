import { ChevronDown, Search, UserPlus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { buscarContactos, crearContacto, type ContactoCliente } from '../infrastructure/supabase/ContactoCliente.supabase'

export interface SolicitanteValue { id: string; nombre: string }

const emptyForm = { nombre: '', cargo: '', telefono: '', email: '', tope: '' }

/**
 * Brief S-C — picker de solicitante (contacto de una institución/empresa), reutilizable
 * entre el formulario de cotización (opcional) y el de pedido (obligatorio para
 * institucional/corporativo). Mismo patrón buscar+crear-inline que CustomerPicker.tsx.
 * `required` no solo pinta el borde: también es la señal de "todavía falta elegir uno" —
 * el llamador la calcula (ver DraftOrderEditor: nunca bloquea "Guardar como cotización",
 * solo "Crear pedido"/"Convertir a pedido").
 */
export function SolicitanteField({ clienteId, value, onChange, required, actorId }: {
  clienteId: string
  value: SolicitanteValue | null
  onChange: (value: SolicitanteValue | null) => void
  required?: boolean
  actorId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ContactoCliente[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState<typeof emptyForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const closeAll = () => { setExpanded(false); setCreating(null); setQuery(''); setError('') }

  useEffect(() => {
    if (!expanded) return
    const onClickOutside = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeAll() }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [expanded])

  useEffect(() => {
    if (!expanded || creating) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mismo patrón que CustomerPicker: la bandera de carga tiene que cambiar apenas cambia la query, antes de que resuelva el debounce
    setSearching(true)
    const handle = setTimeout(() => {
      void buscarContactos(clienteId, query.trim() || null).then((list) => { if (!cancelled) { setResults(list); setSearching(false) } })
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [expanded, creating, query, clienteId])

  const pick = (contacto: ContactoCliente) => { onChange({ id: contacto.id, nombre: contacto.nombre }); closeAll() }
  const startNew = () => setCreating({ ...emptyForm, nombre: query })

  const confirmCreate = async () => {
    if (!creating || !creating.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setSaving(true)
    setError('')
    try {
      const topeTrimmed = creating.tope.trim()
      const created = await crearContacto(clienteId, {
        nombre: creating.nombre,
        cargo: creating.cargo,
        telefono: creating.telefono,
        email: creating.email,
        topeAutorizado: topeTrimmed === '' ? undefined : Number(topeTrimmed),
      }, actorId)
      onChange({ id: created.id, nombre: created.nombre })
      closeAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el contacto')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label className="full solicitante-field">
      Solicitante{required && <span className="field-required-mark"> *</span>}
      <div className="customer-picker" ref={rootRef}>
        <button type="button" className={`customer-select ${required ? 'required' : ''}`} onClick={() => setExpanded((v) => !v)}>
          <UserRound /><span><small>SOLICITANTE</small><strong>{value ? value.nombre : 'Sin elegir'}</strong></span><ChevronDown className={expanded ? 'chevron-open' : ''} />
        </button>
        {expanded && <div className="customer-picker-panel">
          {creating ? <div className="customer-new-form">
            <div className="form-grid">
              <label className="full">Nombre<input value={creating.nombre} onChange={(e) => setCreating({ ...creating, nombre: e.target.value })} autoFocus /></label>
              <label>Cargo<input value={creating.cargo} onChange={(e) => setCreating({ ...creating, cargo: e.target.value })} /></label>
              <label>Teléfono<input value={creating.telefono} onChange={(e) => setCreating({ ...creating, telefono: e.target.value })} /></label>
              <label className="full">Email<input value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></label>
              <label className="full">Tope autorizado (Bs)
                <input type="number" min="0" step="0.01" placeholder="Sin tope" value={creating.tope} onChange={(e) => setCreating({ ...creating, tope: e.target.value })} />
                <small className="field-required-hint">Opcional. Vacío = sin tope. Si el contacto tiene uno propio, ese manda sobre el de la institución.</small>
              </label>
            </div>
            {error && <div className="mock-note payment-error"><p>{error}</p></div>}
            <div className="customer-picker-actions">
              <button type="button" className="secondary-button" onClick={() => setCreating(null)}>Cancelar</button>
              <button type="button" className="primary-button" disabled={saving} onClick={() => void confirmCreate()}>{saving ? 'Guardando…' : 'Guardar contacto'}</button>
            </div>
          </div> : <>
            <div className="customer-search-box"><Search /><input placeholder="Buscar contacto por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /></div>
            {value && <div className="customer-picker-quick"><button type="button" onClick={() => { onChange(null); closeAll() }}>Sin solicitante</button></div>}
            <div className="customer-results">
              {searching
                ? <p className="product-info-empty">Buscando…</p>
                : <>
                    {results.map((c) => (
                      <button type="button" key={c.id} className="customer-result-row" onClick={() => pick(c)}>
                        <strong>{c.nombre}</strong>
                        {c.cargo && <small>{c.cargo}</small>}
                      </button>
                    ))}
                    {!results.length && <p className="product-info-empty">Sin resultados{query ? ` para "${query}"` : ''}.</p>}
                    <button type="button" className="customer-result-row" onClick={startNew}><UserPlus size={14} /> Nuevo contacto</button>
                  </>}
            </div>
          </>}
        </div>}
      </div>
      {required && <small className="field-required-hint">Este cliente requiere elegir un solicitante para el pedido — la cotización se puede guardar sin uno.</small>}
    </label>
  )
}
