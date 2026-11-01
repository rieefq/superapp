import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Download, Eraser, FileJson, RotateCcw, Upload } from 'lucide-react'
import { runExport, runResetDemo } from '@/app/shell/UserMenu'
import { persistEvents, useDB, type TableName } from '@/core/db'
import { Button, Checkbox, Dialog, ErrorState, toast } from '@/ui'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import { runErase } from '../actions'
import { applyImport, checkImport, storageReport, TABLE_LABEL, type ImportPayload, type ImportSummary, type StorageReport } from '../data'
import { Group, Row, SectionBody, useMarkSaved } from '../parts'
import { getSection } from '../sections'

/** Data (§6.12): storage by table, Export JSON, Import JSON, Reset demo world, Erase everything. */
export default function DataSection() {
  return (
    <SectionBody lead={getSection('data')!.lead}>
      <Storage />
      <ExportImport />
      <StartOver />
    </SectionBody>
  )
}

// ------------------------------------------------------------------------------------------------ storage

/**
 * Measure what this browser stores, again shortly after the database changes (persistence writes
 * are debounced), and report tables the browser refused to save.
 */
function useStorage(): { report: StorageReport; failed: TableName[] } {
  const [report, setReport] = useState(() => storageReport(useDB.getState()))
  const [failed, setFailed] = useState<TableName[]>([])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => setReport(storageReport(useDB.getState()))
    // Throttled: measure once persistence has written (it debounces by 400ms), at most every 1.2s.
    const later = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        measure()
      }, 1200)
    }
    const unsub = useDB.subscribe(later)
    const offError = persistEvents.on('error', ({ table }) => setFailed((f) => (f.includes(table) ? f : [...f, table])))
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith('atrium.')) later()
    }
    window.addEventListener('storage', onStorage)
    // Settings, scope and layout live outside the database; re-measure them every few seconds.
    const interval = setInterval(measure, 5000)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      unsub()
      offError()
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return { report, failed }
}

const TABLES_SHOWN = 8

function Storage() {
  const { report, failed } = useStorage()
  const [all, setAll] = useState(false)
  const used = report.tables.filter((t) => t.rows > 0)
  const empty = report.tables.length - used.length
  const shown = all ? used : used.slice(0, TABLES_SHOWN)
  const max = Math.max(1, ...report.tables.map((t) => t.bytes))

  return (
    <Group
      label="Storage"
      id="storage"
      aside={<span className="type-meta text-ink-3">this browser · local storage</span>}
      footnote="Nothing is synced or uploaded. Clearing this site’s data in your browser erases it too."
    >
      <Row className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
        <div className="flex items-baseline gap-2">
          <span className="type-figure text-ink">{formatBytes(report.totalBytes)}</span>
          <span className="type-meta text-ink-3">{formatNumber(report.totalRows)} items</span>
        </div>
        <span className="type-meta text-ink-3">
          {used.length} of {report.tables.length} tables in use
        </span>
      </Row>
      {failed.length > 0 && (
        <Row>
          <ErrorState
            compact
            title="This browser is out of room"
            message={`Couldn’t save ${failed.map((t) => TABLE_LABEL[t]).join(', ')}. Recent changes there are lost on reload. Export your data, then erase or reset to free space.`}
            actions={
              <Button size="sm" variant="secondary" leadingIcon={Download} onClick={() => runExport()}>
                Export JSON
              </Button>
            }
          />
        </Row>
      )}
      {used.length === 0 ? (
        <Row>
          <p className="text-sm text-ink-3">The database is empty. Reset the demo world below to bring Northwind Labs back.</p>
        </Row>
      ) : (
        <Row className="py-2">
          <table className="w-full border-collapse">
            <caption className="sr-only">Storage used by each table</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Items</th>
                <th scope="col">Share</th>
                <th scope="col">Size</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.key} className="h-8">
                  <th scope="row" className="type-body-sm w-[38%] truncate pr-3 text-left font-normal text-ink-2">
                    {t.label}
                  </th>
                  <td className="type-meta w-16 pr-3 text-right text-ink-3">{formatNumber(t.rows ?? 0)}</td>
                  <td className="pr-3" aria-hidden>
                    <div className="h-1 w-full overflow-hidden rounded-[1px] bg-line">
                      <div className="h-full bg-ink-2 transition-[width] duration-(--dur-3) ease-standard" style={{ width: `${Math.max(t.bytes > 0 ? 1.5 : 0, (t.bytes / max) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="type-meta w-20 text-right text-ink-2">{formatBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(used.length > TABLES_SHOWN || empty > 0) && (
            <div className="flex items-center justify-between gap-3 pt-1.5">
              {used.length > TABLES_SHOWN ? (
                <button
                  type="button"
                  aria-expanded={all}
                  onClick={() => setAll((a) => !a)}
                  className="type-caption -ml-1.5 rounded-sm px-1.5 py-1 font-medium text-ink-3 hover:bg-hover hover:text-ink"
                >
                  {all ? 'Show fewer tables' : `Show ${used.length - TABLES_SHOWN} more tables`}
                </button>
              ) : (
                <span />
              )}
              {empty > 0 && <span className="type-meta text-ink-3">{empty} empty</span>}
            </div>
          )}
        </Row>
      )}
      <Row className="py-2">
        <ul className="flex flex-col" aria-label="Stored outside the database">
          {report.other.map((o) => (
            <li key={o.key} className="flex h-8 items-center justify-between gap-3">
              <span className="type-body-sm truncate text-ink-2">{o.label}</span>
              <span className="type-meta shrink-0 text-ink-3">
                {o.key === 'atrium.secrets' ? (o.rows ? `${o.rows} ${o.rows === 1 ? 'key' : 'keys'} · ${formatBytes(o.bytes)}` : 'None') : formatBytes(o.bytes)}
              </span>
            </li>
          ))}
        </ul>
      </Row>
    </Group>
  )
}

// ------------------------------------------------------------------------------------------------ export & import

type ImportState =
  | { status: 'idle' }
  | { status: 'reading'; fileName: string }
  | { status: 'error'; fileName: string; error: string; detail?: string }
  | { status: 'review'; payload: ImportPayload; summary: ImportSummary }

function ExportImport() {
  const mark = useMarkSaved()
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<ImportState>({ status: 'idle' })

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setState({ status: 'reading', fileName: file.name })
    try {
      const text = await file.text()
      const result = checkImport(text, file.name, file.size)
      setState(result.ok ? { status: 'review', payload: result.payload, summary: result.summary } : { status: 'error', fileName: file.name, error: result.error, detail: result.detail })
    } catch (err) {
      setState({ status: 'error', fileName: file.name, error: 'This file couldn’t be read.', detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const doImport = (withSettings: boolean) => {
    if (state.status !== 'review') return
    const { payload, summary } = state
    try {
      const result = applyImport(payload, { withSettings })
      setState({ status: 'idle' })
      mark('import', 'Import')
      if (result.unsaved.length) {
        toast.error('Imported, but not all of it was saved', {
          description: `This browser had no room for ${result.unsaved.map((t) => TABLE_LABEL[t]).join(', ')}. It is here until you reload.`,
          duration: 10_000,
        })
      } else {
        toast.success(`Imported “${summary.fileName}”`, {
          description: `${formatNumber(summary.total)} items${withSettings ? ' and its settings' : ''} replaced what was here.`,
        })
      }
    } catch (err) {
      toast.error('Couldn’t import the file', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Group label="Export and import">
      <ActionRow
        id="export"
        label="Export JSON"
        hint="Downloads a real file: every table, your settings, scope and held items. API keys are never included."
        action={
          <Button leadingIcon={Download} onClick={() => runExport()}>
            Export JSON
          </Button>
        }
      />
      <ActionRow
        id="import"
        label="Import JSON"
        hint="Replace what is in this browser with an Atrium export. You see what is in the file before anything changes."
        action={
          <>
            <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden onChange={onFile} data-testid="import-file" />
            <Button leadingIcon={Upload} loading={state.status === 'reading'} onClick={() => fileRef.current?.click()}>
              Import JSON…
            </Button>
          </>
        }
      >
        {state.status === 'error' && (
          <ErrorState
            compact
            className="mt-3"
            title={`Couldn’t import “${state.fileName}”`}
            message={state.error}
            details={state.detail}
            actions={
              <>
                <Button size="sm" variant="secondary" leadingIcon={FileJson} onClick={() => fileRef.current?.click()}>
                  Choose another file
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setState({ status: 'idle' })}>
                  Dismiss
                </Button>
              </>
            }
          />
        )}
      </ActionRow>
      <ImportDialog
        state={state.status === 'review' ? state : null}
        onCancel={() => setState({ status: 'idle' })}
        onConfirm={doImport}
      />
    </Group>
  )
}

function ActionRow({ id, label, hint, action, children }: { id: string; label: string; hint: string; action: ReactNode; children?: ReactNode }) {
  return (
    <Row id={id}>
      <div className="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5 pt-1">
          <span className="text-sm font-medium text-ink">{label}</span>
          <p className="text-xs text-ink-3 text-pretty">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>
      {children}
    </Row>
  )
}

function ImportDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: { payload: ImportPayload; summary: ImportSummary } | null
  onCancel: () => void
  onConfirm: (withSettings: boolean) => void
}) {
  const [withSettings, setWithSettings] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Keep the last summary on screen while the dialog animates out.
  const [shown, setShown] = useState(state)
  useEffect(() => {
    if (state) {
      setShown(state)
      setWithSettings(false)
    }
  }, [state])
  const s = (state ?? shown)?.summary
  const hasSettings = !!(state ?? shown)?.payload.settings
  const rows = s ? (Object.entries(s.counts) as [TableName, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
  const exported = s?.exportedAt ? Date.parse(s.exportedAt) : NaN

  return (
    <Dialog
      open={!!state}
      onOpenChange={(open) => !open && onCancel()}
      role="alertdialog"
      size="md"
      initialFocus={cancelRef}
      title={s ? `Replace your data with “${s.fileName}”?` : 'Import'}
      description="Everything in this browser is replaced by the file’s contents. What is here now can’t be recovered unless you export it first."
      footer={
        <>
          <Button variant="ghost" leadingIcon={Download} onClick={() => runExport()} className="mr-auto max-sm:hidden">
            Export current data first
          </Button>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger-solid" onClick={() => onConfirm(withSettings)}>
            Replace my data
          </Button>
        </>
      }
    >
      {s && (
        <div className="flex flex-col gap-4 pb-1">
          <p className="type-meta text-ink-3">
            {Number.isFinite(exported) ? `Exported ${formatDateTime(exported)} · ` : ''}
            {formatBytes(s.bytes)} · {formatNumber(s.total)} items
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-2">This export is empty. Importing it leaves Atrium with no data.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-x-6 rounded-md border border-line px-3 py-1.5 sm:grid-cols-2" aria-label="What the file contains">
              {rows.map(([t, n]) => (
                <li key={t} className="flex h-7 items-center justify-between gap-3">
                  <span className="type-body-sm truncate text-ink-2">{TABLE_LABEL[t]}</span>
                  <span className="type-meta text-ink-3">{formatNumber(n)}</span>
                </li>
              ))}
            </ul>
          )}
          {(s.missingTables.length > 0 || s.ignoredTables.length > 0) && (
            <p className={cn('text-xs text-ink-3 text-pretty')}>
              {s.missingTables.length > 0 && `Not in the file, so they will be empty: ${s.missingTables.map((t) => TABLE_LABEL[t]).join(', ')}. `}
              {s.ignoredTables.length > 0 && `Ignored, unknown to this build: ${s.ignoredTables.join(', ')}.`}
            </p>
          )}
          {hasSettings && (
            <Checkbox
              checked={withSettings}
              onCheckedChange={setWithSettings}
              label="Also use the settings in this file"
              description="Theme, models, safety and budget. Your API keys stay as they are; exports never contain them."
            />
          )}
        </div>
      )}
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------------ start over

function StartOver() {
  const navigate = useNavigate()
  return (
    <Group label="Start over" footnote="Both ask you to type a word first, so neither happens by accident.">
      <ActionRow
        id="reset"
        label="Reset demo world"
        hint="Replaces everything with a fresh copy of Northwind Labs. Your settings and API keys are kept. Type “reset” to confirm."
        action={
          <Button variant="secondary" leadingIcon={RotateCcw} onClick={() => void runResetDemo(navigate)}>
            Reset demo world…
          </Button>
        }
      />
      <ActionRow
        id="erase"
        label="Erase everything"
        hint="Deletes all data, settings and API keys from this browser and leaves Atrium empty. Type “erase” to confirm."
        action={
          <Button variant="danger" leadingIcon={Eraser} onClick={() => void runErase(navigate)}>
            Erase everything…
          </Button>
        }
      />
    </Group>
  )
}
