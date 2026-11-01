import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { getSecret, maskSecret, useSecretsStore } from '@/core/secrets'
import { connect, diagnoseConnection, validateConnectionValues, type IntegrationStatus } from '@/core/services/integrations'
import type { IntegrationConnection, IntegrationDef } from '@/core/types'
import { Button, Field, IconButton, Input, toast } from '@/ui'
import { connectedToast, fieldHint, keyWarning, submitLabel } from './copy'

type FieldDef = NonNullable<IntegrationDef['fields']>[number]

function initialValues(fields: FieldDef[], connection: IntegrationConnection | undefined): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : (connection?.config[f.key] ?? '')]))
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)

function SecretSuffix({ shown, onToggle, label }: { shown: boolean; onToggle: () => void; label: string }) {
  return (
    <IconButton
      icon={shown ? EyeOff : Eye}
      label={shown ? `Hide the ${lowerFirst(label)}` : `Show the ${lowerFirst(label)}`}
      size="xs"
      onClick={onToggle}
      className="-mr-1.5"
    />
  )
}

/**
 * The connect form (§6.11): fields from the catalog, secrets masked (with show/hide), stored secrets
 * shown only as `sk-ant…abcd`, the "stored only in this browser" warning, and validation before
 * anything is saved or sent (Anthropic keys start with sk-ant-, URLs must be URLs). Saving a model
 * provider makes its models available in every model picker at once.
 */
export function ConnectForm({ def, connection, status, onFocusRequest, onSaved, onCancel }: {
  def: IntegrationDef
  connection: IntegrationConnection | undefined
  status: IntegrationStatus
  /** Registers a function that focuses the first field (the header's Connect button uses it). */
  onFocusRequest?: (focus: () => void) => void
  /** Called after a successful save. */
  onSaved?: () => void
  /** Shows a Cancel button (editing a connected integration). */
  onCancel?: () => void
}) {
  const fields = useMemo(() => def.fields ?? [], [def])
  const formId = useId()
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields, connection))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const firstRef = useRef<HTMLInputElement>(null)
  // Re-render when a secret is saved or forgotten (values are never displayed, only masked).
  const vault = useSecretsStore((s) => s.secrets[def.id])
  const connected = status === 'connected' || status === 'error'

  // Config saved elsewhere (or a reconnect) refreshes the non-secret fields.
  const configKey = JSON.stringify(connection?.config ?? {})
  useEffect(() => {
    setValues((cur) => {
      const next = { ...cur }
      for (const f of fields) if (!f.secret) next[f.key] = connection?.config[f.key] ?? ''
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey])

  // Unfolded on a connected integration: start in the first field.
  useEffect(() => {
    if (onCancel) firstRef.current?.focus()
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onFocusRequest?.(() => {
      firstRef.current?.focus()
      firstRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [onFocusRequest])

  const dirty = fields.some((f) => (f.secret ? !!values[f.key]?.trim() : (values[f.key] ?? '') !== (connection?.config[f.key] ?? '')))

  const validate = (next: Record<string, string>) => {
    const issues = validateConnectionValues(def.id, next)
    setErrors(Object.fromEntries(issues.map((i) => [i.key, i.message])))
    return issues
  }

  const onChange = (key: string, value: string) => {
    const next = { ...values, [key]: value }
    setValues(next)
    setFormError(null)
    if (attempted) validate(next)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    const issues = validate(values)
    if (issues.length) {
      document.getElementById(`${formId}-${issues[0].key}`)?.focus()
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const conn = await connect(def.id, values)
      // Secrets never stay in the form once saved.
      setValues((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, fields.find((f) => f.key === k)?.secret ? '' : v])))
      setAttempted(false)
      if (conn.status === 'connected') {
        onSaved?.()
        const t = connectedToast(def, conn)
        toast.success(t.title, {
          description: t.description,
          action: def.support === 'live' ? { label: 'Test connection', onClick: () => void diagnoseConnection(def.id) } : undefined,
        })
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const warning = keyWarning(def, values.baseUrl || connection?.config.baseUrl)
  const hasSecrets = fields.some((f) => f.secret)

  return (
    <form id={formId} noValidate onSubmit={submit} aria-label={`Connect ${def.name}`} className="flex flex-col gap-4">
      {fields.map((f, i) => {
        const stored = f.secret && vault?.[f.key] ? getSecret(def.id, f.key) : undefined
        const isShown = !!shown[f.key]
        const hint = stored ? `Stored in this browser · ${maskSecret(stored)}. Leave empty to keep it.` : fieldHint(def, f)
        return (
          <Field key={f.key} id={`${formId}-${f.key}`} label={f.label} optional={f.optional} hint={hint} error={errors[f.key]}>
            <Input
              ref={i === 0 ? firstRef : undefined}
              name={f.key}
              type={f.secret ? (isShown ? 'text' : 'password') : f.type === 'url' ? 'url' : 'text'}
              value={values[f.key] ?? ''}
              onValueChange={(v) => onChange(f.key, v)}
              onBlur={() => attempted && validate(values)}
              placeholder={stored ? `Paste a new ${lowerFirst(f.label)} to replace it` : f.placeholder}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="font-mono"
              suffix={f.secret ? <SecretSuffix shown={isShown} onToggle={() => setShown((s) => ({ ...s, [f.key]: !isShown }))} label={f.label} /> : undefined}
            />
          </Field>
        )
      })}

      {hasSecrets && warning && (
        <p className="type-caption flex items-start gap-2 rounded-sm border border-line bg-sunken px-3 py-2.5 text-ink-2">
          <KeyRound aria-hidden className="mt-px size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="text-pretty">{warning}</span>
        </p>
      )}

      {formError && (
        <p role="alert" className="type-caption rounded-sm border border-fail/40 bg-fail-tint/40 px-3 py-2 text-fail-ink">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy || status === 'connecting'} disabled={connected && !dirty}>
          {submitLabel(def, connected)}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
