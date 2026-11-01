import {
  cloneElement,
  createElement,
  isValidElement,
  useCallback,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
  type SyntheticEvent,
} from 'react'
import { cn } from '@/lib/cn'

type PossibleRef<T> = Ref<T> | undefined | null

/** Assign a value to any kind of ref. */
export function setRef<T>(ref: PossibleRef<T>, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref && typeof ref === 'object') (ref as { current: T | null }).current = value
}

/** Combine refs into one callback ref. */
export function mergeRefs<T>(...refs: PossibleRef<T>[]): RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) setRef(ref, value)
  }
}

/** Memoized `mergeRefs` (stable while the refs are stable). */
export function useMergedRefs<T>(...refs: PossibleRef<T>[]): RefCallback<T> {
  return useCallback(mergeRefs(...refs), refs)
}

type AnyProps = Record<string, unknown>

/**
 * Merge slot props into a child's props: event handlers chain (child first; ours is skipped when the child
 * calls preventDefault), classNames merge, styles shallow-merge, refs combine, everything else: ours wins
 * unless the child set it explicitly (aria/data attributes from the child are kept).
 */
export function mergeProps(childProps: AnyProps, slotProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...childProps }
  for (const key of Object.keys(slotProps)) {
    const ours = slotProps[key]
    const theirs = childProps[key]
    if (/^on[A-Z]/.test(key) && typeof ours === 'function') {
      merged[key] =
        typeof theirs === 'function'
          ? (event: SyntheticEvent, ...rest: unknown[]) => {
              ;(theirs as (...a: unknown[]) => void)(event, ...rest)
              if (!event?.defaultPrevented) (ours as (...a: unknown[]) => void)(event, ...rest)
            }
          : ours
    } else if (key === 'className') {
      merged[key] = cn(ours as string, theirs as string)
    } else if (key === 'style') {
      merged[key] = { ...(ours as object), ...(theirs as object) }
    } else if (key === 'ref') {
      merged[key] = theirs ? mergeRefs(theirs as Ref<unknown>, ours as Ref<unknown>) : ours
    } else if (key === 'aria-describedby' && theirs) {
      merged[key] = [theirs, ours].filter(Boolean).join(' ')
    } else if (theirs === undefined) {
      merged[key] = ours
    }
  }
  return merged
}

/** Clone a single element child with merged slot props. Non-elements are wrapped in a span. */
export function slot(child: ReactNode, slotProps: AnyProps): ReactElement {
  if (isValidElement(child)) {
    const props = child.props as AnyProps
    return cloneElement(child as ReactElement<AnyProps>, mergeProps(props, slotProps))
  }
  return createElement('span', slotProps, child)
}
