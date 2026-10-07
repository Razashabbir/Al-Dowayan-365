import { Component } from 'react'

/** Shows what went wrong instead of a blank white page when a page crashes while drawing. */
export default class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Page crashed:', error, info?.componentStack) }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    return (
      <div className="page">
        <div className="card stack">
          <h2>This page could not be shown</h2>
          <div className="alert bad" data-no-tr>{String(e.message || e)}</div>
          <details><summary className="muted small">Technical details</summary>
            <pre className="small" data-no-tr style={{ whiteSpace: 'pre-wrap' }}>{String(e.stack || '').slice(0, 2000)}</pre></details>
          <div className="row"><button className="primary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button onClick={() => location.reload()}>Reload the app</button></div>
        </div>
      </div>
    )
  }
}
