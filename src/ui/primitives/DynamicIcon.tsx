import type { Ref } from 'react'
import {
  Activity, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, AtSign, AudioLines, BadgeCheck, Bell,
  Blocks, BookOpen, BookPlus, Bookmark, Bot, Box, Boxes, Brain, Briefcase, Bug, Building2, Calendar, CalendarClock,
  Camera, ChartColumn, ChartLine, ChartNoAxesCombined, ChartPie, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleHelp, CirclePause, CirclePlay, CircleX, Clapperboard,
  Clipboard, Clock, Cloud, Code, CodeXml, Command, Compass, Component, Copy, Cpu, CreditCard, Database, Download,
  Ellipsis, ExternalLink, Eye, EyeOff, Feather, File, FileChartColumn, FileCode2, FilePen, FileText, Filter, Flag,
  FlaskConical, Folder, FolderGit2, FolderKanban, FolderOpen, Gauge, GitBranch, GitCommitHorizontal, GitMerge,
  GitPullRequest, Globe, GraduationCap, Hash, Heart, History, House, Image, Inbox, Info, Key, Keyboard, Layers,
  LayoutDashboard, LayoutGrid, Leaf, LifeBuoy, Library, Lightbulb, Link, List, ListChecks, ListTodo, Loader, Lock, Mail,
  Map, MapPin, Maximize2, Megaphone, Menu, MessageCircle, MessageSquareText, MessagesSquare, Mic, Microscope, Minimize2,
  Minus, Monitor, Moon, Network, Newspaper, Notebook, NotebookPen, NotepadText, OctagonAlert, Orbit, Package, Palette,
  Paperclip, Pause, PenLine, PenTool, Play, Plug, Plus, Presentation, Puzzle, Quote, RefreshCw, Repeat, Rocket, Route,
  Save, ScanSearch, Search, Send, Server, Settings, Settings2, Shapes, Share2, Sheet, Shield, ShieldCheck,
  SlidersHorizontal, Sparkles, Square, SquareCheckBig, SquareCode, SquareKanban, SquareTerminal, Star, StickyNote, Sun,
  Table, Tag, Target, Telescope, Terminal, ThumbsUp, Timer, Trash2, TrendingUp, TriangleAlert, Type, Upload, User,
  Users, Video, WandSparkles, Waypoints, Webhook, Workflow, Wrench, Zap,
  type LucideIcon, type LucideProps,
} from 'lucide-react'

/**
 * Curated icon map for data-driven icons (entity kinds, capabilities, projects, collections…).
 * Covers every icon name used in src/core and the workspace manifests, plus common picks for
 * user-chosen project/collection icons. Unknown names fall back to Circle.
 */
export const ICONS = {
  Activity, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, AtSign, AudioLines, BadgeCheck, Bell,
  Blocks, BookOpen, BookPlus, Bookmark, Bot, Box, Boxes, Brain, Briefcase, Bug, Building2, Calendar, CalendarClock,
  Camera, ChartColumn, ChartLine, ChartNoAxesCombined, ChartPie, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleHelp, CirclePause, CirclePlay, CircleX, Clapperboard,
  Clipboard, Clock, Cloud, Code, CodeXml, Command, Compass, Component, Copy, Cpu, CreditCard, Database, Download,
  Ellipsis, ExternalLink, Eye, EyeOff, Feather, File, FileChartColumn, FileCode2, FilePen, FileText, Filter, Flag,
  FlaskConical, Folder, FolderGit2, FolderKanban, FolderOpen, Gauge, GitBranch, GitCommitHorizontal, GitMerge,
  GitPullRequest, Globe, GraduationCap, Hash, Heart, History, House, Image, Inbox, Info, Key, Keyboard, Layers,
  LayoutDashboard, LayoutGrid, Leaf, LifeBuoy, Library, Lightbulb, Link, List, ListChecks, ListTodo, Loader, Lock, Mail,
  Map, MapPin, Maximize2, Megaphone, Menu, MessageCircle, MessageSquareText, MessagesSquare, Mic, Microscope, Minimize2,
  Minus, Monitor, Moon, Network, Newspaper, Notebook, NotebookPen, NotepadText, OctagonAlert, Orbit, Package, Palette,
  Paperclip, Pause, PenLine, PenTool, Play, Plug, Plus, Presentation, Puzzle, Quote, RefreshCw, Repeat, Rocket, Route,
  Save, ScanSearch, Search, Send, Server, Settings, Settings2, Shapes, Share2, Sheet, Shield, ShieldCheck,
  SlidersHorizontal, Sparkles, Square, SquareCheckBig, SquareCode, SquareKanban, SquareTerminal, Star, StickyNote, Sun,
  Table, Tag, Target, Telescope, Terminal, ThumbsUp, Timer, Trash2, TrendingUp, TriangleAlert, Type, Upload, User,
  Users, Video, WandSparkles, Waypoints, Webhook, Workflow, Wrench, Zap,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/** Names offered in icon pickers (project/collection identity). */
export const PICKABLE_ICONS: IconName[] = [
  'Folder', 'FolderKanban', 'Boxes', 'Box', 'Package', 'Rocket', 'Megaphone', 'Feather', 'Telescope', 'Compass',
  'Target', 'Flag', 'Lightbulb', 'Brain', 'Sparkles', 'Palette', 'PenTool', 'Code', 'Terminal', 'Bug', 'Database',
  'Server', 'Cloud', 'Globe', 'Map', 'Workflow', 'Waypoints', 'Network', 'Layers', 'Blocks', 'Shapes', 'Puzzle',
  'BookOpen', 'Library', 'Notebook', 'GraduationCap', 'Microscope', 'FlaskConical', 'ChartLine', 'ChartPie', 'Gauge',
  'Briefcase', 'Building2', 'Users', 'Heart', 'Star', 'Leaf', 'Zap',
]

export function isIconName(name: string | undefined | null): name is IconName {
  return !!name && Object.prototype.hasOwnProperty.call(ICONS, name)
}

/** Resolve a lucide icon name to its component (Circle when unknown). */
export function getIcon(name: string | undefined | null): LucideIcon {
  return isIconName(name) ? ICONS[name] : Circle
}

export interface DynamicIconProps extends Omit<LucideProps, 'ref' | 'name'> {
  ref?: Ref<SVGSVGElement>
  /** Lucide icon name, e.g. 'FolderKanban'. */
  name: string | undefined | null
}

/** Render an icon from its string name (data-driven icons). Decorative by default (aria-hidden). */
export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  const Icon = getIcon(name)
  return <Icon aria-hidden={props['aria-label'] ? undefined : true} {...props} />
}
