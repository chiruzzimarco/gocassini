<script lang="ts">
  import { onMount } from "svelte";

  // Transmission noise over the portrait of whoever is talking: a few soft
  // horizontal lines drifting steadily up or down the picture, as on the
  // codec. They brighten with the voice and fade out in silence.
  let { active = false, level = 0 }: { active?: boolean; level?: number } = $props();

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
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // Ease towards the target so the lines fade rather than snap.
      const target = active ? Math.min(1, 0.55 + level * 1.2) : 0;
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
