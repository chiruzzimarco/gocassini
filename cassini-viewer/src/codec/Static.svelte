<script lang="ts">
  import { onMount } from "svelte";

  // Snow over a portrait, the way the codec shows it when someone new comes
  // on: a frame of dark, grainy noise flecked with colour, then the new face
  // fading in through it. Mounted fresh (via {#key}) for every cut. With
  // `endless`, the same snow never clears: the portrait of a speaker there is
  // no picture of.
  let { durationMs = 170, endless = false }: { durationMs?: number; endless?: boolean } = $props();

  // Low resolution, like the game's portraits; the grains run a little sideways.
  const W = 60;
  const H = 92;
  // Solid snow for the first part, then it thins out over the face.
  const SOLID = 0.25;
  let canvas: HTMLCanvasElement;
  let opacity = $state(1);

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const start = performance.now();
    let raf = 0;
    let tick = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = endless ? 0 : (now - start) / durationMs;
      if (t >= 1) {
        opacity = 0;
        cancelAnimationFrame(raf);
        return;
      }
      opacity = t < SOLID ? 1 : 1 - (t - SOLID) / (1 - SOLID);
      // About 30 new frames a second, like the footage.
      if (tick++ % 2) return;
      for (let y = 0; y < H; y++) {
        let x = 0;
        while (x < W) {
          // Grey-mint grain, mostly mid to dark, with only a hint of colour.
          const v = Math.random() ** 1.3 * 190 + 28;
          const r = v * 0.86 + (Math.random() - 0.5) * 34;
          const g = v + (Math.random() - 0.5) * 22;
          const b = v * 0.94 + (Math.random() - 0.5) * 34;
          const run = 1 + Math.floor(Math.random() * 3);
          for (let k = 0; k < run && x < W; k++, x++) {
            const i = (y * W + x) * 4;
            img.data[i] = Math.max(0, Math.min(255, r));
            img.data[i + 1] = Math.max(0, Math.min(255, g));
            img.data[i + 2] = Math.max(0, Math.min(255, b));
            img.data[i + 3] = 255;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
</script>

<canvas bind:this={canvas} width={W} height={H} style="opacity:{opacity}" aria-hidden="true"></canvas>

<style>
  canvas {
    position: absolute;
    inset: 0;
    z-index: 2;
    width: 100%;
    height: 100%;
    pointer-events: none;
    /* Soft, the way snow looks on a tube, rather than hard square pixels. */
    image-rendering: auto;
  }
</style>
