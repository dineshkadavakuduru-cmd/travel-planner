"use client";

import { memo, useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

const CITIES = [
  { name: "New York", lat: 40.7128, lng: -74.006 },
  { name: "London", lat: 51.5074, lng: -0.1278 },
  { name: "Tokyo", lat: 35.6762, lng: 139.6503 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
  { name: "Dubai", lat: 25.2048, lng: 55.2708 },
  { name: "Singapore", lat: 1.3521, lng: 103.8198 },
  { name: "Paris", lat: 48.8566, lng: 2.3522 },
  { name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  { name: "Mumbai", lat: 19.076, lng: 72.8777 },
  { name: "Cairo", lat: 30.0444, lng: 31.2357 },
  { name: "Rio de Janeiro", lat: -22.9068, lng: -43.1729 },
  { name: "Moscow", lat: 55.7558, lng: 37.6173 },
  { name: "Beijing", lat: 39.9042, lng: 116.4074 },
  { name: "Cape Town", lat: -33.9249, lng: 18.4241 },
  { name: "Mexico City", lat: 19.4326, lng: -99.1332 },
];

const DEFAULT_ORIGIN = { lat: 40.7128, lng: -74.006 };

// Static geometry computed once at module load (not per render).
const CITY_POINTS: THREE.Vector3[] = CITIES.map((city) =>
  latLngToVector3(city.lat, city.lng, 2.01)
);

const CITY_POSITIONS = (() => {
  const arr = new Float32Array(CITY_POINTS.length * 3);
  CITY_POINTS.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;
  });
  return arr;
})();

const LAT_LINES: { positions: Float32Array; count: number }[] = (() => {
  const lines: { positions: Float32Array; count: number }[] = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts: THREE.Vector3[] = [];
    for (let lng = -180; lng <= 180; lng += 5) {
      pts.push(latLngToVector3(lat, lng, 2.005));
    }
    lines.push({
      positions: new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])),
      count: pts.length,
    });
  }
  return lines;
})();

const LNG_LINES: { positions: Float32Array; count: number }[] = (() => {
  const lines: { positions: Float32Array; count: number }[] = [];
  for (let lng = -180; lng < 180; lng += 30) {
    const pts: THREE.Vector3[] = [];
    for (let lat = -90; lat <= 90; lat += 5) {
      pts.push(latLngToVector3(lat, lng, 2.005));
    }
    lines.push({
      positions: new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])),
      count: pts.length,
    });
  }
  return lines;
})();

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function createArcPoints(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  radius: number,
  segments: number = 120
): THREE.Vector3[] {
  const start = latLngToVector3(origin.lat, origin.lng, radius);
  const end = latLngToVector3(destination.lat, destination.lng, radius);

  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const distance = start.distanceTo(end);
  mid.normalize().multiplyScalar(radius + distance * 0.4);

  const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
  return curve.getPoints(segments);
}

function GlobeArc({
  origin,
  destination,
  progress,
}: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number } | null;
  progress: number;
}) {
  const arcPoints = useMemo(() => {
    if (!destination) return [];
    return createArcPoints(origin, destination, 2);
  }, [origin, destination]);

  const totalLength = useMemo(() => {
    if (arcPoints.length < 2) return 0;
    let length = 0;
    for (let i = 1; i < arcPoints.length; i++) {
      length += arcPoints[i].distanceTo(arcPoints[i - 1]);
    }
    return length;
  }, [arcPoints]);

  const currentPoints = useMemo(() => {
    if (arcPoints.length < 2 || totalLength === 0) return [];
    const targetLength = progress * totalLength;
    const result: THREE.Vector3[] = [arcPoints[0]];
    let accumulated = 0;
    for (let i = 1; i < arcPoints.length; i++) {
      const segmentLength = arcPoints[i].distanceTo(arcPoints[i - 1]);
      if (accumulated + segmentLength >= targetLength) {
        const t = Math.max(0, Math.min(1, (targetLength - accumulated) / segmentLength));
        result.push(new THREE.Vector3().lerpVectors(arcPoints[i - 1], arcPoints[i], t));
        break;
      }
      result.push(arcPoints[i]);
      accumulated += segmentLength;
    }
    return result;
  }, [arcPoints, progress, totalLength]);

  const geometry = useMemo(() => {
    if (currentPoints.length < 2) return null;
    return new THREE.BufferGeometry().setFromPoints(currentPoints);
  }, [currentPoints]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  const line = useMemo(() => {
    if (!geometry) return null;
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#C9A227", transparent: true, opacity: 0.9 }));
  }, [geometry]);

  useEffect(() => {
    return () => {
      (line?.material as THREE.Material | undefined)?.dispose();
    };
  }, [line]);

  if (!destination || !line) return null;

  return <primitive object={line} />;
}

const GlobeInner = memo(function GlobeInner({ destination }: { destination: { lat: number; lng: number } | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [arcProgress, setArcProgress] = useState(0);
  const prevDestRef = useRef<{ lat: number; lng: number } | null>(null);
  const arcCompleteRef = useRef(false);

  useEffect(() => {
    if (destination !== prevDestRef.current) {
      prevDestRef.current = destination;
      setArcProgress(0);
      arcCompleteRef.current = false;
    }
  }, [destination]);

  useFrame((_, delta) => {
    if (meshRef.current && !destination) {
      meshRef.current.rotation.y += delta * 0.08;
    }

    if (destination && !arcCompleteRef.current) {
      setArcProgress((prev) => {
        const next = prev + delta / 1.2;
        if (next >= 1) {
          arcCompleteRef.current = true;
          return 1;
        }
        return next;
      });
    }
  });

  const cityPoints = CITY_POINTS;

  const latLines = LAT_LINES;

  const lngLines = LNG_LINES;

  const cityPositions = CITY_POSITIONS;

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[2, 64, 64]} />
        <meshStandardMaterial color="#0B1120" roughness={0.8} metalness={0.2} />
      </mesh>

      {latLines.map((line, i) => (
        <line key={`lat-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[line.positions, 3]}
              count={line.count}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#C9A227" transparent opacity={0.08} />
        </line>
      ))}

      {lngLines.map((line, i) => (
        <line key={`lng-${i}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[line.positions, 3]}
              count={line.count}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#C9A227" transparent opacity={0.08} />
        </line>
      ))}

      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[cityPositions, 3]}
            count={cityPoints.length}
          />
        </bufferGeometry>
        <pointsMaterial color="#C9A227" size={0.04} sizeAttenuation transparent opacity={0.8} />
      </points>

      <GlobeArc origin={DEFAULT_ORIGIN} destination={destination} progress={arcProgress} />
    </group>
  );
});

export default function GlobeScene({
  destination,
}: {
  destination: { lat: number; lng: number } | null;
}) {
  const label = destination
    ? `Animated globe showing flight path to selected destination`
    : `Decorative animated globe showing major world cities`;
  return (
    <div
      className="w-full h-full"
      role="img"
      aria-label={label}
      aria-hidden={false}
    >
      <span className="sr-only">
        Interactive globe visualization. Use the destination field to pick where to go;
        your itinerary details are listed in text below the form.
      </span>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x0B1120, 1);
        }}
      >
        <PerspectiveCamera makeDefault position={[0, 0, 6]} fov={45} />
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} />
        <pointLight position={[-10, -10, -10]} intensity={0.2} color="#C9A227" />
        <GlobeInner destination={destination} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI * 3 / 4}
          autoRotate={false}
        />
      </Canvas>
    </div>
  );
}
