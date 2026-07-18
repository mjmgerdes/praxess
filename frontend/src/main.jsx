import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import WorkspaceApp from './WorkspaceApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorkspaceApp />
  </StrictMode>,
)
