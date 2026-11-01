import { useEffect, useState } from 'react'
import Primitives from './sections/primitives'
import Display from './sections/display'
import Signature from './sections/signature'

/** Living component gallery at /dev/ui — every component, every state, both themes. */
export default function Gallery() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') ?? 'dark',
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-chrome/90 px-6 py-3 backdrop-blur">
        <h1 className="font-serif text-xl">Atrium UI</h1>
        <button
          type="button"
          className="rounded-sm border border-line px-3 py-1 text-sm text-ink-2 hover:bg-hover"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          Theme: {theme}
        </button>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-10">
        <Primitives />
        <Display />
        <Signature />
      </main>
    </div>
  )
}
