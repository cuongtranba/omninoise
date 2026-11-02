import { ThreeCanvas } from "@remotion/three"
import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"

import { THEME_3D } from "../color"
import { packetPhases, turntableRotation } from "../motion-math"

type Vec3 = [number, number, number]

export type SpaceCamera = {
  position: Vec3
  fov?: number
}

export type Turntable = {
  /** 0.35 turns a full revolution in roughly 34 seconds at 30fps. */
  degreesPerFrame?: number
  startDegrees?: number
}

export const Space: React.FC<{
  name: string
  camera?: SpaceCamera
  turntable?: boolean | Turntable
  /** Height of the band the scene occupies. Defaults to the whole frame. */
  height?: number
  children?: React.ReactNode
}> = ({
  name,
  camera = { position: [0, 0, 5], fov: 75 },
  turntable,
  height,
  children,
}) => {
  const { width: frameWidth, height: frameHeight } = useVideoConfig()
  const frame = useCurrentFrame()
  const spin = turntable === true ? {} : turntable || undefined
  const canvasHeight = height ?? frameHeight

  // A turntable spins the contents, not the camera, because that keeps framing
  // and safe area fixed while every face comes around — and it carries surfaces
  // through the fixed lights, which is what gives an unlit face its edge.
  // Camera moves are a separate tool and work fine: pass a frame-derived
  // `camera.position` to dolly or pull back (see references/3d.md).
  const rotation = spin
    ? turntableRotation(frame, spin.degreesPerFrame ?? 0.35, spin.startDegrees ?? 0)
    : 0

  // A WebGL canvas cannot flex: it needs pixel dimensions, and measuring the
  // container would mean a ResizeObserver that never fires in a headless
  // render. So the canvas is always frame-width and explicitly tall, then
  // centred on the frame — which keeps the 3D origin at the centre of the band
  // no matter what safe-area padding the Stage applies around it.
  return (
    <div
      data-remotion-interactive={name}
      style={{ position: "relative", width: "100%", height: canvasHeight }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: frameWidth,
          height: canvasHeight,
        }}
      >
        <ThreeCanvas
          width={frameWidth}
          height={canvasHeight}
          style={{ backgroundColor: "transparent" }}
          camera={{ fov: camera.fov ?? 75, position: camera.position }}
        >
          {/*
            Keyed for this kit's dark theme: at ambient 0.15 a THEME.surface
            object is within a few percent of the background and reads as a
            silhouette. The fill from behind-left is what gives an unlit face an
            edge, so a cube stays a cube when the turntable carries it away
            from the key.
          */}
          <ambientLight color={THEME_3D.foreground} intensity={0.4} />
          <directionalLight color={THEME_3D.foreground} position={[5, 5, 5]} intensity={1} />
          <directionalLight
            color={THEME_3D.foreground}
            position={[-4, 2, -3]}
            intensity={0.35}
          />
          <group rotation={[0, rotation, 0]}>{children}</group>
        </ThreeCanvas>
      </div>
    </div>
  )
}

/**
 * The object vocabulary.
 *
 * A sphere and three cubes is not a picture of anything — a viewer reads
 * "shapes", spends the scene wondering which is which, and the 3D has bought
 * nothing a bulleted list would not. Infrastructure has conventional forms, and
 * borrowing them is what lets a shot be understood before the sentence
 * explaining it finishes: a stack of platters is a datastore, a slotted upright
 * is a machine, a fanned sheaf is a queue.
 *
 * Compose these; reach for a bare `<mesh>` only when the thing genuinely has no
 * conventional form.
 */

/** A datastore: stacked platters, the shape every database diagram has used for forty years. */
export const Datastore: React.FC<{
  position?: Vec3
  radius?: number
  height?: number
  platters?: number
  color?: string
  accent?: string
}> = ({
  position = [0, 0, 0],
  radius = 0.95,
  height = 1.15,
  platters = 3,
  color = THEME_3D.surface,
  accent = THEME_3D.accent,
}) => {
  const slab = height / platters
  return (
    <group position={position}>
      {Array.from({ length: platters }, (_, i) => (
        <mesh key={i} position={[0, (i - (platters - 1) / 2) * slab, 0]}>
          <cylinderGeometry args={[radius, radius, slab * 0.68, 56]} />
          <meshStandardMaterial
            color={color}
            emissive={accent}
            emissiveIntensity={i === platters - 1 ? 0.5 : 0.16}
            roughness={0.55}
          />
        </mesh>
      ))}
    </group>
  )
}

/** A machine: an upright chassis with slotted units across its face. */
export const Rack: React.FC<{
  position?: Vec3
  rotation?: number
  units?: number
  width?: number
  height?: number
  depth?: number
  color?: string
  accent?: string
  /** Light the slot at this index, for the region currently being spoken about. */
  activeUnit?: number
}> = ({
  position = [0, 0, 0],
  rotation = 0,
  units = 4,
  width = 1,
  height = 1.5,
  depth = 0.72,
  color = THEME_3D.muted,
  accent = THEME_3D.accent,
  activeUnit,
}) => {
  const pitch = height / (units + 1)
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>

      {/*
        Units on both faces. A rack really does have them front and rear, and on
        a turntable it means the object reads as a rack at every angle instead of
        presenting a blank slab for two thirds of the revolution.
      */}
      {Array.from({ length: units }, (_, i) =>
        [depth / 2 + 0.012, -depth / 2 - 0.012].map((z, face) => (
          <mesh key={`${i}-${face}`} position={[0, height / 2 - pitch * (i + 1), z]}>
            <boxGeometry args={[width * 0.78, pitch * 0.42, 0.03]} />
            <meshStandardMaterial
              color={THEME_3D.surface}
              emissive={accent}
              emissiveIntensity={i === activeUnit ? 1.1 : 0.22}
              roughness={0.4}
            />
          </mesh>
        )),
      )}
    </group>
  )
}

/**
 * A link between two objects with something travelling it — the 3D counterpart
 * of `<Diagram flow>`. The line states the relationship; the packets state that
 * it carries, which is the difference between a topology and a dataflow.
 */
export const Beam: React.FC<{
  from: Vec3
  to: Vec3
  at?: number
  /** Frames for one packet to cross the link. */
  cycleFrames?: number
  packets?: number
  color?: string
  radius?: number
  /**
   * World-space distance to pull each end back toward the middle, as
   * `[fromEnd, toEnd]` or one value for both.
   *
   * Endpoints are usually object *centres*, which buries the first and last
   * stretch of the link inside the meshes it joins — packets spawn invisible
   * and pop out partway. Inset by roughly each object's radius so the link runs
   * surface to surface.
   */
  inset?: number | [number, number]
}> = ({
  from,
  to,
  at = 0,
  cycleFrames = 60,
  packets = 2,
  color = THEME_3D.accent,
  radius = 0.07,
  inset = 0,
}) => {
  const frame = useCurrentFrame()
  const phases = packetPhases(frame, at, cycleFrames, packets)

  const [insetFrom, insetTo] = Array.isArray(inset) ? inset : [inset, inset]
  const span: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const length = Math.hypot(...span) || 1
  const unit: Vec3 = [span[0] / length, span[1] / length, span[2] / length]
  // Clamped so an over-large inset shrinks the link rather than inverting it.
  const headroom = Math.max(0, length - 0.001)
  const startAt = Math.min(insetFrom, headroom)
  const endAt = length - Math.min(insetTo, Math.max(0, headroom - startAt))

  const start: Vec3 = [
    from[0] + unit[0] * startAt,
    from[1] + unit[1] * startAt,
    from[2] + unit[2] * startAt,
  ]
  const end: Vec3 = [
    from[0] + unit[0] * endAt,
    from[1] + unit[1] * endAt,
    from[2] + unit[2] * endAt,
  ]

  const positions = React.useMemo(
    () => new Float32Array([...start, ...end]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start[0], start[1], start[2], end[0], end[1], end[2]],
  )

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={THEME_3D.border} transparent opacity={0.55} />
      </lineSegments>

      {frame >= at
        ? phases.map((t, i) => (
            <mesh
              key={i}
              position={[
                start[0] + (end[0] - start[0]) * t,
                start[1] + (end[1] - start[1]) * t,
                start[2] + (end[2] - start[2]) * t,
              ]}
            >
              <sphereGeometry args={[radius, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
            </mesh>
          ))
        : null}
    </group>
  )
}
