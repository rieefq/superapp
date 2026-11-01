import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/ui'

/**
 * A section-level error boundary (§5.4.14): a failing view shows an ErrorState with Retry while the
 * rest of the workspace keeps working.
 */
export class BoardBoundary extends Component<{ name: string; children: ReactNode; compact?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[agents] ${this.props.name} failed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 md:p-6">
          <ErrorState
            compact={this.props.compact}
            title={`Couldn’t show ${this.props.name}`}
            message="Something in this view failed to draw. Your runs and agents are safe; retry, or open another view."
            details={this.state.error.stack ?? this.state.error.message}
            onRetry={() => this.setState({ error: null })}
            retryLabel="Retry"
          />
        </div>
      )
    }
    return this.props.children
  }
}
