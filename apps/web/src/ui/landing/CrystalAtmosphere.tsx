import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function FloatingShard({
  position,
  scale,
  speed,
  color,
}: {
  position: [number, number, number];
  scale: number;
  speed: number;
  color: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.18,
    metalness: 0.08,
    transmission: 0.42,
    thickness: 0.9,
    transparent: true,
    opacity: 0.42,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    emissive: color,
    emissiveIntensity: 0.08,
  }), [color]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime * speed;
    mesh.rotation.x = t * 0.18;
    mesh.rotation.y = t * 0.28;
    mesh.position.y = position[1] + Math.sin(t) * 0.16;
  });

  return (
    <mesh ref={meshRef} position={position} scale={scale} material={material}>
      <octahedronGeometry args={[1, 1]} />
    </mesh>
  );
}

function CrystalField() {
  return (
    <>
      <color attach="background" args={['#050508']} />
      <ambientLight intensity={0.18} />
      <pointLight color="#ff5b0a" intensity={22} position={[-4, 2.5, 3]} distance={8} />
      <pointLight color="#20d9ff" intensity={18} position={[4, -1, 2]} distance={8} />
      <spotLight color="#ffffff" intensity={3.6} position={[0, 5, 4]} angle={0.42} penumbra={1} />
      <FloatingShard position={[-3.6, 1.4, -4]} scale={1.05} speed={0.42} color="#ff5b0a" />
      <FloatingShard position={[3.8, -1.1, -5]} scale={1.18} speed={0.36} color="#20d9ff" />
      <FloatingShard position={[0.2, 0.1, -6.2]} scale={1.6} speed={0.28} color="#ffffff" />
      <FloatingShard position={[-1.8, -2.2, -4.8]} scale={0.68} speed={0.52} color="#FACC15" />
      <FloatingShard position={[2.2, 2.0, -5.6]} scale={0.76} speed={0.48} color="#67E8F9" />
    </>
  );
}

export function CrystalAtmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-45 mix-blend-screen" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 4], fov: 46 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <CrystalField />
        </Suspense>
      </Canvas>
    </div>
  );
}
