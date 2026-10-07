/* 3D monthly chart (Three.js / React Three Fiber): one pair of bars per month that springs up,
   slow auto-rotation, drag to turn, hover a bar for its value. Month labels are HTML that follow the bars. */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { fmt } from '../api'

const css = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function Bar({ x, z, height, color, delay, onHover, label }) {
  const ref = useRef()
  const mat = useRef()
  const [hot, setHot] = useState(false)
  const start = useRef(null)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (start.current == null) start.current = t
    const k = Math.max(0, Math.min(1, (t - start.current - delay) / 0.9))
    const spring = 1 - Math.cos(k * Math.PI * 1.5) * Math.exp(-4 * k)       // overshoot then settle
    const h = Math.max(0.001, height * (k >= 1 ? 1 : spring))
    ref.current.scale.y = h
    ref.current.position.y = h / 2
    mat.current.emissiveIntensity += ((hot ? 0.45 : 0) - mat.current.emissiveIntensity) * 0.2
  })
  return (
    <mesh ref={ref} position={[x, 0, z]}
          onPointerOver={(e) => { e.stopPropagation(); setHot(true); onHover(label) }}
          onPointerOut={() => { setHot(false); onHover(null) }}>
      <boxGeometry args={[0.32, 1, 0.32]} />
      <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0} roughness={0.45} metalness={0.15} />
    </mesh>
  )
}

function Scene({ data, series, labelRefs, onHover }) {
  const group = useRef()
  const { camera, size, gl } = useThree()
  const drag = useRef({ on: false, x: 0, rot: -0.5 })
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Math.abs(d[s.key] || 0))))
  const v = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const el = gl.domElement
    if (!el) return
    const down = (e) => { drag.current.on = true; drag.current.x = e.clientX }
    const move = (e) => { if (drag.current.on) { drag.current.rot += (e.clientX - drag.current.x) * 0.01; drag.current.x = e.clientX } }
    const up = () => { drag.current.on = false }
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [gl])

  useFrame((_, dt) => {
    if (!drag.current.on) drag.current.rot += dt * 0.08
    group.current.rotation.y += (Math.sin(drag.current.rot) * 0.45 - group.current.rotation.y) * 0.08
    // month labels follow the bars
    data.forEach((d, i) => {
      const el = labelRefs.current[i]
      if (!el) return
      v.set((i - (data.length - 1) / 2) * 0.95, -0.25, 0.5).applyMatrix4(group.current.matrixWorld).project(camera)
      el.style.transform = `translate(-50%, -50%) translate(${(v.x * 0.5 + 0.5) * size.width}px, ${(-v.y * 0.5 + 0.5) * size.height}px)`
    })
  })

  return (
    <group ref={group} position={[0, -1.3, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[data.length * 0.95 + 1, 2.4]} />
        <meshStandardMaterial color={css('--grid', '#e5e7eb')} transparent opacity={0.6} />
      </mesh>
      {data.map((d, i) => series.map((s, j) => (
        <Bar key={`${i}-${s.key}`} x={(i - (data.length - 1) / 2) * 0.95 + (j - (series.length - 1) / 2) * 0.36} z={0}
             height={(Math.abs(d[s.key] || 0) / max) * 3} color={s.color} delay={i * 0.06 + j * 0.03}
             label={`${d.name} · ${s.name}: ${fmt(d[s.key] || 0)}`} onHover={onHover} />
      )))}
    </group>
  )
}

export default function Bars3D({ data, series, height = 300 }) {
  const labelRefs = useRef([])
  const [tip, setTip] = useState(null)
  const cols = series.map((s, i) => ({ ...s, color: s.color || css(`--c${i + 1}`, ['#0d9488', '#d97706', '#4f46e5'][i]) }))
  return (
    <div className="bars3d" style={{ height }}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.6, 7.2], fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} />
        <directionalLight position={[-5, 3, -2]} intensity={0.4} />
        <Scene data={data} series={cols} labelRefs={labelRefs} onHover={setTip} />
      </Canvas>
      {data.map((d, i) => <span key={d.name} ref={(el) => { labelRefs.current[i] = el }} className="bars3d-label">{d.name}</span>)}
      <div className="bars3d-legend">
        {cols.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>)}
        <span className="muted">{tip || 'Hover a bar · drag to turn'}</span>
      </div>
    </div>
  )
}
