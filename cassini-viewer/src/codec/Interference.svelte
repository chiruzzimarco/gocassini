<script lang="ts">
  import { onMount } from "svelte";

  // The codec's scan lines, as measured on footage of the game: a wide, soft
  // bright band drifting slowly down the picture and a thin sharp line moving
  // about twice as fast, overtaking it. Both always run top to bottom, on a
  // fixed cycle, and are driven by the page clock, so every portrait shows them
  // at the same height at the same moment. `active` is whether the call is open.
  let { active = false }: { active?: boolean } = $props();

  // Seconds per pass, and how much of the picture's height each one covers.
  const BAND_PERIOD = 7.6;
  const BAND_HEIGHT = 0.13;
  const LINE_PERIOD = 4.75; // the line crosses in LINE_TRAVEL, then is gone for the rest
  const LINE_TRAVEL = 3.3;

  const W = 104;
  const H = 160;
  let canvas: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    let strength = 0;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Fade in when the call opens and out when it closes, rather than snap.
      strength += ((active ? 1 : 0) - strength) * 0.1;
      ctx.clearRect(0, 0, W, H);
      if (strength < 0.01) return;
      const t = now / 1000;

      // The band: enters from above, leaves below, and comes round again.
      const band = BAND_HEIGHT * H;
      const by = ((t % BAND_PERIOD) / BAND_PERIOD) * (H + band) - band;
      const grad = ctx.createLinearGradient(0, by, 0, by + band);
      grad.addColorStop(0, "rgba(200, 255, 190, 0)");
      grad.addColorStop(0.35, `rgba(200, 255, 190, ${0.27 * strength})`);
      grad.addColorStop(0.65, `rgba(200, 255, 190, ${0.27 * strength})`);
      grad.addColorStop(1, "rgba(200, 255, 190, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, by, W, band);

      // The line: a sharp pass down the picture, then a pause before the next.
      const phase = t % LINE_PERIOD;
      if (phase < LINE_TRAVEL) {
        const ly = Math.round((phase / LINE_TRAVEL) * H);
        ctx.fillStyle = `rgba(215, 255, 205, ${0.4 * strength})`;
        ctx.fillRect(0, ly, W, 1);
        ctx.fillStyle = `rgba(215, 255, 205, ${0.12 * strength})`;
        ctx.fillRect(0, ly - 1, W, 1);
        ctx.fillRect(0, ly + 1, W, 1);
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
