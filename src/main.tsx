import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PosPage } from './pages/PosPage'
import './styles.css'
import './phase11.css'
import './workflows.css'
import './print.css'
import './integration-readiness.css'
import './pos-ajustes.css'
import './pos-ajustes-r2.css'
import './pos-ajustes-r3.css'
import './pos-ajustes-r4.css'
import './pos-select-skin.css'
import './pos-resumen-carrito.css'
import './pos-impresion.css'
import './pos-mascara-nombres.css'
import './pos-detalle-pedido.css'
import './pos-borrador.css'
import './styles/pos-modo-traslado.css'
import './styles/pos-traslados-bandeja.css'
import './styles/pos-saldo-hermes.css'
import './styles/pos-saldo-deudor.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PosPage />
  </StrictMode>,
)
