/* Three.js / React Three Fiber scene behind the page headers: a living 3D bar chart and drifting
   particles that follow the mouse. Loaded lazily (see Hero3D) so the rest of the app stays light. */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

const COLS = 14
const ROWS = 4

function Bars() {
  const mesh = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeds = useMemo(() => Array.from({ length: COLS * ROWS }, () => Math.random() * Math.PI * 2), [])
  const born = useRef(null)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (born.current == null) born.current = t
    const grow = Math.min(1, (t - born.current) / 1.6)          // bars rise from the floor on first paint
    const ease = 1 - Math.pow(1 - grow, 3)
    let i = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const h = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.9 + seeds[i] + c * 0.45))) * (1.1 + r * 0.35) * ease + 0.02
        dummy.position.set((c - COLS / 2) * 0.62, h / 2 - 1.1, -r * 0.75)
        dummy.scale.set(1, h, 1)
        dummy.updateMatrix()
        mesh.current.setMatrixAt(i++, dummy.matrix)
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[null, null, COLS * ROWS]}>
      <boxGeometry args={[0.4, 1, 0.4]} />
      <meshStandardMaterial color="#ffffff" transparent opacity={0.28} roughness={0.35} metalness={0.1} />
    </instancedMesh>
  )
}

function Particles({ count = 160 }) {
  const ref = useRef()
  const positions = useMemo(() => {
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 12
      p[i * 3 + 1] = (Math.random() - 0.3) * 4
      p[i * 3 + 2] = (Math.random() - 0.7) * 4
    }
    return p
  }, [count])
  useFrame((_, dt) => {
    ref.current.rotation.y += dt * 0.04
    const a = ref.current.geometry.attributes.position
    for (let i = 0; i < count; i++) {
      let y = a.getY(i) + dt * 0.18
      if (y > 2.6) y = -1.2
      a.setY(i, y)
    }
    a.needsUpdate = true
  })
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial size={0.05} color="#ffffff" transparent opacity={0.75} sizeAttenuation />
    </points>
  )
}

/** Camera sways gently and leans towards the mouse. */
function Rig() {
  const { camera, pointer } = useThree()
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    camera.position.x += (pointer.x * 0.8 + Math.sin(t * 0.15) * 0.6 - camera.position.x) * 0.04
    camera.position.y += (0.9 + pointer.y * 0.35 - camera.position.y) * 0.04
    camera.lookAt(0.6, -0.3, -1)
  })
  return null
}

export default function HeroScene() {
  return (
    <Canvas className="hero-canvas" dpr={[1, 1.5]} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
            camera={{ position: [0, 0.9, 4.2], fov: 45 }} eventSource={typeof document !== 'undefined' ? document.body : undefined}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 4]} intensity={1.4} />
      <group position={[2.4, 0, 0]} rotation={[0, -0.35, 0]}>
        <Bars />
      </group>
      <Particles />
      <Rig />
    </Canvas>
  )
}
