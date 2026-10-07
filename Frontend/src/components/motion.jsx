/* Framer Motion helpers shared by KPI tiles, charts and reports.
   Everything respects the OS "reduce motion" setting (no movement, values shown at once). */
import { animate, motion, useInView, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export { motion }
const EASE = [0.22, 1, 0.36, 1]

/** Position of an element among its siblings - used to stagger cards without a wrapper. */
function useSiblingIndex(ref) {
  const [i, setI] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (el?.parentElement) setI(Array.prototype.indexOf.call(el.parentElement.children, el))
  }, [ref])
  return i
}

/** Card that rises and fades in when it scrolls into view, staggered with its siblings, lifts on hover. */
export function MotionCard({ as = 'div', className, children, hover = true, delay, ...rest }) {
  const ref = useRef(null)
  const idx = useSiblingIndex(ref)
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag ref={ref} className={className}
         initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
         whileInView={{ opacity: 1, y: 0, scale: 1 }}
         viewport={{ once: true, amount: 0.15 }}
         transition={{ duration: 0.55, ease: EASE, delay: delay ?? Math.min(idx, 8) * 0.07 }}
         whileHover={hover && !reduce ? { y: -4, boxShadow: '0 14px 30px rgba(0,0,0,.10)' } : undefined}
         {...rest}>
      {children}
    </Tag>
  )
}

/** Fade + slide-in block for charts and report sections. */
export function Reveal({ children, className, delay = 0, y = 24, as = 'div' }) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag className={className} initial={reduce ? false : { opacity: 0, y }}
         whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }}
         transition={{ duration: 0.6, ease: EASE, delay }}>
      {children}
    </Tag>
  )
}

/** Counts a formatted value up from 0 (or from the previous value): "7,065,000", "30.2%", "45 days", "(1,234)". */
export function CountUp({ value, duration = 1.1 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const prev = useRef(0)
  const text = value == null ? '' : String(value)
  const m = text.match(/^(.*?)(-?[\d,]*\.?\d+)(.*)$/)
  const target = m ? Number(m[2].replace(/,/g, '')) : NaN
  const decimals = m && m[2].includes('.') ? m[2].split('.')[1].length : 0
  const grouped = m ? m[2].includes(',') || Math.abs(target) >= 1000 : false

  useEffect(() => {
    const el = ref.current
    if (!el || !m || !Number.isFinite(target) || reduce || !inView) return
    const fmtN = (v) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
    const ctl = animate(prev.current, target, {
      duration, ease: EASE,
      onUpdate: (v) => { el.textContent = `${m[1]}${fmtN(v)}${m[3]}` },
    })
    prev.current = target
    return () => ctl.stop()
  }, [text, inView, reduce]) // eslint-disable-line react-hooks/exhaustive-deps

  return <span ref={ref} className="countup">{text}</span>
}

/** Table body whose rows slide in one after the other (first rows only, so long tables stay fast). */
export const rowMotion = (i, reduce) => (reduce ? {} : {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.35, ease: EASE, delay: Math.min(i, 30) * 0.025 },
})

export { useReducedMotion }
