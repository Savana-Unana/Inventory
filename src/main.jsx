import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './Top.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
