"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Sparkles } from "@react-three/drei";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";

const ACCENT_COLOR = "#22c55e";
const ACCENT_DEEP_COLOR = "#16a34a";

const CORE_ROTATION_SPEED = 0.08;
const SHELL_ROTATION_SPEED = -0.05;
const POINTER_INFLUENCE = 0.35;
const POINTER_SMOOTHING = 0.06;

function AmbientCore() {
  const coreRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (coreRef.current) {
      coreRef.current.rotation.y += delta * CORE_ROTATION_SPEED;
      coreRef.current.rotation.x += delta * CORE_ROTATION_SPEED * 0.6;
    }
    if (shellRef.current) {
      shellRef.current.rotation.y += delta * SHELL_ROTATION_SPEED;
    }
    if (groupRef.current) {
      const targetX = state.pointer.y * POINTER_INFLUENCE;
      const targetY = state.pointer.x * POINTER_INFLUENCE;
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        targetX,
        POINTER_SMOOTHING,
      );
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        targetY,
        POINTER_SMOOTHING,
      );
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.6}>
        <mesh ref={coreRef} scale={1.35}>
          <icosahedronGeometry args={[1, 2]} />
          <MeshDistortMaterial
            color={ACCENT_COLOR}
            emissive={ACCENT_DEEP_COLOR}
            emissiveIntensity={0.4}
            roughness={0.25}
            metalness={0.4}
            distort={0.32}
            speed={1.6}
            transparent
            opacity={0.9}
          />
        </mesh>
        <mesh ref={shellRef} scale={1.85}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial color={ACCENT_COLOR} wireframe transparent opacity={0.12} />
        </mesh>
      </Float>
      <Sparkles
        count={70}
        scale={[5, 5, 3]}
        size={2.2}
        speed={0.25}
        color={ACCENT_COLOR}
        opacity={0.5}
      />
    </group>
  );
}

function StaticCore() {
  return (
    <group>
      <mesh scale={1.35}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          color={ACCENT_COLOR}
          emissive={ACCENT_DEEP_COLOR}
          emissiveIntensity={0.3}
          roughness={0.3}
          metalness={0.35}
        />
      </mesh>
      <mesh scale={1.85}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color={ACCENT_COLOR} wireframe transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

export function Ova3DScene() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 0, 6], fov: 35 }}
      className="!pointer-events-none"
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[3, 3, 4]} intensity={12} color={ACCENT_COLOR} />
      <pointLight position={[-3, -2, -3]} intensity={6} color={ACCENT_DEEP_COLOR} />
      {prefersReducedMotion ? <StaticCore /> : <AmbientCore />}
    </Canvas>
  );
}
