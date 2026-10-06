<script lang="ts">
  import { onMount } from "svelte";

  // Transmission noise over the portrait of whoever is talking: thin horizontal
  // lines flickering across it, now and then a torn band, and a faint bar
  // rolling down the tube. It follows the voice: louder speech, more noise;
  // silence, a clean picture.
  let { active = false, level = 0 }: { active?: boolean; level?: number } = $props();

  const W = 104;
  const H = 160;
  let canvas: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let tick = 0;
    let roll = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      // About 30 fps is plenty for noise, and halves the work.
      if (tick++ % 2) return;
      ctx.clearRect(0, 0, W, H);
      if (!active) return;
      const intensity = Math.min(1, 0.45 + level * 1.4);

      // Lines: mostly bright, some dark, each a random stretch of one row.
      const lines = Math.round(4 + intensity * 14);
      for (let i = 0; i < lines; i++) {
        const y = Math.floor(Math.random() * H);
        const x = Math.floor(Math.random() * W * 0.35);
        const len = Math.floor(W * (0.4 + Math.random() * 0.6));
        const alpha = (0.3 + Math.random() * 0.5) * intensity;
        ctx.fillStyle = Math.random() < 0.3 ? `rgba(0, 0, 0, ${alpha})` : `rgba(200, 255, 190, ${alpha})`;
        ctx.fillRect(x, y, len, Math.random() < 0.2 ? 2 : 1);
      }

      // Now and then a torn band: a few rows of dense speckle.
      if (Math.random() < 0.3 * intensity) {
        const y = Math.floor(Math.random() * (H - 6));
        const rows = 2 + Math.floor(Math.random() * 4);
        for (let r = 0; r < rows; r++) {
          for (let x = 0; x < W; x += 1 + Math.floor(Math.random() * 3)) {
            const v = Math.random();
            ctx.fillStyle = `rgba(${v > 0.5 ? "220, 255, 210" : "0, 0, 0"}, ${0.35 * intensity})`;
            ctx.fillRect(x, y + r, 1, 1);
          }
        }
      }

      // A faint bar rolling slowly down the picture.
      roll = (roll + 1.5) % (H + 24);
      const grad = ctx.createLinearGradient(0, roll - 24, 0, roll);
      grad.addColorStop(0, "rgba(200, 255, 190, 0)");
      grad.addColorStop(1, `rgba(200, 255, 190, ${0.1 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, roll - 24, W, 24);
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
