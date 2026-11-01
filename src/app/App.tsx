import { RouterProvider } from 'react-router'
import { ConfirmHost, ThemeProvider, ToastHost } from '@/ui'
import { router } from './routes'

/**
 * App root: the theme (data-theme, density, motion), the toast and confirm hosts (mounted once), and
 * the router — whose root route mounts the global shell around every workspace.
 */
export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <ToastHost />
      <ConfirmHost />
    </ThemeProvider>
  )
}
