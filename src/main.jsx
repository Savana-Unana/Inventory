// Tools that start the React app
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The main app screen
import App from './Top.jsx'

// Put the app onto the page
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
