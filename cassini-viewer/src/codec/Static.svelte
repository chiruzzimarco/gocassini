<script lang="ts">
  import { onMount } from "svelte";

  // A couple of frames of colour TV snow over a portrait, then a hard cut to
  // the picture, as the game does when someone new comes on. Mounted fresh
  // (via {#key}) for every cut. With `endless`, black-and-white snow that never
  // stops: the portrait of a speaker there is no picture of.
  let { durationMs = 140, endless = false }: { durationMs?: number; endless?: boolean } = $props();

  const W = 52;
  const H = 80;
  let canvas: HTMLCanvasElement;
  let opacity = $state(1);

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = endless ? 0 : (now - start) / durationMs;
      if (t >= 1) {
        opacity = 0;
        return;
      }
      for (let i = 0; i < W * H; i++) {
        const v = Math.random() * 255;
        if (endless) {
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v * 0.85;
        } else {
          img.data[i * 4] = Math.min(255, v * (0.6 + Math.random() * 0.6));
          img.data[i * 4 + 1] = Math.min(255, v * (0.6 + Math.random() * 0.6));
          img.data[i * 4 + 2] = Math.min(255, v * (0.6 + Math.random() * 0.6));
        }
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(frame);
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
    image-rendering: pixelated;
  }
</style>
