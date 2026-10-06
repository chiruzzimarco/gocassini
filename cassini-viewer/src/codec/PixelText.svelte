<script lang="ts">
  // The codec's tab lettering: heavy pixel letters with two-pixel strokes,
  // drawn as a bitmap rather than set in a font, so every letter has the same
  // height and weight. Only the letters the tabs use are defined.
  // `stretch` widens the letters: the codec's are wider than they are tall.
  // `weight` picks the stroke: bold (two pixels) or medium (one-pixel uprights).
  let {
    text,
    gap = 1,
    stretch = 1,
    weight = "bold",
  }: { text: string; gap?: number; stretch?: number; weight?: "bold" | "medium" } = $props();

  const GLYPHS: Record<string, string[]> = {
    P: ["#####.", "##..##", "##..##", "#####.", "##....", "##....", "##...."],
    T: ["######", "######", "..##..", "..##..", "..##..", "..##..", "..##.."],
    M: ["##...##", "###.###", "#######", "##.#.##", "##...##", "##...##", "##...##"],
    E: ["######", "##....", "##....", "#####.", "##....", "##....", "######"],
    O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
    R: ["#####.", "##..##", "##..##", "#####.", "##.##.", "##..##", "##..##"],
    Y: ["##..##", "##..##", ".####.", "..##..", "..##..", "..##..", "..##.."],
  };
  // A lighter cut (one-pixel uprights), for a label that should read less
  // heavy: PTT. Letters without one fall back to the bold.
  const MEDIUM: Record<string, string[]> = {
    P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    T: ["#####", "#####", "..#..", "..#..", "..#..", "..#..", "..#.."],
  };
  const ROWS = 7;

  const layout = $derived.by(() => {
    const cells: { x: number; y: number }[] = [];
    let x = 0;
    for (const ch of text.toUpperCase()) {
      const glyph = (weight === "medium" ? MEDIUM[ch] : undefined) ?? GLYPHS[ch];
      if (!glyph) {
        x += 3 + gap; // an unknown character leaves a space
        continue;
      }
      glyph.forEach((row, y) => [...row].forEach((c, dx) => c === "#" && cells.push({ x: x + dx, y })));
      x += glyph[0].length + gap;
    }
    return { cells, width: Math.max(1, x - gap) };
  });
</script>

<svg
  class="pixel-text"
  viewBox="0 0 {layout.width} {ROWS}"
  preserveAspectRatio="none"
  style="aspect-ratio: {layout.width * stretch} / {ROWS}"
  role="img"
  aria-label={text}
  shape-rendering="crispEdges"
>
  {#each layout.cells as c (`${c.x},${c.y}`)}
    <rect x={c.x} y={c.y} width="1.02" height="1.02" />
  {/each}
</svg>

<style>
  .pixel-text {
    display: block;
    height: 100%;
    width: auto;
    fill: currentColor;
    overflow: visible;
  }
</style>
