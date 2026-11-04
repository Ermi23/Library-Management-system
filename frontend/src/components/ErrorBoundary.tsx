import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Last line of defence: a rendering error shows a recovery screen instead of a blank white page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this page</h1>
          <p className="mt-2 text-sm text-slate-600">{this.state.error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => (window.location.href = '/')}>
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
