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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PosPage />
  </StrictMode>,
)
