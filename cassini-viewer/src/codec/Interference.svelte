<script lang="ts">
  import { onMount } from "svelte";

  // Interference on the link: now and then a few soft horizontal lines drift
  // up or down a portrait for a few seconds, then the picture clears again,
  // whoever is speaking. Each portrait gets its own random episodes; active
  // is whether the call is open at all.
  let { active = false }: { active?: boolean } = $props();

  // How long an episode lasts, and the clear spell between two, in ms.
  const EPISODE_MS = [1200, 4500];
  const CLEAR_MS = [1500, 7000];
  const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo);

  const W = 104;
  const H = 160;
  const LINES = 3;
  let canvas: HTMLCanvasElement;

  interface Line {
    y: number;
    speed: number; // canvas px per frame; negative runs up
    thickness: number;
    alpha: number;
  }

  const spawn = (y = Math.random() * H): Line => ({
    y,
    speed: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.6),
    thickness: 1 + Math.floor(Math.random() * 2),
    alpha: 0.18 + Math.random() * 0.17,
  });

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const lines = Array.from({ length: LINES }, () => spawn());
    let strength = 0;
    let raf = 0;
    let interfering = false;
    // Start clear, so the two portraits don't light up together on connect.
    let switchAt = performance.now() + between(CLEAR_MS);
    let peak = 1;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now >= switchAt) {
        interfering = !interfering;
        switchAt = now + between(interfering ? EPISODE_MS : CLEAR_MS);
        peak = 0.6 + Math.random() * 0.4;
      }
      // Ease towards the target so the lines fade rather than snap.
      const target = active && interfering ? peak : 0;
      strength += (target - strength) * 0.12;
      ctx.clearRect(0, 0, W, H);
      if (strength < 0.01) return;
      for (const line of lines) {
        line.y += line.speed;
        // Off one edge: come back in from the other, sometimes reshuffled.
        if (line.y < -4 || line.y > H + 4) {
          Object.assign(line, Math.random() < 0.3 ? spawn() : {}, { y: line.y < 0 ? H + 3 : -3 });
        }
        const a = line.alpha * strength;
        const y = Math.round(line.y);
        ctx.fillStyle = `rgba(200, 255, 190, ${a})`;
        ctx.fillRect(0, y, W, line.thickness);
        // A faint halo either side keeps the line soft.
        ctx.fillStyle = `rgba(200, 255, 190, ${a * 0.35})`;
        ctx.fillRect(0, y - 1, W, 1);
        ctx.fillRect(0, y + line.thickness, W, 1);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} width={W} height={H} aria-hidden="true"></canvas>

<style>
  canvas {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    pointer-events: none;
    image-rendering: pixelated;
  }
</style>
