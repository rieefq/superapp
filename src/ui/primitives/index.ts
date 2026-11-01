/**
 * Atrium primitives (track A1): actions, forms, navigation, overlays, feedback, layout, theme.
 * Import from '@/ui'.
 */

// Actions
export { Button, ButtonLink, buttonClassName } from './Button'
export type { ButtonProps, ButtonLinkProps, ButtonVariant, ButtonSize, ButtonStyleOptions } from './Button'
export { IconButton } from './IconButton'
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton'

// Forms
export { Field, useFieldContext, useFieldControl } from './Field'
export type { FieldProps, FieldContextValue } from './Field'
export { Input, Textarea, SearchField } from './Input'
export type { InputProps, TextareaProps, SearchFieldProps, ControlSize } from './Input'
export { Select } from './Select'
export type { SelectProps, SelectOption } from './Select'
export { Checkbox } from './Checkbox'
export type { CheckboxProps, CheckedState } from './Checkbox'
export { Switch } from './Switch'
export type { SwitchProps } from './Switch'
export { RadioGroup } from './RadioGroup'
export type { RadioGroupProps, RadioOption } from './RadioGroup'
export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl'
export { Slider } from './Slider'
export type { SliderProps } from './Slider'

// Navigation
export { Tabs, TabPanel } from './Tabs'
export type { TabsProps, TabItem, TabPanelProps } from './Tabs'
export { Breadcrumbs } from './Breadcrumbs'
export type { BreadcrumbsProps, Crumb } from './Breadcrumbs'

// Overlays
export { Menu, DropdownMenu, ContextMenu } from './Menu'
export type {
  MenuProps,
  DropdownMenuProps,
  ContextMenuProps,
  MenuTriggerProps,
  MenuItem,
  MenuActionItem,
  MenuCheckboxItem,
  MenuRadioItem,
  MenuSeparator,
  MenuLabel,
} from './Menu'
export { Popover, HoverCard } from './Popover'
export type { PopoverProps, PopoverTriggerProps, HoverCardProps } from './Popover'
export { Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'
export { Dialog, Sheet, DialogTitle, DialogDescription } from './Dialog'
export type { DialogProps, SheetProps } from './Dialog'
export { confirm, ConfirmHost, confirmStore, resolveConfirm, cancelAllConfirms, setConfirmFallback } from './confirm'
export type { ConfirmOptions, ConfirmRequest, ConfirmState } from './confirm'
export { toast, ToastHost, toastStore, dismissToast, pauseToasts, resumeToasts, MAX_TOASTS } from './toast'
export type { ToastOptions, ToastTone, ToastRecord, ToastAction, ToastState, ToastHostProps } from './toast'
export { Portal } from './Portal'
export type { PortalProps } from './Portal'

// Positioning & overlay plumbing (for custom overlays: command center, inspectors)
export { computePosition, availableSpace, parsePlacement, toPlacement, pointRect, toRect } from './positioning'
export type {
  Placement,
  Side as PlacementSide,
  Align as PlacementAlign,
  Rect as FloatingRect,
  Size as FloatingSize,
  PositionOptions,
  PositionResult,
} from './positioning'
export { useFloating } from './useFloating'
export type { UseFloatingOptions, FloatingState, FloatingAnchor, VirtualAnchor } from './useFloating'
export { useLayer, useOverlayFocus, useScrollLock, getTabbables, IGNORE_OUTSIDE_ATTR } from './layers'
export { mergeRefs, mergeProps, useMergedRefs } from './slot'
export { findTypeaheadMatch, useTypeahead } from './typeahead'
export {
  EASE_SETTLE,
  EASE_STANDARD,
  DUR as MOTION_DURATION,
  floatingMotion,
  tooltipMotion,
  dialogMotion,
  sheetMotion,
  scrimMotion,
} from './motion'
export type { MotionPreset } from './motion'

// Feedback & data marks
export { Badge } from './Badge'
export type { BadgeProps, BadgeTone, BadgeVariant } from './Badge'
export { toneClasses, toneFill, HUE_SUBTLE, HUE_SOLID, HUE_OUTLINE, HUE_TEXT, HUE_FILL } from './tones'
export { Tag, Chip } from './Tag'
export type { TagProps, ChipProps } from './Tag'
export { Kbd, KbdCombo } from './Kbd'
export type { KbdProps, KbdComboProps } from './Kbd'
export { Avatar, AvatarGroup, hueFor, initialsOf } from './Avatar'
export type { AvatarProps, AvatarGroupProps } from './Avatar'
export { Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'
export { Skeleton } from './Skeleton'
export type { SkeletonProps } from './Skeleton'
export { ProgressBar } from './ProgressBar'
export type { ProgressBarProps } from './ProgressBar'
export { Divider } from './Divider'
export type { DividerProps } from './Divider'
export { VisuallyHidden } from './VisuallyHidden'
export type { VisuallyHiddenProps } from './VisuallyHidden'
export { DynamicIcon, getIcon, isIconName, resolveIconName, ICONS, ICON_ALIASES, PICKABLE_ICONS } from './DynamicIcon'
export type { DynamicIconProps, IconName } from './DynamicIcon'

// Layout
export { Surface, Card, Panel } from './Surface'
export type { SurfaceProps, SurfaceVariant, CardProps, PanelProps } from './Surface'
export { SectionHeader, PageHeader, Kicker } from './Headers'
export type { SectionHeaderProps, PageHeaderProps } from './Headers'
export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from './Toolbar'
export type { ToolbarProps } from './Toolbar'
export { EmptyState, ErrorState } from './States'
export type { EmptyStateProps, ErrorStateProps } from './States'
export { ListItem, NavItem } from './ListItem'
export type { ListItemProps, NavItemProps } from './ListItem'
export { SplitPane } from './SplitPane'
export type { SplitPaneProps } from './SplitPane'
export { ScrollArea } from './ScrollArea'
export type { ScrollAreaProps } from './ScrollArea'

// Theme
export { ThemeProvider, useTheme, resolveTheme } from './theme'
export type { ThemeProviderProps, ResolvedTheme } from './theme'
