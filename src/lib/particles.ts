"use client";

import { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

let ready: Promise<void> | null = null;

export function particlesReady(): Promise<void> {
  if (!ready) {
    ready = initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    });
  }
  return ready;
}
