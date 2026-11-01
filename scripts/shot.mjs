#!/usr/bin/env node
/**
 * Screenshot helper for visual checks (uses the preinstalled Playwright + Chromium).
 *
 *   node scripts/shot.mjs --port 5201 --out /tmp/shots /chat /code
 *   node scripts/shot.mjs --port 5201 --width 390 --height 844 --theme light --out /tmp/shots /
 *
 * Options: --port (dev server port, required), --out (dir), --width, --height,
 *          --theme dark|light, --wait ms (extra settle time), --full (full page)
 * Prints any console errors / page errors per route. Exit code 1 if any occurred.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return def
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}
const port = opt('port')
const out = opt('out', '/tmp/shots')
const width = Number(opt('width', 1440))
const height = Number(opt('height', 900))
const theme = opt('theme', 'dark')
const wait = Number(opt('wait', 600))
const full = flag('full')
const routes = args.length ? args : ['/']
if (!port) {
  console.error('--port is required')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme === 'light' ? 'light' : 'dark', deviceScaleFactor: 1 })
await context.addInitScript((t) => {
  try {
    const raw = localStorage.getItem('atrium.settings')
    const s = raw ? JSON.parse(raw) : { state: { settings: {} }, version: 1 }
    s.state = s.state || {}
    s.state.settings = s.state.settings || {}
    s.state.settings.appearance = { ...(s.state.settings.appearance || {}), theme: t }
    localStorage.setItem('atrium.settings', JSON.stringify(s))
  } catch {}
}, theme)
let failed = false
for (const route of routes) {
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.goto(`http://localhost:${port}${route}`, { waitUntil: 'networkidle' }).catch((e) => errors.push(`goto: ${e.message}`))
  await page.waitForTimeout(wait)
  const name = (route === '/' ? 'home' : route.replace(/^\//, '').replace(/[/?=&]+/g, '_')) + `-${width}x${height}-${theme}.png`
  const file = join(out, name)
  await page.screenshot({ path: file, fullPage: full })
  console.log(`${file}${errors.length ? `\n  ERRORS:\n  - ${errors.join('\n  - ')}` : ''}`)
  if (errors.length) failed = true
  await page.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
