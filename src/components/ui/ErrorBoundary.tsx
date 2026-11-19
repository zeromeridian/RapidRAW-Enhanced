import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown instead of the children after an error; nothing by default. */
  fallback?: ReactNode;
  /** A new value renders the children again, e.g. the next photo. */
  resetKey?: unknown;
  /** Names the part in the log. */
  name: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Keeps an error in one part of the window from unmounting the whole app (a blank window):
 * the part is left out until `resetKey` changes.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed and was left out:`, error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    return this.state.hasError ? (this.props.fallback ?? null) : this.props.children;
  }
}
