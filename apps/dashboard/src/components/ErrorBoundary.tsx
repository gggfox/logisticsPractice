import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback({ error, reset: this.reset })
    }

    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900/50 dark:bg-red-950/40">
          <h2 className="text-lg font-semibold text-red-900 dark:text-red-200">
            Something went wrong
          </h2>
          <p className="mt-2 text-sm text-red-800 dark:text-red-300">
            {error.message || 'An unexpected error occurred while rendering this view.'}
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-red-100 p-2 text-xs text-red-900 dark:bg-red-900/30 dark:text-red-200">
            {error.stack?.split('\n').slice(0, 6).join('\n')}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
