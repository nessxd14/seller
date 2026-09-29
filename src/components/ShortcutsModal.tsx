import { Modal } from './Modal'
import { shortcuts, type ShortcutDef } from '../config/shortcuts'

const GROUPS: ShortcutDef['group'][] = ['Búsqueda', 'Carrito', 'Operación', 'Modos', 'Ayuda']

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return <Modal title="Atajos de teclado" subtitle="El POS se puede usar completo desde el teclado" onClose={onClose} wide>
    <div className="modal-body shortcuts-modal-body">
      <div className="shortcuts-grid">
        {GROUPS.map((group) => {
          const items = shortcuts.filter((s) => s.group === group)
          if (!items.length) return null
          return <section key={group} className="shortcuts-group">
            <h3>{group}</h3>
            <ul>
              {items.map((s) => <li key={s.id}>
                <span className="shortcuts-keys">{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                <span className="shortcuts-label">{s.label}</span>
              </li>)}
            </ul>
          </section>
        })}
      </div>
      <p className="shortcuts-footnote">Los atajos no saltan validaciones: si un botón está deshabilitado, su atajo tampoco hace nada.</p>
    </div>
  </Modal>
}
