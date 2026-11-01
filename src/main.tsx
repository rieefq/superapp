import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from '@/app/App'
import { boot } from '@/app/boot'

const root = document.getElementById('root')!

void boot()
  .catch((err: unknown) => {
    // Boot failures (corrupt storage, quota) must not leave a blank page: the app still renders and
    // its error boundaries explain what happened.
    console.error('[boot] failed', err)
  })
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
