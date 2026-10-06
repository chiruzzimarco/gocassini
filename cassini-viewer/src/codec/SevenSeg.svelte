<script lang="ts">
  // LCD seven-segment digits, with the unlit segments faintly visible the way
  // a real display ghosts them.
  let { value }: { value: string } = $props();

  // Segments a–g, each a polygon in a 10×18 cell.
  const SEGMENTS: Record<string, string> = {
    a: "1.5,0.5 8.5,0.5 7.2,2 2.8,2",
    b: "9,1 9,8.4 7.6,7.6 7.6,2.4",
    c: "9,9.6 9,17 7.6,15.6 7.6,10.4",
    d: "1.5,17.5 8.5,17.5 7.2,16 2.8,16",
    e: "1,9.6 1,17 2.4,15.6 2.4,10.4",
    f: "1,1 1,8.4 2.4,7.6 2.4,2.4",
    g: "1.6,9 2.8,8.2 7.2,8.2 8.4,9 7.2,9.8 2.8,9.8",
  };
  const DIGITS: Record<string, string> = {
    "0": "abcdef",
    "1": "bc",
    "2": "abdeg",
    "3": "abcdg",
    "4": "bcfg",
    "5": "acdfg",
    "6": "acdefg",
    "7": "abc",
    "8": "abcdefg",
    "9": "abcdfg",
  };

  const cells = $derived.by(() => {
    const out: { lit: string; dot: boolean }[] = [];
    for (const ch of value) {
      if (ch === "." && out.length) out[out.length - 1].dot = true;
      else out.push({ lit: DIGITS[ch] ?? "", dot: false });
    }
    return out;
  });
</script>

<svg class="seven-seg" viewBox="0 0 {cells.length * 13} 19" role="img" aria-label={value}>
  {#each cells as cell, i (i)}
    <g transform="translate({i * 13 + 1.5} 0.5) skewX(-6)">
      {#each Object.entries(SEGMENTS) as [name, points] (name)}
        <polygon {points} class:lit={cell.lit.includes(name)} />
      {/each}
      <rect x="10.2" y="16" width="1.6" height="1.6" class:lit={cell.dot} />
    </g>
  {/each}
</svg>

<style>
  .seven-seg {
    display: block;
    height: 100%;
    width: auto;
  }
  polygon,
  rect {
    fill: var(--g1);
    opacity: 0.45;
  }
  .lit {
    fill: var(--g4);
    opacity: 1;
    filter: drop-shadow(0 0 0.6px var(--g3));
  }
</style>
