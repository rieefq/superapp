/**
 * Gallery — track A1 primitives: every component, variant, size and state, with live interactive demos.
 * Rendered at /dev/ui.
 */
import { useRef, useState, type ReactNode } from 'react'
import {
  Activity, Archive, ArrowRight, ArrowUpRight, AtSign, Bell, Bold, BookOpen, Bot, Calendar, Check, Clock, Code, Columns2,
  Copy, Download, Ellipsis, ExternalLink, Eye, File, FileText, Filter, Folder, FolderKanban, GitBranch, Globe, Hash,
  Heading2, Image, Inbox, Italic, Keyboard, Layers, LayoutGrid, Link, List, ListOrdered, Lock, Mail, MessagesSquare, Monitor,
  Moon, PanelLeft, PanelRight, Pause, Pencil, Pin, Play, Plus, Quote, RotateCcw, Rows3, Search, Send, Settings2, Share2,
  Sparkles, SquareTerminal, Star, Sun, Telescope, Trash2, Users, WandSparkles, Workflow, Zap,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  Avatar, AvatarGroup, Badge, Breadcrumbs, Button, ButtonLink, Card, Checkbox, ConfirmHost, ContextMenu, Dialog, Divider,
  DynamicIcon, EmptyState, ErrorState, Field, HoverCard, ICONS, IconButton, Input, Kbd, KbdCombo, Kicker, ListItem, Menu,
  NavItem, PageHeader, Panel, Popover, ProgressBar, RadioGroup, ScrollArea, SearchField, SectionHeader, SegmentedControl,
  Select, Sheet, Skeleton, Slider, Spinner, SplitPane, Surface, Switch, TabPanel, Tabs, Tag, Textarea, ThemeProvider,
  ToastHost, Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer, Tooltip, VisuallyHidden, confirm, toast, useTheme,
  type BadgeTone, type ButtonSize, type ButtonVariant, type MenuItem, type SelectOption,
} from '@/ui/primitives'
import {
  useBreakpoint, useChord, useClickOutside, useCopy, useDebounced, useDisclosure, useHotkey, useIsTyping,
  useLocalStorageState, useMediaQuery, useReducedMotion,
} from '@/ui/hooks'

// ------------------------------------------------------------------------------------------------ scaffolding

const TOC = [
  ['actions', 'Actions'],
  ['forms', 'Forms'],
  ['choices', 'Choices'],
  ['navigation', 'Navigation'],
  ['menus', 'Menus'],
  ['floating', 'Popovers & tooltips'],
  ['dialogs', 'Dialogs & sheets'],
  ['feedback', 'Confirm & toast'],
  ['marks', 'Badges & marks'],
  ['loading', 'Loading'],
  ['layout', 'Layout'],
  ['states', 'Empty & error'],
  ['lists', 'Lists & icons'],
  ['panes', 'Panes & scroll'],
  ['hooks', 'Hooks & theme'],
] as const

function Block({ id, kicker, title, description, children }: { id: string; kicker: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={`a1-${id}`} aria-labelledby={`a1-${id}-title`} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1.5 border-b border-line pb-4">
        <Kicker>{kicker}</Kicker>
        <h3 id={`a1-${id}-title`} className="font-serif text-2xl leading-8 text-ink">
          {title}
        </h3>
        {description && <p className="max-w-2xl text-sm text-ink-3 text-pretty">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <div className={cn('grid gap-x-10 gap-y-9', cols === 2 && 'md:grid-cols-2', cols === 3 && 'md:grid-cols-2 lg:grid-cols-3')}>{children}</div>
  )
}

function Specimen({ label, children, className, wide, stack }: { label: string; children: ReactNode; className?: string; wide?: boolean; stack?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', wide && 'md:col-span-2 lg:col-span-full', className)}>
      <span className="font-mono text-2xs tracking-[0.08em] text-ink-4 uppercase">{label}</span>
      <div className={cn(stack ? 'flex flex-col gap-3' : 'flex flex-wrap items-center gap-2')}>{children}</div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ actions

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link']
const SIZES: ButtonSize[] = ['xs', 'sm', 'md', 'lg']

function ActionsBlock() {
  const [saving, setSaving] = useState(false)
  const [pinned, setPinned] = useState(true)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const save = () => {
    setSaving(true)
    setTimeout(() => setSaving(false), 1600)
  }
  return (
    <Block id="actions" kicker="Actions" title="Buttons" description="Primary is ink-inverted. Secondary is a raised key with a strong hairline. Color is reserved for meaning: danger is fail-colored text; the solid fail button only appears on confirm steps.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr>
              <th className="pb-3 font-mono text-2xs font-normal tracking-[0.08em] text-ink-4 uppercase">Variant</th>
              {SIZES.map((s) => (
                <th key={s} className="pb-3 font-mono text-2xs font-normal tracking-[0.08em] text-ink-4 uppercase">
                  {s} · {{ xs: 24, sm: 28, md: 32, lg: 40 }[s]}px
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {VARIANTS.map((v) => (
              <tr key={v} className="border-t border-line">
                <td className="py-3 pr-4 font-mono text-xs text-ink-3">{v}</td>
                {SIZES.map((s) => (
                  <td key={s} className="py-3 pr-4">
                    <Button variant={v} size={s} leadingIcon={v === 'danger' ? Trash2 : v === 'link' ? undefined : Plus}>
                      {v === 'danger' ? 'Delete' : v === 'link' ? 'View details' : 'New task'}
                    </Button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Grid>
        <Specimen label="States">
          <Button variant="primary" loading={saving} onClick={save} kbd="mod+s">
            Save changes
          </Button>
          <Button variant="secondary" loading>
            Syncing
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" disabled leadingIcon={Lock}>
            Locked
          </Button>
        </Specimen>
        <Specimen label="Icons & hints">
          <Button variant="secondary" trailingIcon={ArrowRight}>
            Continue
          </Button>
          <Button variant="ghost" leadingIcon={Download}>
            Export
          </Button>
          <Button variant="secondary" leadingIcon={Search} kbd="mod+k">
            Search
          </Button>
          <ButtonLink to="/dev/ui" variant="outline" trailingIcon={ArrowUpRight}>
            ButtonLink
          </ButtonLink>
        </Specimen>
        <Specimen label="Confirm step only">
          <Button variant="danger-solid" leadingIcon={Trash2}>
            Delete project
          </Button>
          <Button variant="danger">Remove</Button>
        </Specimen>
        <Specimen label="Full width" stack>
          <Button variant="primary" fullWidth size="lg" trailingIcon={ArrowRight}>
            Start research run
          </Button>
        </Specimen>
        <Specimen label="Icon buttons · variants">
          <IconButton icon={Settings2} label="Settings" />
          <IconButton icon={Share2} label="Share" variant="secondary" />
          <IconButton icon={Filter} label="Filter" variant="outline" />
          <IconButton icon={Plus} label="New" variant="primary" shortcut="c" />
          <IconButton icon={Trash2} label="Delete" variant="danger" />
          <IconButton icon={RotateCcw} label="Retry" loading />
          <IconButton icon={Archive} label="Archive (disabled)" disabled />
        </Specimen>
        <Specimen label="Icon buttons · sizes & toggles">
          {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
            <IconButton key={s} icon={Star} label={`Star (${s})`} size={s} variant="secondary" />
          ))}
          <Divider orientation="vertical" className="mx-1 h-6 self-center" />
          <IconButton icon={Pin} label={pinned ? 'Unpin' : 'Pin'} active={pinned} onClick={() => setPinned((p) => !p)} shortcut="p" />
          <IconButton icon={List} label="List view" active={view === 'list'} onClick={() => setView('list')} />
          <IconButton icon={LayoutGrid} label="Grid view" active={view === 'grid'} onClick={() => setView('grid')} />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ forms

const EFFORT: SelectOption<'low' | 'medium' | 'high'>[] = [
  { value: 'low', label: 'Low', description: 'Fast answers, minimal reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced depth and speed' },
  { value: 'high', label: 'High', description: 'Thorough reasoning for hard problems' },
]

const WORKSPACES: SelectOption[] = [
  { value: 'chat', label: 'Chat', icon: MessagesSquare, group: 'Think' },
  { value: 'research', label: 'Research', icon: Telescope, group: 'Think' },
  { value: 'code', label: 'Code', icon: SquareTerminal, group: 'Make' },
  { value: 'studio', label: 'Studio', icon: WandSparkles, group: 'Make' },
  { value: 'agents', label: 'Agents', icon: Bot, group: 'Delegate' },
  { value: 'workflows', label: 'Workflows', icon: Workflow, group: 'Delegate' },
  { value: 'knowledge', label: 'Knowledge', icon: BookOpen, group: 'Organize', disabled: true },
]

const CITIES = [
  'Amsterdam', 'Athens', 'Auckland', 'Bangkok', 'Barcelona', 'Berlin', 'Bogotá', 'Boston', 'Buenos Aires', 'Cairo',
  'Cape Town', 'Chicago', 'Copenhagen', 'Delhi', 'Dubai', 'Dublin', 'Helsinki', 'Hong Kong', 'Istanbul', 'Jakarta',
  'Lagos', 'Lisbon', 'London', 'Los Angeles', 'Madrid', 'Melbourne', 'Mexico City', 'Montréal', 'Mumbai', 'Nairobi',
  'New York', 'Oslo', 'Paris', 'Prague', 'Reykjavík', 'Rome', 'San Francisco', 'São Paulo', 'Seoul', 'Singapore',
  'Stockholm', 'Sydney', 'Taipei', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna', 'Warsaw', 'Zürich',
].map((c) => ({ value: c.toLowerCase().replace(/\W+/g, '-'), label: c }))

function FormsBlock() {
  const [name, setName] = useState('Atlas Portal v2')
  const [slug, setSlug] = useState('atlas portal')
  const [prompt, setPrompt] = useState('Summarize the last three customer interviews and pull out recurring pricing objections.')
  const [query, setQuery] = useState('')
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium')
  const slugError = /\s/.test(slug) ? 'Slugs cannot contain spaces — try “atlas-portal”.' : undefined
  return (
    <Block id="forms" kicker="Forms" title="Fields, inputs & select" description="Sunken wells with a hairline; focus draws an accent edge and halo. Field wires label, hint, error, required and ids automatically — errors always carry an icon and text.">
      <Grid>
        <Specimen label="Field + Input" stack>
          <Field label="Project name" hint="Shown in the rail and on every linked item." required>
            <Input value={name} onValueChange={setName} placeholder="Untitled project" />
          </Field>
          <Field label="URL slug" error={slugError}>
            <Input value={slug} onValueChange={setSlug} prefix="atrium.app/" />
          </Field>
        </Specimen>
        <Specimen label="Adornments & sizes" stack>
          <Input size="sm" icon={AtSign} placeholder="Small · email" aria-label="Email (small)" />
          <Input icon={Globe} placeholder="Medium · https://…" aria-label="Website" suffix={<Kbd>↵</Kbd>} />
          <Input size="lg" icon={Search} placeholder="Large · search everything" aria-label="Search everything" />
          <Field label="Monthly budget" optional>
            <Input type="number" defaultValue={50} suffix="USD" inputMode="decimal" />
          </Field>
        </Specimen>
        <Specimen label="Disabled & read-only" stack>
          <Field label="Workspace ID" hint="Generated — cannot be changed.">
            <Input value="wsp_k3j9x0q2ab" readOnly className="font-mono" />
          </Field>
          <Field label="API base URL" disabled>
            <Input placeholder="https://api.example.com" />
          </Field>
        </Specimen>
        <Specimen label="Textarea · autosize 2–6 rows" stack>
          <Field label="Instructions" hint={`${prompt.length} characters`}>
            <Textarea autosize minRows={2} maxRows={6} value={prompt} onValueChange={setPrompt} />
          </Field>
          <Textarea mono rows={3} aria-label="JSON payload" defaultValue={'{\n  "event": "run.completed",\n  "simulated": true\n}'} />
        </Specimen>
        <Specimen label="SearchField · Esc clears, then calls onEscape" stack>
          <SearchField value={query} onValueChange={setQuery} placeholder="Search conversations" kbd="/" onEscape={() => toast('onEscape fired (field was empty)')} />
          <SearchField size="sm" placeholder="Filter files" defaultValue="router" />
        </Specimen>
        <Specimen label="Select · descriptions, controlled" stack>
          <Field label="Reasoning effort" hint="Higher effort costs more and takes longer.">
            <Select options={EFFORT} value={effort} onValueChange={setEffort} />
          </Field>
          <Field label="Open in workspace">
            <Select options={WORKSPACES} placeholder="Choose a workspace…" />
          </Field>
        </Specimen>
        <Specimen label="Select · typeahead over 49 options, error, ghost" stack>
          <Field label="City" error="Pick the city closest to your team." required>
            <Select options={CITIES} placeholder="Type to jump…" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-sm whitespace-nowrap text-ink-3">Sort by</span>
            <Select
              variant="ghost"
              size="sm"
              aria-label="Sort by"
              defaultValue="recent"
              options={[
                { value: 'recent', label: 'Most recent' },
                { value: 'name', label: 'Name' },
                { value: 'cost', label: 'Cost' },
              ]}
            />
            <Select size="sm" aria-label="Disabled select" disabled options={[{ value: 'x', label: 'Disabled' }]} defaultValue="x" className="w-36" />
          </div>
        </Specimen>
        <Specimen label="Field · inline layout (settings rows)" stack>
          <div className="flex flex-col divide-y divide-line rounded-md border border-line px-4">
            <Field layout="inline" label="Show reasoning" hint="Display the model's thinking while it works." className="py-3">
              <Switch defaultChecked />
            </Field>
            <Field layout="inline" label="Default effort" hint="Used for new conversations." className="py-3">
              <Select options={EFFORT} defaultValue="medium" size="sm" className="w-32" />
            </Field>
            <Field layout="inline" label="Monthly budget" error="Budget must be at least $5." className="py-3">
              <Input size="sm" defaultValue="2" suffix="USD" className="w-28" inputMode="decimal" />
            </Field>
          </div>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ choices

function ChoicesBlock() {
  const [items, setItems] = useState([true, false, true])
  const all = items.every(Boolean)
  const some = items.some(Boolean)
  const [autonomy, setAutonomy] = useState('balanced')
  const [layout, setLayout] = useState('split')
  const [temp, setTemp] = useState(0.7)
  return (
    <Block id="choices" kicker="Forms" title="Checkbox, switch, radio, segmented, slider" description="Native inputs underneath (keyboard, forms and screen readers for free). Checked states are ink-inverted: selection is not a status, so it stays monochrome.">
      <Grid cols={3}>
        <Specimen label="Checkbox · indeterminate parent" stack>
          <Checkbox
            label="All capabilities"
            checked={all ? true : some ? 'indeterminate' : false}
            onCheckedChange={(c) => setItems(items.map(() => c))}
          />
          <div className="flex flex-col gap-2.5 pl-6">
            {['Read knowledge', 'Search the web', 'Open pull requests'].map((label, i) => (
              <Checkbox
                key={label}
                label={label}
                checked={items[i]}
                onCheckedChange={(c) => setItems(items.map((v, j) => (j === i ? c : v)))}
              />
            ))}
          </div>
          <Checkbox label="Send messages" description="Always asks before posting." disabled />
          <Checkbox label="Accept terms" invalid size="sm" />
        </Specimen>
        <Specimen label="Switch" stack>
          <Switch label="Show reasoning" description="Display the model's thinking while it works." defaultChecked />
          <Switch label="Desktop notifications" />
          <Switch label="Compact switch" size="sm" defaultChecked />
          <Switch label="Locked by admin" disabled defaultChecked />
          <div className="flex items-center gap-3">
            <Switch aria-label="Standalone switch" defaultChecked />
            <span className="text-sm text-ink-3">standalone (aria-label)</span>
          </div>
        </Specimen>
        <Specimen label="Radio group · arrows move" stack>
          <Field label="Default autonomy">
            <RadioGroup
              value={autonomy}
              onValueChange={setAutonomy}
              options={[
                { value: 'cautious', label: 'Cautious', description: 'Ask before every action.' },
                { value: 'balanced', label: 'Balanced', description: 'Ask for risky actions only.' },
                { value: 'autonomous', label: 'Autonomous', description: 'Act, then report.', disabled: true },
              ]}
            />
          </Field>
        </Specimen>
        <Specimen label="Radio cards" wide>
          <RadioGroup
            variant="cards"
            orientation="horizontal"
            aria-label="Plan"
            defaultValue="team"
            className="grid w-full gap-2 sm:grid-cols-3"
            options={[
              { value: 'solo', label: 'Solo', description: 'One seat · local only' },
              { value: 'team', label: 'Team', description: 'Shared projects and agents' },
              { value: 'org', label: 'Organization', description: 'SSO, audit log, policies' },
            ]}
          />
        </Specimen>
        <Specimen label="Segmented control" stack>
          <SegmentedControl
            aria-label="Layout"
            value={layout}
            onValueChange={setLayout}
            options={[
              { value: 'list', label: 'List', icon: Rows3 },
              { value: 'split', label: 'Split', icon: Columns2 },
              { value: 'board', label: 'Board', icon: LayoutGrid },
            ]}
          />
          <SegmentedControl
            size="sm"
            aria-label="Range"
            defaultValue="7d"
            options={[
              { value: '24h', label: '24h' },
              { value: '7d', label: '7d' },
              { value: '30d', label: '30d' },
              { value: 'all', label: 'All', disabled: true },
            ]}
          />
          <SegmentedControl
            size="sm"
            aria-label="Formatting"
            defaultValue="bold"
            options={[
              { value: 'bold', label: 'Bold', icon: Bold, iconOnly: true },
              { value: 'italic', label: 'Italic', icon: Italic, iconOnly: true },
              { value: 'code', label: 'Code', icon: Code, iconOnly: true },
              { value: 'quote', label: 'Quote', icon: Quote, iconOnly: true },
            ]}
          />
        </Specimen>
        <Specimen label="Segmented · full width" stack>
          <SegmentedControl
            fullWidth
            aria-label="Theme preview"
            defaultValue="system"
            options={[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Monitor },
            ]}
          />
        </Specimen>
        <Specimen label="Slider" stack>
          <Slider label="Temperature" showValue value={temp} onValueChange={setTemp} min={0} max={1} step={0.05} formatValue={(v) => v.toFixed(2)} minLabel="Precise" maxLabel="Creative" />
          <Slider label="Simulation speed" showValue defaultValue={2} min={1} max={8} formatValue={(v) => `${v}×`} />
          <Slider aria-label="Disabled slider" defaultValue={30} disabled />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ navigation

function NavigationBlock() {
  const [tab, setTab] = useState('overview')
  return (
    <Block id="navigation" kicker="Navigation" title="Tabs & breadcrumbs" description="One tab stop; arrows, Home and End move. The indicator glides between tabs (instantly under reduced motion). Link tabs render a nav with aria-current.">
      <Grid>
        <Specimen label="Underline · counts · panels" wide stack>
          <Tabs
            aria-label="Project sections"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'tasks', label: 'Tasks', count: 12 },
              { value: 'runs', label: 'Runs', count: 3, icon: Activity },
              { value: 'knowledge', label: 'Knowledge', icon: BookOpen },
              { value: 'settings', label: 'Settings', disabled: true },
            ]}
          >
            {['overview', 'tasks', 'runs', 'knowledge'].map((v) => (
              <TabPanel key={v} value={v} className="pt-4 text-sm text-ink-2">
                Panel <span className="font-mono text-ink">{v}</span> — wired with role="tabpanel" and aria-labelledby.
              </TabPanel>
            ))}
          </Tabs>
        </Specimen>
        <Specimen label="Pill" stack>
          <Tabs
            variant="pill"
            aria-label="Run filter"
            defaultValue="all"
            items={[
              { value: 'all', label: 'All' },
              { value: 'live', label: 'Live', count: 2 },
              { value: 'needs', label: 'Needs you', count: 1 },
              { value: 'done', label: 'Done' },
            ]}
          />
          <Tabs
            variant="pill"
            size="sm"
            aria-label="Small pill tabs"
            defaultValue="day"
            items={[
              { value: 'day', label: 'Day' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
        </Specimen>
        <Specimen label="Link tabs (router)" stack>
          <Tabs
            aria-label="Gallery links"
            size="sm"
            items={[
              { value: 'ui', label: 'Gallery', to: '/dev/ui', end: true },
              { value: 'home', label: 'Home', to: '/', end: true },
              { value: 'chat', label: 'Chat', to: '/chat' },
            ]}
          />
        </Specimen>
        <Specimen label="Breadcrumbs" wide stack>
          <Breadcrumbs items={[{ label: 'Projects', to: '/dev/ui', icon: FolderKanban }, { label: 'Atlas Portal v2', to: '/dev/ui' }, { label: 'SSO revamp' }]} />
          <Breadcrumbs
            maxItems={4}
            items={[
              { label: 'Knowledge', to: '/dev/ui', icon: BookOpen },
              { label: 'Product', to: '/dev/ui' },
              { label: 'Research notes', to: '/dev/ui' },
              { label: '2026', to: '/dev/ui' },
              { label: 'Q4', to: '/dev/ui' },
              { label: 'Pricing interviews — synthesis' },
            ]}
            trailing={<Badge tone="sim" mono>Simulated</Badge>}
          />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ menus

const FILES = [
  { name: 'router.tsx', icon: FileText, meta: '4.2 KB' },
  { name: 'session.ts', icon: FileText, meta: '1.8 KB' },
  { name: 'assets', icon: Folder, meta: '12 items' },
  { name: 'hero.png', icon: Image, meta: '312 KB' },
]

function MenusBlock() {
  const [showArchived, setShowArchived] = useState(false)
  const [sort, setSort] = useState('recent')
  const [last, setLast] = useState('—')
  const items: MenuItem[] = [
    { type: 'label', label: 'Conversation' },
    { label: 'Rename', icon: Pencil, shortcut: 'mod+r', onSelect: () => setLast('Rename') },
    { label: 'Duplicate', icon: Copy, shortcut: 'mod+d', onSelect: () => setLast('Duplicate') },
    { label: 'Share…', icon: Share2, description: 'Invite people or copy a link', onSelect: () => setLast('Share') },
    { label: 'Move to project', icon: FolderKanban, disabled: true },
    { type: 'separator' },
    { type: 'label', label: 'View' },
    { type: 'checkbox', label: 'Show archived', checked: showArchived, onCheckedChange: setShowArchived, keepOpen: true },
    { type: 'radio', label: 'Most recent', checked: sort === 'recent', onSelect: () => setSort('recent'), keepOpen: true },
    { type: 'radio', label: 'Alphabetical', checked: sort === 'alpha', onSelect: () => setSort('alpha'), keepOpen: true },
    { type: 'separator' },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      shortcut: 'mod+backspace',
      onSelect: async () => {
        setLast('Delete')
        if (await confirm({ title: 'Delete this conversation?', description: 'Messages and attachments are removed. Linked tasks keep a reference.', tone: 'danger', confirmLabel: 'Delete' }))
          toast.success('Conversation deleted', { action: { label: 'Undo', onClick: () => toast('Restored') } })
      },
    },
  ]
  const fileItems = (target: Element): MenuItem[] => {
    const name = target.closest('[data-file]')?.getAttribute('data-file') ?? 'selection'
    return [
      { type: 'label', label: name },
      { label: 'Open', icon: ExternalLink, shortcut: 'enter', onSelect: () => toast(`Opened ${name}`) },
      { label: 'Add to context', icon: Plus, onSelect: () => toast(`${name} pinned to context`) },
      { label: 'Copy path', icon: Copy, shortcut: 'mod+shift+c', onSelect: () => toast(`Copied src/${name}`) },
      { type: 'separator' },
      { label: 'Delete file', icon: Trash2, danger: true, onSelect: () => toast.error(`Deleted ${name}`) },
    ]
  }
  return (
    <Block id="menus" kicker="Overlays" title="Menus" description="Data-driven items: icons, shortcuts, descriptions, group labels, separators, checkable and danger items. Arrows, Home/End and typeahead move; Escape returns focus to the trigger; Tab closes and moves on.">
      <Grid>
        <Specimen label="Dropdown · element trigger" stack>
          <div className="flex flex-wrap items-center gap-2">
            <Menu items={items} trigger={<Button variant="secondary" trailingIcon={Ellipsis}>Actions</Button>} />
            <Menu items={items} placement="bottom-end" trigger={<IconButton icon={Ellipsis} label="More actions" variant="outline" />} />
            <Menu
              items={[
                { label: 'New conversation', icon: MessagesSquare, shortcut: 'c' },
                { label: 'New research run', icon: Telescope },
                { label: 'New coding session', icon: SquareTerminal },
                { label: 'New agent', icon: Bot, description: 'Delegate a recurring job' },
              ]}
              trigger={(props, { open }) => (
                <Button {...props} ref={props.ref as never} variant="primary" leadingIcon={Plus} trailingIcon={undefined} aria-label={undefined}>
                  Create {open ? '…' : ''}
                </Button>
              )}
            />
          </div>
          <p className="text-xs text-ink-3">
            Last action: <span className="font-mono text-ink-2">{last}</span> · sort: <span className="font-mono text-ink-2">{sort}</span> · archived:{' '}
            <span className="font-mono text-ink-2">{String(showArchived)}</span>
          </p>
        </Specimen>
        <Specimen label="Context menu · right-click or Shift+F10 on a row" stack>
          <ContextMenu items={fileItems} aria-label="File actions">
            <div className="flex flex-col rounded-md border border-line p-1" aria-label="Files">
              {FILES.map((f) => (
                <div
                  key={f.name}
                  data-file={f.name}
                  tabIndex={0}
                  className="flex h-8 items-center gap-2.5 rounded-sm px-2 text-sm text-ink-2 outline-none hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <f.icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
                  <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
                  <span className="font-mono text-2xs text-ink-4">{f.meta}</span>
                </div>
              ))}
            </div>
          </ContextMenu>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ floating

function FloatingBlock() {
  const [filters, setFilters] = useState({ live: true, attn: true, done: false })
  const [pin, setPin] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  return (
    <Block id="floating" kicker="Overlays" title="Popovers, tooltips & hover cards" description="Anchored with flip + shift so they never leave the viewport. Tooltips wait ~400ms, then open instantly while you move between neighbours; they never appear on touch.">
      <Grid>
        <Specimen label="Popover · filters with close()">
          <Popover
            aria-label="Filter runs"
            trigger={<Button variant="secondary" leadingIcon={Filter}>Filter</Button>}
            className="w-64"
          >
            {({ close }) => (
              <div className="flex flex-col gap-3">
                <Kicker>Show runs that are</Kicker>
                <Checkbox label="Live" checked={filters.live} onCheckedChange={(c) => setFilters({ ...filters, live: c })} />
                <Checkbox label="Waiting on you" checked={filters.attn} onCheckedChange={(c) => setFilters({ ...filters, attn: c })} />
                <Checkbox label="Done" checked={filters.done} onCheckedChange={(c) => setFilters({ ...filters, done: c })} />
                <Divider />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      close()
                      toast(`Filters applied: ${Object.entries(filters).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`)
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            )}
          </Popover>
          <Popover
            aria-label="Rename"
            placement="bottom-end"
            initialFocus={nameRef}
            trigger={<IconButton icon={Pencil} label="Rename" variant="outline" />}
            className="w-72"
          >
            <Field label="Name">
              <Input ref={nameRef} defaultValue="Pricing interviews" />
            </Field>
          </Popover>
        </Specimen>
        <Specimen label="Tooltips · skip-delay between neighbours">
          <Toolbar aria-label="Formatting" className="rounded-sm border border-line p-0.5">
            <IconButton icon={Bold} label="Bold" shortcut="mod+b" size="sm" />
            <IconButton icon={Italic} label="Italic" shortcut="mod+i" size="sm" />
            <IconButton icon={Heading2} label="Heading" shortcut="mod+alt+2" size="sm" />
            <IconButton icon={ListOrdered} label="Numbered list" shortcut="mod+shift+7" size="sm" />
            <IconButton icon={Link} label="Link" shortcut="mod+k" size="sm" />
          </Toolbar>
          <Tooltip content="Runs on the local simulator — nothing leaves your browser." placement="bottom">
            <Badge tone="sim" mono tabIndex={0}>
              Simulated
            </Badge>
          </Tooltip>
        </Specimen>
        <Specimen label="Placement (pin open to inspect)" wide>
          <Switch size="sm" label="Pin open" checked={pin} onCheckedChange={setPin} />
          <div className="flex flex-wrap items-center gap-3 py-6 sm:gap-10 sm:px-10">
            {(['top', 'right', 'bottom', 'left'] as const).map((p) => (
              <Tooltip key={p} content={`placement="${p}"`} placement={p} open={pin ? true : undefined}>
                <Button size="sm" variant="outline">
                  {p}
                </Button>
              </Tooltip>
            ))}
          </div>
        </Specimen>
        <Specimen label="Hover card · mention preview">
          <p className="text-sm text-ink-2">
            Assigned by{' '}
            <HoverCard
              content={
                <div className="flex gap-3">
                  <Avatar name="Morgan Lee" size="lg" status="live" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink">Morgan Lee</span>
                    <span className="text-xs text-ink-3">Product lead · Atlas Portal v2</span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3">
                      <Clock aria-hidden className="size-3" /> 4:12 pm local time
                    </span>
                  </div>
                </div>
              }
            >
              <a href="#a1-floating" className="font-medium text-accent-ink underline decoration-accent-ink/30 underline-offset-[3px] hover:decoration-accent-ink">
                @Morgan Lee
              </a>
            </HoverCard>{' '}
            two hours ago.
          </p>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ dialogs

function DialogsBlock() {
  const [size, setSize] = useState<'sm' | 'md' | 'lg' | 'xl' | 'full' | null>(null)
  const create = useDisclosure()
  const [side, setSide] = useState<'left' | 'right' | 'bottom' | 'auto' | null>(null)
  const [creating, setCreating] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  return (
    <Block id="dialogs" kicker="Overlays" title="Dialogs & sheets" description="Modal: focus is trapped and returns to the trigger, Escape and the scrim dismiss, the page stops scrolling. Enter is a 6px rise with a .98 scale over 360ms; exit is faster.">
      <Grid>
        <Specimen label="Dialog sizes">
          {(['sm', 'md', 'lg', 'xl', 'full'] as const).map((s) => (
            <Button key={s} variant="secondary" size="sm" onClick={() => setSize(s)}>
              {s}
            </Button>
          ))}
        </Specimen>
        <Specimen label="Form dialog · initial focus">
          <Button variant="primary" leadingIcon={Plus} onClick={create.show}>
            New project
          </Button>
        </Specimen>
        <Specimen label="Sheets" wide>
          <Button variant="secondary" size="sm" leadingIcon={PanelRight} onClick={() => setSide('right')}>
            Right inspector
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={PanelLeft} onClick={() => setSide('left')}>
            Left
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={Layers} onClick={() => setSide('bottom')}>
            Bottom (swipe down)
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={Monitor} onClick={() => setSide('auto')}>
            Auto (bottom on mobile)
          </Button>
        </Specimen>
      </Grid>

      <Dialog
        open={size !== null}
        onOpenChange={(o) => !o && setSize(null)}
        size={size ?? 'md'}
        title={`Dialog · ${size ?? ''}`}
        description="Header, scrollable body and footer slots. Title and description are wired to aria-labelledby / aria-describedby."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSize(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setSize(null)}>
              Done
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-ink-2">
          {Array.from({ length: size === 'full' ? 4 : 2 }, (_, i) => (
            <p key={i} className="text-pretty">
              Atrium keeps every run inspectable: steps, approvals, costs and outputs stay attached to the project that asked for them. Dialogs are for focused decisions — anything longer becomes a page or a sheet.
            </p>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={create.open}
        onOpenChange={create.setOpen}
        title="New project"
        description="Projects collect conversations, runs, knowledge and tasks around one goal."
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="ghost" onClick={create.hide}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={creating}
              kbd="mod+enter"
              onClick={() => {
                setCreating(true)
                setTimeout(() => {
                  setCreating(false)
                  create.hide()
                  toast.success('Project created', { description: 'Atlas Portal v3 is ready — add a goal next.' })
                }, 900)
              }}
            >
              Create project
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-1">
          <Field label="Name" required>
            <Input ref={nameRef} placeholder="e.g. Atlas Portal v3" />
          </Field>
          <Field label="Goal" hint="One sentence. Agents read this before every run.">
            <Textarea autosize minRows={2} maxRows={5} placeholder="Ship SSO and the new billing flow by March" />
          </Field>
          <Field label="Default workspace">
            <Select options={WORKSPACES} defaultValue="chat" />
          </Field>
        </div>
      </Dialog>

      <Sheet
        open={side !== null}
        onOpenChange={(o) => !o && setSide(null)}
        side={side ?? 'right'}
        title="Run inspector"
        description="research · RUN-4F2A"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSide(null)}>
              Close
            </Button>
            <Button variant="primary" leadingIcon={Play}>
              Resume
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-1 pb-2">
          <Kicker className="px-2 pb-1">Steps</Kicker>
          {[
            ['Plan the investigation', 'done', '0.8s'],
            ['Search 14 sources', 'done', '6.2s'],
            ['Read and extract claims', 'live', '…'],
            ['Approve sending summary', 'attn', 'waiting'],
            ['Write the report', 'neutral', '—'],
          ].map(([label, tone, meta]) => (
            <ListItem
              key={label}
              label={label}
              meta={meta}
              icon={<span className={cn('size-1.5 rounded-full', { done: 'bg-done', live: 'bg-live', attn: 'bg-attn', neutral: 'bg-ink-4' }[tone])} />}
            />
          ))}
          <Divider className="my-3" />
          <p className="px-2 text-sm text-ink-3">Sheets float inset from the edge on desktop. The bottom sheet has a grab handle — drag it down to dismiss.</p>
        </div>
      </Sheet>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ confirm & toast

function FeedbackBlock() {
  const ask = async (opts: Parameters<typeof confirm>[0]) => {
    const ok = await confirm(opts)
    toast(ok ? 'Confirmed' : 'Cancelled', { tone: ok ? 'success' : 'neutral', duration: 2200 })
  }
  return (
    <Block id="feedback" kicker="Feedback" title="confirm() & toast()" description="Imperative and promise-based. Toasts stack bottom-right on desktop and at the top on mobile, pause while hovered or focused, swipe right to dismiss, and F8 jumps to the newest one.">
      <Grid>
        <Specimen label="confirm(opts) → Promise<boolean>">
          <Button variant="secondary" size="sm" onClick={() => ask({ title: 'Archive this conversation?', description: 'You can restore it from Archive at any time.', confirmLabel: 'Archive' })}>
            Default
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => ask({ title: 'Disconnect GitHub?', description: '2 agents and 1 workflow use this connection and will pause.', tone: 'danger', confirmLabel: 'Disconnect' })}
          >
            Danger
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              ask({
                title: 'Delete project “Atlas Portal v2”?',
                description: 'This removes 48 tasks, 12 conversations and 9 runs. Knowledge items stay in your library.',
                tone: 'danger',
                confirmLabel: 'Delete project',
                requireText: 'atlas-portal-v2',
              })
            }
          >
            Typed confirmation
          </Button>
        </Specimen>
        <Specimen label="toast tones">
          <Button size="sm" variant="ghost" onClick={() => toast('Draft saved')}>
            Neutral
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.success('Report published', { description: 'Shared with 4 people in Atlas Portal v2.' })}>
            Success
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.info('3 new sources found', { description: 'Added to “Q4 Competitive Landscape”.' })}>
            Info
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.warning('80% of monthly budget used', { description: 'Estimated $40.12 of $50.00.' })}>
            Warning
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              toast.error('Couldn’t reach GitHub', {
                description: 'Rate limit exceeded — try again in 2 minutes.',
                action: { label: 'Retry now', onClick: () => toast('Retrying…') },
              })
            }
          >
            Error + action
          </Button>
        </Specimen>
        <Specimen label="loading → update · toast.promise">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = toast.loading('Exporting 3 files…')
              setTimeout(() => toast.update(id, { tone: 'success', title: 'Export ready', description: 'atlas-export.zip · 1.2 MB' }), 1600)
            }}
          >
            Loading → success
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void toast
                .promise(new Promise<number>((resolve, reject) => setTimeout(() => (Math.random() > 0.3 ? resolve(14) : reject(new Error('timeout'))), 1400)), {
                  loading: 'Indexing knowledge…',
                  success: (n) => `Indexed ${n} documents`,
                  error: (e) => `Indexing failed: ${(e as Error).message}`,
                })
                .catch(() => {})
            }
          >
            toast.promise (70% success)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.dismiss()}>
            Dismiss all
          </Button>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ marks

const BADGE_TONES: BadgeTone[] = ['neutral', 'accent', 'live', 'attn', 'done', 'fail', 'sim']
const BADGE_LABEL: Record<string, string> = {
  neutral: 'Draft',
  accent: 'Selected',
  live: 'Running',
  attn: 'Needs you',
  done: 'Completed',
  fail: 'Failed',
  sim: 'Simulated',
}
const HUE_NAMES = ['volt', 'sky', 'violet', 'coral', 'amber', 'mint', 'rose', 'cyan'] as const

function MarksBlock() {
  const [chips, setChips] = useState(['pricing', 'enterprise', 'q4'])
  const [selected, setSelected] = useState<string[]>(['Live'])
  const toggle = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))
  return (
    <Block id="marks" kicker="Feedback" title="Badges, tags, keys & avatars" description="Signal colors carry meaning only — live, attn (needs a human), done, fail and the simulated hatch. Identity hues are for identity marks, as tinted squares.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-left">
          <thead>
            <tr>
              <th className="pb-3 font-mono text-2xs font-normal tracking-[0.08em] text-ink-4 uppercase">Tone</th>
              {(['subtle', 'solid', 'outline'] as const).map((v) => (
                <th key={v} className="pb-3 font-mono text-2xs font-normal tracking-[0.08em] text-ink-4 uppercase">
                  {v}
                </th>
              ))}
              <th className="pb-3 font-mono text-2xs font-normal tracking-[0.08em] text-ink-4 uppercase">dot · md</th>
            </tr>
          </thead>
          <tbody>
            {BADGE_TONES.map((t) => (
              <tr key={t} className="border-t border-line">
                <td className="py-2.5 pr-4 font-mono text-xs text-ink-3">{t}</td>
                {(['subtle', 'solid', 'outline'] as const).map((v) => (
                  <td key={v} className="py-2.5 pr-4">
                    <Badge tone={t} variant={v}>
                      {BADGE_LABEL[t]}
                    </Badge>
                  </td>
                ))}
                <td className="py-2.5 pr-4">
                  <Badge tone={t} size="md" dot pulse={t === 'live'}>
                    {BADGE_LABEL[t]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Grid>
        <Specimen label="Identity hues (hue:<name>)">
          {HUE_NAMES.map((h) => (
            <Badge key={h} tone={`hue:${h}`}>
              {h}
            </Badge>
          ))}
        </Specimen>
        <Specimen label="Mono kickers & icons">
          <Badge tone="sim" mono>
            Simulated
          </Badge>
          <Badge tone="live" mono dot pulse>
            Live
          </Badge>
          <Badge tone="neutral" mono>
            Beta
          </Badge>
          <Badge tone="attn" icon={Bell}>
            2 approvals
          </Badge>
          <Badge tone="done" icon={Check} variant="outline">
            Verified
          </Badge>
          <Badge tone="hue:violet" icon={GitBranch} variant="outline">
            feat/sso
          </Badge>
        </Specimen>
        <Specimen label="Tags · removable (Backspace removes)">
          {chips.map((c) => (
            <Tag key={c} icon={Hash} onRemove={() => setChips(chips.filter((x) => x !== c))}>
              {c}
            </Tag>
          ))}
          {chips.length === 0 && (
            <Button size="xs" variant="ghost" leadingIcon={RotateCcw} onClick={() => setChips(['pricing', 'enterprise', 'q4'])}>
              Reset
            </Button>
          )}
          <Tag hue="sky">Atlas Portal v2</Tag>
          <Tag hue="rose" size="md">
            Field Notes
          </Tag>
        </Specimen>
        <Specimen label="Chips · selectable filters">
          {['Live', 'Needs you', 'Done', 'Failed'].map((c) => (
            <Tag key={c} selectable selected={selected.includes(c)} onSelectedChange={() => toggle(c)} size="md">
              {c}
            </Tag>
          ))}
          <Tag selectable disabled size="md">
            Archived
          </Tag>
        </Specimen>
        <Specimen label="Kbd & KbdCombo (forced platform)">
          <KbdCombo combo="mod+k" mac />
          <KbdCombo combo="mod+k" mac={false} />
          <KbdCombo combo="mod+shift+p" mac />
          <KbdCombo combo="g c" />
          <KbdCombo combo="shift+?" variant="plain" mac />
          <KbdCombo combo="mod+enter" variant="plain" mac={false} />
          <Kbd size="md">Esc</Kbd>
        </Specimen>
        <Specimen label="Avatars · sizes, shapes, status">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
            <Avatar key={s} name="Morgan Lee" size={s} />
          ))}
          <Avatar name="Scout" shape="square" size="lg" hue="volt" status="live" />
          <Avatar name="GitHub" monogram="GH" shape="square" size="lg" hue="violet" />
          <Avatar name="Broken Image" src="data:image/png;base64,AAAA" size="lg" status="attn" />
          <AvatarGroup
            people={[{ name: 'Morgan Lee' }, { name: 'Ada Park' }, { name: 'Sam Ortiz' }, { name: 'Lee Chen' }, { name: 'Rui Alves' }, { name: 'Kim Ito' }]}
            max={4}
          />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ loading

function LoadingBlock() {
  const [progress, setProgress] = useState(64)
  return (
    <Block id="loading" kicker="Feedback" title="Spinners, skeletons & progress" description="Skeleton shimmer stops under reduced motion; spinners slow down instead of freezing; the indeterminate bar becomes a soft pulse.">
      <Grid cols={3}>
        <Specimen label="Spinner sizes">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => (
            <Spinner key={s} size={s} className="text-ink-3" />
          ))}
          <Spinner size="md" className="text-live" label="Loading runs" />
        </Specimen>
        <Specimen label="Skeleton" stack>
          <div className="flex items-center gap-3">
            <Skeleton variant="circle" size={32} />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton height={10} width="40%" />
              <Skeleton height={10} width="70%" />
            </div>
          </div>
          <Skeleton variant="text" lines={3} />
          <Skeleton height={64} />
        </Specimen>
        <Specimen label="Progress" stack>
          <ProgressBar value={progress} label="Indexing knowledge" showValue />
          <div className="flex gap-2">
            <Button size="xs" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 16))}>
              −16
            </Button>
            <Button size="xs" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 16))}>
              +16
            </Button>
          </div>
          <ProgressBar value={100} tone="done" label="Run complete" showValue />
          <ProgressBar value={82} tone="attn" size="thin" aria-label="Budget used" />
          <ProgressBar value={30} tone="fail" size="md" aria-label="Error budget" />
          <ProgressBar label="Waiting for model…" tone="live" />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ layout

function LayoutBlock() {
  const [selectedCard, setSelectedCard] = useState('b')
  return (
    <Block id="layout" kicker="Layout" title="Surfaces, cards, panels & headers" description="Instruments, not dashboards: separation by whitespace and hairlines. Cards are for things you move or select; elevation is reserved for overlays.">
      <Grid cols={3}>
        <Specimen label="Surface variants" stack>
          {(['flat', 'raised', 'sunken'] as const).map((v) => (
            <Surface key={v} variant={v} padding="sm" className="text-sm text-ink-2">
              <span className="font-mono text-xs text-ink-3">{v}</span> — bg-{v === 'flat' ? 'transparent' : v} + hairline
            </Surface>
          ))}
        </Specimen>
        <Specimen label="Cards · interactive / selected / disabled" stack className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { id: 'a', title: 'Scout', role: 'Competitive research', hue: 'violet' as const, status: 'live' as const },
              { id: 'b', title: 'Patch', role: 'Fixes flaky tests', hue: 'mint' as const, status: 'attn' as const },
              { id: 'c', title: 'Ledger', role: 'Weekly cost digest', hue: 'amber' as const, status: 'idle' as const },
            ].map((a) => (
              <Card
                key={a.id}
                label={`${a.title} — ${a.role}`}
                onClick={() => setSelectedCard(a.id)}
                selected={selectedCard === a.id}
                padding="sm"
                className="flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <Avatar name={a.title} shape="square" hue={a.hue} status={a.status} />
                  <Menu
                    items={[
                      { label: 'Run now', icon: Play, onSelect: () => toast(`${a.title} started`) },
                      { label: 'Pause', icon: Pause },
                    ]}
                    placement="bottom-end"
                    trigger={<IconButton icon={Ellipsis} label={`${a.title} actions`} size="xs" />}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-ink-3">{a.role}</p>
                </div>
              </Card>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card to="/dev/ui" padding="sm" className="text-sm text-ink-2">
              <span className="flex items-center gap-1.5 font-medium text-ink">
                Link card <ArrowUpRight aria-hidden className="size-3.5 text-ink-3" />
              </span>
              Navigates with the router.
            </Card>
            <Card disabled padding="sm" className="text-sm text-ink-3" onClick={() => {}}>
              Disabled card
            </Card>
          </div>
        </Specimen>
        <Specimen label="Panel" stack className="lg:col-span-2">
          <Panel
            kicker="Usage"
            title="This month"
            actions={
              <>
                <IconButton icon={Download} label="Export CSV" size="sm" />
                <Menu items={[{ label: 'View all runs', icon: Activity }]} placement="bottom-end" trigger={<IconButton icon={Ellipsis} label="Panel options" size="sm" />} />
              </>
            }
            footer={
              <span className="text-xs text-ink-3">
                Costs for simulated runs are <span className="text-ink-2">estimates</span>.
              </span>
            }
          >
            <div className="grid grid-cols-3 gap-4">
              {[
                ['Runs', '128'],
                ['Tokens', '2.4M'],
                ['Est. cost', '$31.20'],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1">
                  <Kicker>{k}</Kicker>
                  <span className="font-mono text-xl text-ink tabular">{v}</span>
                </div>
              ))}
            </div>
          </Panel>
        </Specimen>
        <Specimen label="Section header" stack>
          <SectionHeader kicker="Runs" title="Recent activity" description="What your agents did while you were away." actions={<Button size="sm" variant="ghost" trailingIcon={ArrowRight}>All runs</Button>} divider />
        </Specimen>
        <Specimen label="Page header · sans, tabs, actions" wide stack>
          <Surface variant="flat" padding="lg" radius="lg">
            <PageHeader
              eyebrow="Projects"
              title="Atlas Portal v2"
              leading={<Avatar name="Atlas Portal v2" shape="square" hue="sky" size="xl" />}
              meta={
                <>
                  <Badge tone="live" dot pulse>
                    2 running
                  </Badge>
                  <Badge tone="attn">1 needs you</Badge>
                </>
              }
              description="Rebuild of the customer portal: SSO and auth revamp, Stripe billing migration, performance."
              actions={
                <>
                  <Button variant="secondary" leadingIcon={Share2}>
                    Share
                  </Button>
                  <Button variant="primary" leadingIcon={Plus}>
                    New task
                  </Button>
                </>
              }
              tabs={
                <Tabs
                  aria-label="Project"
                  defaultValue="overview"
                  items={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'tasks', label: 'Tasks', count: 48 },
                    { value: 'runs', label: 'Runs', count: 9 },
                    { value: 'knowledge', label: 'Knowledge' },
                  ]}
                />
              }
            />
          </Surface>
        </Specimen>
        <Specimen label="Page header · serif display, breadcrumbs" wide stack>
          <Surface variant="flat" padding="lg" radius="lg">
            <PageHeader
              serif
              breadcrumbs={<Breadcrumbs items={[{ label: 'Research', to: '/dev/ui', icon: Telescope }, { label: 'Q4 Competitive Landscape', to: '/dev/ui' }, { label: 'Report' }]} />}
              eyebrow="Report · 14 sources"
              title="How mid-market buyers compare AI workspace pricing"
              description="A synthesis of public pricing pages, analyst notes and eleven customer interviews."
              meta={
                <Badge tone="sim" mono>
                  Simulated
                </Badge>
              }
              actions={
                <Button variant="secondary" leadingIcon={Download}>
                  Export
                </Button>
              }
            />
          </Surface>
        </Specimen>
        <Specimen label="Toolbar · bar variant (←/→ between controls)" wide stack>
          <Surface variant="raised" radius="md" className="overflow-hidden">
            <Toolbar aria-label="Editor" variant="bar">
              <ToolbarGroup>
                <IconButton icon={Bold} label="Bold" size="sm" />
                <IconButton icon={Italic} label="Italic" size="sm" />
                <IconButton icon={Code} label="Inline code" size="sm" />
              </ToolbarGroup>
              <ToolbarSeparator />
              <ToolbarGroup>
                <IconButton icon={List} label="Bulleted list" size="sm" />
                <IconButton icon={ListOrdered} label="Numbered list" size="sm" />
              </ToolbarGroup>
              <ToolbarSpacer />
              <Button size="sm" variant="ghost" leadingIcon={Eye}>
                Preview
              </Button>
              <Button size="sm" variant="primary" leadingIcon={Send}>
                Publish
              </Button>
            </Toolbar>
            <div className="p-4 font-serif text-md text-ink-2">The quickest way to understand a market is to read what customers complain about.</div>
          </Surface>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ states

function StatesBlock() {
  const [retrying, setRetrying] = useState(false)
  return (
    <Block id="states" kicker="Layout" title="Empty & error states" description="Every data view needs them. Empty states explain what belongs here and offer the next step; errors say what failed, offer Retry and keep technical details one click away.">
      <Grid>
        <Specimen label="Empty · default" stack>
          <Surface variant="flat" radius="lg">
            <EmptyState
              icon={Inbox}
              title="Nothing needs you"
              description="Approvals and questions from agents land here. You're all caught up."
              actions={
                <>
                  <Button variant="secondary" size="sm" leadingIcon={Bot}>
                    View agents
                  </Button>
                  <Button variant="ghost" size="sm">
                    Notification settings
                  </Button>
                </>
              }
            />
          </Surface>
        </Specimen>
        <Specimen label="Empty · bordered drop zone, compact" stack>
          <EmptyState bordered icon={Download} title="Drop files to add knowledge" description="PDF, Markdown, CSV or plain text — indexed locally, never uploaded." actions={<Button size="sm" variant="secondary">Choose files</Button>} />
          <EmptyState compact bordered icon={Sparkles} title="No assets yet" description="Generated images and slides appear here." />
        </Specimen>
        <Specimen label="Error · details + retry" stack>
          <Surface variant="flat" radius="lg">
            <ErrorState
              title="Couldn’t load pull requests"
              message="GitHub returned 403 — the token may have expired or lacks repo scope."
              details={'GET /repos/atlas/portal/pulls\n403 Forbidden\n{\n  "message": "Resource not accessible by personal access token",\n  "documentation_url": "https://docs.github.com/rest"\n}'}
              onRetry={() => {
                setRetrying(true)
                setTimeout(() => setRetrying(false), 1200)
              }}
              retrying={retrying}
              actions={<Button size="sm" variant="ghost" leadingIcon={Settings2}>Reconnect</Button>}
            />
          </Surface>
        </Specimen>
        <Specimen label="Error · compact (inline)" stack>
          <ErrorState compact title="Run failed at step 3" message="The simulated sandbox timed out after 60s." onRetry={() => toast('Retrying run…')} />
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ lists & icons

function ListsBlock() {
  const [active, setActive] = useState('c2')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [iconQuery, setIconQuery] = useState('')
  const names = Object.keys(ICONS).filter((n) => n.toLowerCase().includes(iconQuery.toLowerCase()))
  return (
    <Block id="lists" kicker="Layout" title="List items, nav items & dynamic icons" description="Rows are 32px (28px when html[data-density=compact], 44px on touch). DynamicIcon resolves the string icon names stored in data — unknown names fall back to a circle.">
      <Grid>
        <Specimen label="NavItem (router-aware) · density" stack>
          <SegmentedControl
            size="sm"
            aria-label="Density"
            value={density}
            onValueChange={setDensity}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <nav aria-label="Demo navigation" data-density={density} className="flex w-full max-w-xs flex-col gap-px">
            <NavItem to="/dev/ui" end icon={LayoutGrid} label="Gallery" count={3} />
            <NavItem to="/" end icon={Inbox} label="Home" />
            <NavItem to="/chat" icon={MessagesSquare} label="Chat" count={12} />
            <NavItem to="/research" icon={Telescope} label="Research" />
            <NavItem to="/agents" icon={Bot} label="Agents" trailing={<Badge tone="attn">2</Badge>} />
          </nav>
        </Specimen>
        <Specimen label="ListItem · clickable rows (aria-current), row actions on hover" stack>
          <div role="group" aria-label="Conversations" data-density={density} className="flex w-full flex-col gap-px">
            {[
              { id: 'c1', label: 'Pricing objections from interviews', meta: '2m', icon: MessagesSquare },
              { id: 'c2', label: 'SSO edge cases for SAML IdPs', meta: '1h', icon: MessagesSquare, description: 'Atlas Portal v2 · 14 messages' },
              { id: 'c3', label: 'Weekly cost digest draft', meta: 'Tue', icon: FileText },
              { id: 'c4', label: 'Archived: launch checklist', meta: 'Mar 4', icon: Archive, disabled: true },
            ].map((r) => (
              <ListItem
                key={r.id}
                selected={active === r.id}
                disabled={r.disabled}
                icon={r.icon}
                label={r.label}
                description={r.description}
                meta={r.meta}
                onClick={() => setActive(r.id)}
                trailingOnHover
                trailing={<IconButton icon={Ellipsis} label={`Actions for ${r.label}`} size="xs" onClick={() => toast(`Actions for “${r.label}”`)} />}
              />
            ))}
            <ListItem icon={<Avatar name="Ada Park" size="sm" decorative />} label="Ada Park" description="ada@atlas.dev" meta="Owner" />
            <ListItem icon={Mail} label="External link row" href="#a1-lists" meta={<ExternalLink aria-hidden className="size-3" />} />
          </div>
        </Specimen>
        <Specimen label={`DynamicIcon · ${names.length} of ${Object.keys(ICONS).length} curated names`} wide stack>
          <SearchField size="sm" value={iconQuery} onValueChange={setIconQuery} placeholder="Filter icons" className="max-w-xs" />
          <ScrollArea className="max-h-56 rounded-md border border-line">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-px bg-line">
              {names.map((n) => (
                <div key={n} className="flex items-center gap-2 bg-canvas px-2.5 py-2">
                  <DynamicIcon name={n} className="size-4 shrink-0 text-ink-2" strokeWidth={1.75} />
                  <span className="truncate font-mono text-2xs text-ink-3">{n}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 bg-canvas px-2.5 py-2">
                <DynamicIcon name="NotARealIcon" className="size-4 shrink-0 text-ink-4" strokeWidth={1.75} />
                <span className="truncate font-mono text-2xs text-ink-4">unknown → Circle</span>
              </div>
            </div>
          </ScrollArea>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ panes

function PanesBlock() {
  return (
    <Block id="panes" kicker="Layout" title="Split pane & scroll area" description="Drag the hairline or focus it (Tab) and use the arrow keys — Shift for bigger steps, Home/End for min/max, Enter to collapse. The size persists per id. Below md the panes stack.">
      <Grid>
        <Specimen label="SplitPane · persisted, collapsible" wide stack>
          <div className="h-72 overflow-hidden rounded-md border border-line">
            <SplitPane
              id="gallery-demo"
              collapsible
              defaultSize={260}
              minSize={180}
              maxSize={420}
              handleLabel="Resize file list"
              className="h-full"
              primary={
                <ScrollArea className="h-full bg-sunken p-1">
                  {['src', 'app', 'core', 'ui', 'primitives', 'hooks', 'gallery', 'workspaces', 'lib', 'styles', 'e2e', 'scripts'].map((n, i) => (
                    <ListItem key={n} icon={i % 4 === 3 ? File : Folder} label={n} meta={`${(i * 7) % 23 + 2}`} onClick={() => {}} />
                  ))}
                </ScrollArea>
              }
              secondary={
                <div className="flex h-full flex-col">
                  <Toolbar aria-label="File" variant="bar">
                    <span className="truncate px-1 font-mono text-xs text-ink-2">src/ui/primitives/SplitPane.tsx</span>
                    <ToolbarSpacer />
                    <IconButton icon={Copy} label="Copy path" size="sm" />
                  </Toolbar>
                  <div className="flex-1 p-4 font-mono text-xs leading-5 text-ink-3">
                    <p>
                      <span className="text-(--syn-keyword)">export function</span> <span className="text-(--syn-function)">SplitPane</span>
                      <span className="text-(--syn-punct)">(</span>props<span className="text-(--syn-punct)">)</span> {'{'}
                    </p>
                    <p className="pl-4">
                      <span className="text-(--syn-comment)">{'// drag the hairline on the left'}</span>
                    </p>
                    <p>{'}'}</p>
                  </div>
                </div>
              }
            />
          </div>
        </Specimen>
        <Specimen label="ScrollArea · vertical fades" stack>
          <ScrollArea className="h-48 rounded-md border border-line p-1">
            {Array.from({ length: 24 }, (_, i) => (
              <ListItem key={i} icon={Hash} label={`channel-${String(i + 1).padStart(2, '0')}`} meta={`${(i * 13) % 97}`} />
            ))}
          </ScrollArea>
        </Specimen>
        <Specimen label="ScrollArea · horizontal, hidden scrollbar" stack>
          <ScrollArea orientation="horizontal" hideScrollbar className="rounded-md border border-line p-2">
            <div className="flex w-max gap-2">
              {['All', 'Pricing', 'Enterprise', 'Security', 'SSO', 'Billing', 'Performance', 'Onboarding', 'Mobile', 'Integrations', 'Analytics', 'Support'].map((t, i) => (
                <Tag key={t} size="md" selectable selected={i === 0}>
                  {t}
                </Tag>
              ))}
            </div>
          </ScrollArea>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ hooks & theme

function HooksBlock() {
  const [count, setCount] = useState(0)
  const [chordAt, setChordAt] = useState<string | null>(null)
  const [text, setText] = useState('')
  const debounced = useDebounced(text, 400)
  const { copy, copied } = useCopy()
  const bp = useBreakpoint()
  const reduced = useReducedMotion()
  const typing = useIsTyping()
  const coarse = useMediaQuery('(pointer: coarse)')
  const [stored, setStored, resetStored] = useLocalStorageState('atrium.gallery.counter', 0)
  const boxRef = useRef<HTMLDivElement>(null)
  const [outside, setOutside] = useState(0)
  useClickOutside(boxRef, () => setOutside((n) => n + 1))
  useHotkey('mod+j', () => setCount((c) => c + 1))
  useChord(['g', 'u'], () => setChordAt(new Date().toLocaleTimeString()))
  const { theme, resolvedTheme, setTheme } = useTheme()

  const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <span className="text-ink-3">{k}</span>
      <span className="font-mono text-xs text-ink">{v}</span>
    </div>
  )

  return (
    <Block id="hooks" kicker="Hooks & theme" title="Keyboard, environment & theme" description="useHotkey ('mod' = ⌘ or Ctrl), useChord for g-then-x sequences (ignored while typing), and the environment hooks. ThemeProvider applies settings to <html> and crossfades on switches.">
      <Grid>
        <Specimen label="Keyboard" stack>
          <div className="flex flex-col">
            <Row k={<>Press <KbdCombo combo="mod+j" /> (useHotkey)</>} v={`${count} times`} />
            <Row k={<>Press <KbdCombo combo="g u" /> (useChord)</>} v={chordAt ?? 'not yet'} />
            <Row k="Focus is in a text field (useIsTyping)" v={String(typing)} />
          </div>
        </Specimen>
        <Specimen label="Environment" stack>
          <div className="flex flex-col">
            <Row k="useBreakpoint()" v={bp} />
            <Row k="useReducedMotion()" v={String(reduced)} />
            <Row k="(pointer: coarse)" v={String(coarse)} />
            <Row k="useClickOutside — clicks outside the box below" v={outside} />
          </div>
          <div ref={boxRef} className="rounded-sm border border-dashed border-line-strong px-3 py-2 text-xs text-ink-3">
            Clicks in here don’t count.
          </div>
        </Specimen>
        <Specimen label="useDebounced · useCopy · useLocalStorageState" stack>
          <SearchField size="sm" value={text} onValueChange={setText} placeholder="Type quickly…" />
          <div className="flex flex-col">
            <Row k="Debounced (400ms)" v={debounced || '—'} />
            <Row
              k="Persisted counter"
              v={
                <span className="flex items-center gap-1.5">
                  {stored}
                  <Button size="xs" variant="outline" onClick={() => setStored((n) => n + 1)}>
                    +1
                  </Button>
                  <Button size="xs" variant="ghost" onClick={resetStored}>
                    Reset
                  </Button>
                </span>
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <code className="rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-2">run_4f2a9c</code>
            <Button size="xs" variant="ghost" leadingIcon={copied ? Check : Copy} onClick={() => copy('run_4f2a9c')}>
              {copied ? 'Copied' : 'Copy id'}
            </Button>
          </div>
        </Specimen>
        <Specimen label="Theme (writes settings.appearance.theme)" stack>
          <ThemeProvider>
            <SegmentedControl
              aria-label="Theme"
              value={theme}
              onValueChange={setTheme}
              options={[
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
                { value: 'system', label: 'System', icon: Monitor },
              ]}
            />
          </ThemeProvider>
          <div className="flex flex-col">
            <Row k="theme" v={theme} />
            <Row k="resolvedTheme" v={resolvedTheme} />
          </div>
          <p className="text-xs text-ink-3">
            <Keyboard aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
            The gallery header toggle flips the attribute directly; this control goes through settings like the real app.
          </p>
        </Specimen>
      </Grid>
    </Block>
  )
}

// ------------------------------------------------------------------------------------------------ section

export default function Section() {
  return (
    <section aria-labelledby="a1-title" className="flex flex-col gap-16">
      <ToastHost />
      <ConfirmHost />
      <header className="flex flex-col gap-4">
        <Kicker>Track A1</Kicker>
        <div className="flex flex-col gap-2">
          <h2 id="a1-title" className="font-serif text-4xl leading-[44px] tracking-[-0.015em] text-ink">
            Primitives
          </h2>
          <p className="max-w-2xl text-base text-ink-2 text-pretty">
            Actions, forms, navigation, overlays, feedback and layout — calm at rest, precise under the hand. Every control is keyboard-first,
            labelled, and honest about state.
          </p>
        </div>
        <nav aria-label="Primitives contents" className="flex flex-wrap gap-1.5 pt-2">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#a1-${id}`}
              className="rounded-xs border border-line px-2 py-1 text-xs text-ink-3 transition-colors duration-(--dur-1) hover:border-line-strong hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>
        <VisuallyHidden>Toast and confirm hosts are mounted by this section.</VisuallyHidden>
      </header>
      <ActionsBlock />
      <FormsBlock />
      <ChoicesBlock />
      <NavigationBlock />
      <MenusBlock />
      <FloatingBlock />
      <DialogsBlock />
      <FeedbackBlock />
      <MarksBlock />
      <LoadingBlock />
      <LayoutBlock />
      <StatesBlock />
      <ListsBlock />
      <PanesBlock />
      <HooksBlock />
      <div className="flex items-center gap-2 text-xs text-ink-4">
        <Zap aria-hidden className="size-3.5" /> <Users aria-hidden className="size-3.5" /> <Calendar aria-hidden className="size-3.5" />
        <span>End of primitives.</span>
      </div>
    </section>
  )
}
