import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { errorActionFor } from '../api/error-actions'
import { ErrorState } from './shared/ErrorState'

/**
 * Per-section render error boundary (feature A15).
 *
 * Each route/section gets its own boundary so a render crash in one
 * screen (Director, Studio, …) never takes down the navigation shell
 * or the other sections. The fallback reuses the shared `ErrorState`
 * and shows the action suggested for the error (retry / cancel /
 * support, mapped from `ApiError.code`); "Try again" remounts the
 * subtree by resetting the boundary.
 */

interface ErrorBoundaryProps {
  /** Section name for the fallback copy (e.g. "Studio"). */
  section: string
  children: ReactNode
}

interface ErrorBoundaryState {
  error: unknown
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Console is stripped from the production bundle by vite config;
    // in dev this gives engineers the component stack.
    console.error(`[${this.props.section}] render failed:`, error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error !== null) {
      const action = errorActionFor(error)
      return (
        <ErrorState
          className="m-4"
          title={`${this.props.section} hit an error`}
          error={error}
          suggestion={action.hint}
          onRetry={this.reset}
          retryLabel={action.kind === 'retry' ? action.label : 'Try again'}
        />
      )
    }
    return this.props.children
  }
}
