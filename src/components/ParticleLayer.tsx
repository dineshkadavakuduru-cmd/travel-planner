"use client";

import { useEffect, useState } from "react";
import Particles from "@tsparticles/react";
import { particlesReady } from "@/lib/particles";

export default function ParticleLayer() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let mounted = true;
    void particlesReady().then(() => {
      if (mounted) setInitialized(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!initialized) return null;

  return (
    <Particles
      id="tsparticles"
      options={{
        fullScreen: false,
        background: {
          color: {
            value: "transparent",
          },
        },
        fpsLimit: 30,
        interactivity: {
          events: {
            onClick: {
              enable: false,
            },
            onHover: {
              enable: false,
            },
            resize: { enable: true },
          },
        },
        particles: {
          color: {
            value: "#C9A227",
          },
          links: {
            enable: false,
          },
          move: {
            direction: "none",
            enable: true,
            outModes: {
              default: "out",
            },
            random: true,
            speed: 0.3,
            straight: false,
          },
          number: {
            value: 40,
          },
          opacity: {
            value: {
              min: 0.1,
              max: 0.3,
            },
          },
          shape: {
            type: "circle",
          },
          size: {
            value: {
              min: 1,
              max: 3,
            },
          },
        },
        detectRetina: true,
      }}
      className="absolute inset-0 pointer-events-none"
    />
  );
}
