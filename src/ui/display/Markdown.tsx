import {
  Children,
  isValidElement,
  useMemo,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useInRouterContext } from 'react-router'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CodeBlock, InlineCode } from './CodeBlock'
import { Caret, Tip } from './internal'

export interface Citation {
  index: number
  title: string
  href?: string
  onClick?: () => void
}

/** Private-use sentinel appended while streaming; replaced by the caret wherever it lands. */
const CARET = ''
const REMARK_PLUGINS = [remarkGfm]

/* ------------------------------------------------------------------------------------------ */
/* Citation marker                                                                            */
/* ------------------------------------------------------------------------------------------ */

function hostOf(href?: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, 'https://x.invalid').host.replace(/^www\./, '').replace('x.invalid', '') || undefined
  } catch {
    return undefined
  }
}

export interface CitationMarkerProps {
  citation: Citation
  className?: string
}

/** Superscript source marker: hover/focus shows the title; click opens the source. */
export function CitationMarker({ citation, className }: CitationMarkerProps) {
  const host = hostOf(citation.href)
  const label = `Source ${citation.index}: ${citation.title}`
  const cls = cn(
    'inline-flex h-[1.45em] min-w-[1.45em] items-center justify-center rounded-xs bg-accent-tint px-[0.3em] font-mono text-[0.7em] leading-none font-medium text-accent-ink tabular not-italic no-underline',
    'transition-[background-color,color] duration-(--dur-1) hover:bg-accent hover:text-inverse-ink',
    className,
  )
  const tip = (
    <span className="flex flex-col gap-0.5 py-0.5">
      <span className="font-medium text-pretty">{citation.title}</span>
      {host && <span className="font-mono text-2xs opacity-70">{host}</span>}
    </span>
  )
  const inner =
    citation.href && !citation.onClick ? (
      <a href={citation.href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cls}>
        {citation.index}
      </a>
    ) : (
      <button type="button" aria-label={label} onClick={citation.onClick} className={cls}>
        {citation.index}
      </button>
    )
  return (
    <sup className="relative -top-[0.42em] mx-[0.1em] align-baseline leading-none">
      <Tip content={tip} delay={120}>
        {inner}
      </Tip>
    </sup>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Text enhancement: citations + caret                                                        */
/* ------------------------------------------------------------------------------------------ */

const CITE_RE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g

function enhanceString(text: string, cites: Map<number, Citation> | null, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const pushText = (t: string, k: string) => {
    if (!t) return
    const parts = t.split(CARET)
    parts.forEach((p, i) => {
      if (p) out.push(p)
      if (i < parts.length - 1) out.push(<Caret key={`${k}c${i}`} />)
    })
  }
  if (!cites || cites.size === 0) {
    pushText(text, keyBase)
    return out
  }
  let last = 0
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  while ((m = CITE_RE.exec(text))) {
    const nums = m[1].split(',').map((s) => Number(s.trim()))
    if (!nums.every((n) => cites.has(n))) continue
    pushText(text.slice(last, m.index), `${keyBase}t${m.index}`)
    nums.forEach((n, i) => out.push(<CitationMarker key={`${keyBase}m${m!.index}-${i}`} citation={cites.get(n)!} />))
    last = m.index + m[0].length
  }
  pushText(text.slice(last), `${keyBase}e`)
  return out
}

function enhance(children: ReactNode, cites: Map<number, Citation> | null): ReactNode {
  let i = 0
  return Children.map(children, (child) => {
    i++
    if (typeof child === 'string') {
      if (!child.includes(CARET) && !(cites && child.includes('['))) return child
      return enhanceString(child, cites, `x${i}`)
    }
    return child
  })
}

function stripCaret(s: string): string {
  return s.includes(CARET) ? s.split(CARET).join('') : s
}

/* ------------------------------------------------------------------------------------------ */
/* Markdown                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface MarkdownProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Markdown source (GFM). Raw HTML is never rendered. */
  children: string
  /** `doc`: serif document typography with a ~68ch measure. `ui`: interface sans. */
  prose?: 'doc' | 'ui'
  /** Turns `[n]` markers in the text into citation buttons. */
  citations?: readonly Citation[]
  /** Shows a blinking caret after the last character (no layout jump). */
  streaming?: boolean
  /** Collapse code fences taller than this (px). */
  codeMaxHeight?: number
}

type Voice = 'doc' | 'ui'

function SmartLink({ href = '', children, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const inRouter = useInRouterContext()
  const cls = cn(
    'text-accent-ink underline decoration-accent/40 decoration-1 underline-offset-[0.2em] transition-colors duration-(--dur-1) hover:decoration-accent',
    className,
  )
  const clean = stripCaret(href)
  if (clean.startsWith('/') && !clean.startsWith('//') && inRouter) {
    return (
      <Link to={clean} className={cls}>
        {children}
      </Link>
    )
  }
  const external = /^(https?:)?\/\//i.test(clean) || clean.startsWith('mailto:')
  return (
    <a
      href={clean}
      className={cls}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      {children}
    </a>
  )
}

function buildComponents(voice: Voice, cites: Map<number, Citation> | null, codeMaxHeight: number): Components {
  const doc = voice === 'doc'
  const E = (c: ReactNode) => enhance(c, cites)
  return {
    p: ({ node: _n, children, ...p }) => (
      <p className={cn('my-[0.85em] text-pretty', doc && 'my-[1em]')} {...p}>
        {E(children)}
      </p>
    ),
    h1: ({ node: _n, children, ...p }) => (
      <h1
        className={cn(
          'mt-[1.4em] mb-[0.5em] text-balance text-ink',
          doc ? 'font-serif text-3xl font-normal tracking-[-0.015em] sm:text-4xl' : 'font-sans text-xl font-semibold tracking-[-0.01em]',
        )}
        {...p}
      >
        {E(children)}
      </h1>
    ),
    h2: ({ node: _n, children, ...p }) => (
      <h2
        className={cn(
          'mt-[1.5em] mb-[0.45em] text-balance text-ink',
          doc ? 'font-serif text-2xl font-normal tracking-[-0.01em]' : 'font-sans text-lg font-semibold',
        )}
        {...p}
      >
        {E(children)}
      </h2>
    ),
    h3: ({ node: _n, children, ...p }) => (
      <h3 className={cn('mt-[1.4em] mb-[0.35em] text-ink', doc ? 'font-serif text-xl font-medium' : 'font-sans text-md font-semibold')} {...p}>
        {E(children)}
      </h3>
    ),
    h4: ({ node: _n, children, ...p }) => (
      <h4 className={cn('mt-[1.3em] mb-[0.3em] font-sans font-semibold text-ink', doc ? 'text-md' : 'text-base')} {...p}>
        {E(children)}
      </h4>
    ),
    h5: ({ node: _n, children, ...p }) => (
      <h5 className="mt-[1.2em] mb-[0.3em] font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase" {...p}>
        {E(children)}
      </h5>
    ),
    h6: ({ node: _n, children, ...p }) => (
      <h6 className="mt-[1.2em] mb-[0.3em] font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase" {...p}>
        {E(children)}
      </h6>
    ),
    ul: ({ node: _n, className, children, ...p }) => {
      const tasks = className?.includes('contains-task-list')
      return (
        <ul className={cn('my-[0.85em]', tasks ? 'list-none pl-0' : 'list-disc pl-[1.35em] marker:text-ink-4')} {...p}>
          {children}
        </ul>
      )
    },
    ol: ({ node: _n, children, ...p }) => (
      <ol className="my-[0.85em] list-decimal pl-[1.6em] marker:font-mono marker:text-[0.85em] marker:text-ink-3" {...p}>
        {children}
      </ol>
    ),
    li: ({ node: _n, className, children, ...p }) => {
      if (className?.includes('task-list-item')) {
        const arr = Children.toArray(children)
        const boxAt = arr.findIndex((c) => isValidElement(c) && (c.props as { type?: string }).type === 'checkbox')
        if (boxAt !== -1) {
          const rest = arr.filter((_, i) => i !== boxAt)
          return (
            <li className="my-[0.3em] flex items-start gap-[0.55em]" {...p}>
              <span className="flex h-[1lh] shrink-0 items-center">{arr[boxAt]}</span>
              <span className="min-w-0 flex-1 [&>p]:my-0">{E(rest)}</span>
            </li>
          )
        }
      }
      return (
        <li className="my-[0.3em] pl-[0.2em] [&>p]:my-[0.4em]" {...p}>
          {E(children)}
        </li>
      )
    },
    input: ({ node: _n, type, checked }) =>
      type === 'checkbox' ? (
        <span className="relative mr-[0.1em] inline-flex size-[0.95em] shrink-0 items-center justify-center align-[-0.12em]">
          <input
            type="checkbox"
            checked={!!checked}
            disabled
            readOnly
            aria-label={checked ? 'Done' : 'Not done'}
            className="peer size-full appearance-none rounded-xs border border-line-strong bg-raised checked:border-done checked:bg-done disabled:cursor-default"
          />
          <Check aria-hidden strokeWidth={3.25} className="pointer-events-none absolute size-[0.68em] text-canvas opacity-0 peer-checked:opacity-100" />
        </span>
      ) : null,
    blockquote: ({ node: _n, children, ...p }) => (
      <blockquote className={cn('my-[1.1em] border-l-2 border-line-strong pl-[1em] text-ink-2', doc && 'italic')} {...p}>
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-[2em] border-0 border-t border-line" />,
    a: ({ node: _n, children, href, ...p }) => (
      <SmartLink href={href} {...p}>
        {E(children)}
      </SmartLink>
    ),
    strong: ({ node: _n, children, ...p }) => (
      <strong className="font-semibold text-ink" {...p}>
        {E(children)}
      </strong>
    ),
    em: ({ node: _n, children, ...p }) => (
      <em className="italic" {...p}>
        {E(children)}
      </em>
    ),
    del: ({ node: _n, children, ...p }) => (
      <del className="text-ink-3 decoration-ink-4" {...p}>
        {E(children)}
      </del>
    ),
    code: ({ node: _n, children, className: _c, ...p }) => {
      const text = typeof children === 'string' ? children : String(children ?? '')
      if (text.includes(CARET)) {
        return (
          <>
            <InlineCode {...p}>{stripCaret(text)}</InlineCode>
            <Caret />
          </>
        )
      }
      return <InlineCode {...p}>{children}</InlineCode>
    },
    pre: ({ node: _n, children }) => {
      const child = Children.toArray(children)[0]
      const el = isValidElement(child) ? (child as ReactElement<{ className?: string; children?: ReactNode }>) : null
      const lang = /language-([\w+#.-]+)/.exec(el?.props.className ?? '')?.[1]
      const raw = String(el?.props.children ?? '').replace(/\n$/, '')
      const streamingHere = raw.includes(CARET)
      return (
        <CodeBlock
          code={stripCaret(raw)}
          language={lang}
          streaming={streamingHere}
          maxHeight={codeMaxHeight}
          className={cn('my-[1.1em] text-ink', doc && 'not-italic')}
        />
      )
    },
    table: ({ node: _n, children, ...p }) => (
      <div className="my-[1.25em] overflow-x-auto" role="region" aria-label="Table" tabIndex={0}>
        <table className="w-full border-collapse font-sans text-sm tabular" {...p}>
          {children}
        </table>
      </div>
    ),
    thead: ({ node: _n, children, ...p }) => <thead {...p}>{children}</thead>,
    th: ({ node: _n, children, style, ...p }) => (
      <th
        className="border-b border-line-strong py-2 pr-4 text-left align-bottom font-mono text-2xs font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase"
        style={style}
        {...p}
      >
        {E(children)}
      </th>
    ),
    td: ({ node: _n, children, style, ...p }) => (
      <td className="border-b border-line py-2 pr-4 align-top text-ink-2" style={style} {...p}>
        {E(children)}
      </td>
    ),
    img: ({ node: _n, src, alt }) => (
      <span className="my-[1.25em] block">
        <img src={typeof src === 'string' ? stripCaret(src) : undefined} alt={stripCaret(alt ?? '')} loading="lazy" className="block max-w-full rounded-md border border-line" />
        {alt && <span className="mt-2 block font-sans text-xs text-ink-3">{stripCaret(alt)}</span>}
      </span>
    ),
    section: ({ node: _n, className, children, ...p }) => (
      <section className={cn(className?.includes('footnotes') && 'mt-[2em] border-t border-line pt-[1em] text-sm text-ink-3', className)} {...p}>
        {children}
      </section>
    ),
  }
}

/**
 * Markdown for AI prose and documents: GFM tables, task lists, code fences (CodeBlock),
 * router-aware links, citation markers and a streaming caret. Never renders raw HTML.
 */
export function Markdown({ children, prose = 'ui', citations, streaming = false, codeMaxHeight = 520, className, ...props }: MarkdownProps) {
  const cites = useMemo(() => (citations?.length ? new Map(citations.map((c) => [c.index, c])) : null), [citations])
  const components = useMemo(() => buildComponents(prose, cites, codeMaxHeight), [prose, cites, codeMaxHeight])
  const source = streaming ? `${children}${CARET}` : children
  return (
    <div
      data-streaming={streaming || undefined}
      className={cn(
        'atr-md min-w-0 text-ink [overflow-wrap:break-word]',
        prose === 'doc' ? 'max-w-[68ch] font-serif text-md sm:text-lg sm:leading-7' : 'font-sans text-base leading-6',
        className,
      )}
      {...props}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  )
}
