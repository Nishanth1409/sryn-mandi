import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, ContactShadows, Sparkles } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'
import { usePrefs } from '../i18n/PrefsContext'

type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>('desktop')
  useEffect(() => {
    const sync = () => {
      const w = window.innerWidth
      if (w < 640) setBp('mobile')
      else if (w < 1024) setBp('tablet')
      else setBp('desktop')
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])
  return bp
}

/** Oval arecanut — slightly elongated, muted shell color */
function ArecaNut({
  position,
  scale = 1,
  hue = 0.075,
}: {
  position: [number, number, number]
  scale?: number
  hue?: number
}) {
  const ref = useRef<Mesh>(null)
  useFrame((state) => {
    if (!ref.current) return
    ref.current.rotation.y = state.clock.elapsedTime * 0.25 + position[0] * 0.4
  })

  return (
    <mesh ref={ref} position={position} scale={[scale * 0.72, scale, scale * 0.78]} castShadow>
      <sphereGeometry args={[0.22, 28, 28]} />
      <meshStandardMaterial
        color={new THREE.Color().setHSL(hue, 0.55, 0.42)}
        roughness={0.55}
        metalness={0.05}
        emissive={new THREE.Color().setHSL(hue, 0.4, 0.1)}
        emissiveIntensity={0.2}
      />
    </mesh>
  )
}

function PalmFrond({
  angle,
  length = 2.4,
  tilt = 0.35,
}: {
  angle: number
  length?: number
  tilt?: number
}) {
  const group = useRef<Group>(null)
  useFrame((state) => {
    if (!group.current) return
    group.current.rotation.z =
      Math.sin(state.clock.elapsedTime * 0.7 + angle) * 0.04
  })

  const leaflets = useMemo(() => {
    const items: { z: number; len: number; w: number; side: number; color: string }[] = []
    const count = 14
    for (let i = 1; i <= count; i++) {
      const t = i / count
      const z = t * length
      const taper = 1 - t * 0.55
      items.push({
        z,
        len: 0.55 * taper,
        w: 0.1 * taper,
        side: i % 2 === 0 ? 1 : -1,
        color: i % 3 === 0 ? '#2a9a58' : '#34b56a',
      })
    }
    return items
  }, [length])

  return (
    <group ref={group} rotation={[tilt, angle, 0]}>
      {/* rachis */}
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.028, length, 8]} />
        <meshStandardMaterial color="#1a5a38" roughness={0.7} />
      </mesh>
      {leaflets.map((l, i) => (
        <mesh
          key={i}
          position={[l.side * l.w * 2.2, 0.02, l.z]}
          rotation={[0.15, l.side * 0.35, l.side * 0.55]}
          scale={[l.w, 0.04, l.len]}
          castShadow
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial
            color={l.color}
            roughness={0.75}
            side={THREE.DoubleSide}
            emissive="#0a2e1c"
            emissiveIntensity={0.1}
          />
        </mesh>
      ))}
    </group>
  )
}

function NutCluster({ position }: { position: [number, number, number] }) {
  return (
    <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.25}>
      <group position={position}>
        <ArecaNut position={[0, 0, 0]} scale={1} hue={0.07} />
        <ArecaNut position={[0.16, -0.08, 0.06]} scale={0.9} hue={0.08} />
        <ArecaNut position={[-0.12, -0.1, 0.1]} scale={0.85} hue={0.065} />
        <ArecaNut position={[0.06, -0.18, -0.06]} scale={0.78} hue={0.09} />
        <ArecaNut position={[-0.04, -0.22, 0.08]} scale={0.72} hue={0.07} />
        <ArecaNut position={[0.14, -0.26, 0.04]} scale={0.68} hue={0.085} />
      </group>
    </Float>
  )
}

function ArecaPalm({
  position = [0, 0, 0] as [number, number, number],
  scale = 1,
  sway = 1,
}: {
  position?: [number, number, number]
  scale?: number
  sway?: number
}) {
  const group = useRef<Group>(null)
  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    group.current.rotation.y = Math.sin(t * 0.12 * sway) * 0.06
    group.current.rotation.z = Math.sin(t * 0.18 * sway) * 0.025
  })

  const fronds = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        angle: (i / 9) * Math.PI * 2 + 0.2,
        length: 2.1 + (i % 3) * 0.18,
        tilt: 0.28 + (i % 4) * 0.05,
      })),
    [],
  )

  return (
    <group ref={group} position={position} scale={scale}>
      {/* tapered trunk */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.16, 3.2, 14]} />
        <meshStandardMaterial color="#5a3d2a" roughness={0.92} />
      </mesh>
      {/* soft trunk segments */}
      {[0.55, 1.1, 1.65, 2.2].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <torusGeometry args={[0.12 + y * 0.008, 0.018, 6, 14]} />
          <meshStandardMaterial color="#46301f" roughness={1} />
        </mesh>
      ))}
      {/* crown */}
      <group position={[0, 3.15, 0]}>
        {fronds.map((f, i) => (
          <PalmFrond key={i} angle={f.angle} length={f.length} tilt={f.tilt} />
        ))}
        <NutCluster position={[0.28, -0.35, 0.15]} />
      </group>
    </group>
  )
}

function FloatingAccentNuts({ count }: { count: number }) {
  const nuts = useMemo(() => {
    const all: [number, number, number, number][] = [
      [1.8, 1.5, 1.4, 0.55],
      [2.6, 2.2, 0.4, 0.45],
      [0.9, 2.6, 1.1, 0.4],
      [3.1, 1.3, -0.3, 0.5],
      [2.2, 2.9, -0.8, 0.38],
      [1.3, 1.1, 1.8, 0.42],
    ]
    return all.slice(0, count)
  }, [count])

  return (
    <>
      {nuts.map(([x, y, z, s], i) => (
        <Float key={i} speed={0.9 + i * 0.1} rotationIntensity={0.35} floatIntensity={0.4}>
          <ArecaNut position={[x, y, z]} scale={s} hue={0.07 + (i % 3) * 0.01} />
        </Float>
      ))}
    </>
  )
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <circleGeometry args={[10, 48]} />
      <meshStandardMaterial color="#071f16" roughness={1} />
    </mesh>
  )
}

function CameraRig({ breakpoint }: { breakpoint: Breakpoint }) {
  const { camera } = useThree()
  const target = useMemo(() => {
    if (breakpoint === 'mobile') return { look: new THREE.Vector3(0.2, 1.5, 0), base: new THREE.Vector3(0.1, 2.4, 6.8), parallax: 0.25 }
    if (breakpoint === 'tablet') return { look: new THREE.Vector3(1.1, 1.55, 0), base: new THREE.Vector3(-0.2, 2.2, 5.8), parallax: 0.45 }
    return { look: new THREE.Vector3(2.4, 1.55, 0), base: new THREE.Vector3(-0.35, 2.05, 5.15), parallax: 0.7 }
  }, [breakpoint])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const px = state.pointer.x * target.parallax
    const py = state.pointer.y * target.parallax * 0.45
    const driftX = Math.sin(t * 0.14) * 0.25
    const driftY = Math.sin(t * 0.2) * 0.1
    camera.position.lerp(
      new THREE.Vector3(
        target.base.x + px + driftX,
        target.base.y + py + driftY,
        target.base.z,
      ),
      0.05,
    )
    camera.lookAt(target.look)
  })
  return null
}

function SceneContent({ breakpoint }: { breakpoint: Breakpoint }) {
  const layout = useMemo(() => {
    if (breakpoint === 'mobile') {
      return {
        group: [0.15, -0.2, -0.4] as [number, number, number],
        palms: [{ p: [0, 0, 0] as [number, number, number], s: 0.95, sway: 1 }],
        nuts: 3,
        sparkles: 36,
      }
    }
    if (breakpoint === 'tablet') {
      return {
        group: [1.0, -0.15, 0] as [number, number, number],
        palms: [
          { p: [0, 0, 0] as [number, number, number], s: 1.05, sway: 1 },
          { p: [1.9, 0, -1.1] as [number, number, number], s: 0.82, sway: 0.8 },
        ],
        nuts: 4,
        sparkles: 48,
      }
    }
    return {
      group: [2.55, -0.1, 0.15] as [number, number, number],
      palms: [
        { p: [0, 0, 0] as [number, number, number], s: 1.12, sway: 1 },
        { p: [-1.5, 0, -1.3] as [number, number, number], s: 0.88, sway: 0.85 },
        { p: [1.7, 0, -1.0] as [number, number, number], s: 0.92, sway: 0.9 },
      ],
      nuts: 5,
      sparkles: 64,
    }
  }, [breakpoint])

  const { theme } = usePrefs()
  const sky = theme === 'light' ? '#d8ebe0' : '#04140f'
  const groundFog = theme === 'light' ? '#c5ddd0' : '#04140f'

  return (
    <>
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[groundFog, theme === 'light' ? 8 : 6.5, theme === 'light' ? 18 : 16]} />
      <ambientLight intensity={theme === 'light' ? 0.85 : 0.62} />
      <hemisphereLight
        args={
          theme === 'light' ? ['#e8fff2', '#7a9e88', 0.7] : ['#a8e0c0', '#163528', 0.55]
        }
      />
      <directionalLight
        castShadow
        position={[5, 8, 4]}
        intensity={theme === 'light' ? 1.35 : 1.75}
        color="#fff0c8"
        shadow-mapSize={[1024, 1024]}
      />
      <spotLight
        position={[3, 5, 2]}
        angle={0.5}
        penumbra={0.6}
        intensity={theme === 'light' ? 0.85 : 1.15}
        color="#f0c14b"
      />
      <pointLight position={[-2, 3, 1]} intensity={0.55} color="#4ecf8a" />

      <group position={layout.group}>
        {layout.palms.map((palm, i) => (
          <ArecaPalm key={i} position={palm.p} scale={palm.s} sway={palm.sway} />
        ))}
        <FloatingAccentNuts count={layout.nuts} />
        <Ground />
        <ContactShadows
          opacity={theme === 'light' ? 0.28 : 0.5}
          scale={12}
          blur={2.6}
          far={6}
          color="#020c08"
        />
      </group>

      <Sparkles
        count={layout.sparkles}
        scale={[9, 5, 9]}
        size={2.2}
        speed={0.28}
        color="#e8c56a"
        opacity={theme === 'light' ? 0.28 : 0.4}
      />
      <CameraRig breakpoint={breakpoint} />
    </>
  )
}

export function ArakaScene() {
  const breakpoint = useBreakpoint()

  return (
    <div className="scene-root" aria-hidden="true">
      <Canvas
        shadows
        dpr={breakpoint === 'mobile' ? [1, 1.25] : [1, 1.6]}
        camera={{
          position: breakpoint === 'mobile' ? [0.1, 2.4, 6.8] : [-0.6, 2.05, 5],
          fov: breakpoint === 'mobile' ? 42 : 38,
        }}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 1.22
        }}
        style={{ pointerEvents: 'auto', touchAction: 'none' }}
      >
        <Suspense fallback={null}>
          <SceneContent breakpoint={breakpoint} />
        </Suspense>
      </Canvas>
      <div className="scene-vignette" />
    </div>
  )
}
