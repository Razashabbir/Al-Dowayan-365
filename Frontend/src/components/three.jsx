/* Lazy entry points for the Three.js parts: they load only when shown, and fall back to nothing
   (or the 2D chart) when WebGL is missing, the OS asks for reduced motion, or the scene fails. */
import { Component, lazy, Suspense } from 'react'
import { useReducedMotion } from 'framer-motion'

const HeroScene = lazy(() => import('./HeroScene'))
const Bars3DLazy = lazy(() => import('./Bars3D'))

let webgl
export function hasWebGL() {
  if (webgl === undefined) {
    try {
      const c = document.createElement('canvas')
      webgl = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
    } catch { webgl = false }
  }
  return webgl
}

class Guard extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e) { console.warn('3D view disabled:', e?.message) }
  render() { return this.state.failed ? (this.props.fallback ?? null) : this.props.children }
}

/** Animated 3D layer inside a .hero header. */
export function Hero3D() {
  const reduce = useReducedMotion()
  if (reduce || !hasWebGL()) return null
  return <Guard><Suspense fallback={null}><HeroScene /></Suspense></Guard>
}

/** 3D monthly bar chart; `fallback` (the 2D chart) is shown if 3D cannot run. */
export function Chart3D({ fallback, ...props }) {
  if (!hasWebGL()) return fallback
  return <Guard fallback={fallback}><Suspense fallback={<div className="muted" style={{ height: props.height || 300 }}>Loading 3D…</div>}><Bars3DLazy {...props} /></Suspense></Guard>
}
