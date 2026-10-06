// Codec-style portraits: a closed-mouth and an open-mouth frame per speaker.
// Either styled from a photo (a webcam frame, an avatar) or generated from the
// speaker id when nobody supplied one.

export interface Portrait {
  quiet: string;
  talk: string;
  // A full illustration rather than a pixel sprite: scale it smoothly.
  smooth?: boolean;
}

export const SPRITE_W = 96;
export const SPRITE_H = 120;

const PALETTE: [number, number, number][] = [
  [4, 20, 10],
  [18, 70, 36],
  [52, 140, 70],
  [120, 210, 120],
  [200, 255, 190],
];

// Photos get a longer ramp: flat painted tones, near-black shadows, pale
// highlights. No dithering; MGS portraits are cel-shaded, not halftoned.
const PHOTO_PALETTE: [number, number, number][] = [
  [2, 10, 5],
  [12, 42, 22],
  [28, 82, 44],
  [56, 130, 70],
  [100, 182, 104],
  [158, 226, 150],
  [214, 255, 204],
];

// Where the mouth sits, as a fraction of the sprite height. Rows below it drop
// to open the mouth.
const PHOTO_MOUTH_Y = 0.7;

type Levels = Uint8Array; // palette index per pixel, row-major SPRITE_W × SPRITE_H

function toDataUrl(levels: Levels, palette = PALETTE): string {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SPRITE_W, SPRITE_H);
  for (let i = 0; i < levels.length; i++) {
    const [r, g, b] = palette[levels[i]];
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Drops everything below the mouth line by a few pixels and darkens the gap. */
function openMouth(levels: Levels, mouthY: number, mouthWidth: number): Levels {
  const out = levels.slice();
  const y0 = Math.round(SPRITE_H * mouthY);
  const drop = 3;
  for (let y = SPRITE_H - 1; y >= y0 + drop; y--) {
    out.copyWithin(y * SPRITE_W, (y - drop) * SPRITE_W, (y - drop + 1) * SPRITE_W);
  }
  const x0 = Math.round(SPRITE_W * (0.5 - mouthWidth / 2));
  const x1 = Math.round(SPRITE_W * (0.5 + mouthWidth / 2));
  for (let y = y0; y < y0 + drop; y++) {
    for (let x = x0; x < x1; x++) out[y * SPRITE_W + x] = 0;
  }
  return out;
}

/** Inks the boundary between tones at least two steps apart, on the darker side. */
function ink(levels: Uint8Array, w: number, h: number): Uint8Array {
  const out = levels.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (const j of [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1]) {
        if (j >= 0 && Math.abs(levels[i] - levels[j]) >= 2) out[levels[i] < levels[j] ? i : j] = 0;
      }
    }
  }
  return out;
}

function blur(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SPRITE_W || yy >= SPRITE_H) continue;
          sum += src[yy * SPRITE_W + xx];
          n++;
        }
      }
      out[y * SPRITE_W + x] = sum / n;
    }
  }
  return out;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// ── From a photo ─────────────────────────────────────────────────────────────

export async function portraitFromImage(source: Blob | string): Promise<Portrait> {
  const img = new Image();
  img.src = typeof source === "string" ? source : URL.createObjectURL(source);
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;

  // Codec portraits are tight on the face: forehead to chin, a hint of collar.
  // Fixed guess for a centred webcam shot; a face detector would do better.
  const portraitLike = h > w * 1.1;
  const cropH = portraitLike ? w * 0.8 * (SPRITE_H / SPRITE_W) : h * 0.62;
  const cropW = cropH * (SPRITE_W / SPRITE_H);
  const cx = w / 2;
  const cy = portraitLike ? cropH / 2 + h * 0.04 : h * 0.44;

  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_W;
  canvas.height = SPRITE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx - cropW / 2, cy - cropH / 2, cropW, cropH, 0, 0, SPRITE_W, SPRITE_H);
  const rgba = ctx.getImageData(0, 0, SPRITE_W, SPRITE_H).data;

  const N = SPRITE_W * SPRITE_H;
  const chan = (c: number) => {
    const out: Float32Array = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = rgba[i * 4 + c];
    return blur(blur(out));
  };
  // Smoothing first, so tones come out as flat painted areas, not webcam noise.
  const [red, green, blue] = [chan(0), chan(1), chan(2)];
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.299 * red[i] + 0.587 * green[i] + 0.114 * blue[i];

  // Background: grow from the top and upper sides through small colour steps,
  // like a magic wand. Codec portraits sit on a dark, flat backdrop, and a
  // bright wall or window is what ruins the exposure otherwise.
  const bg = new Uint8Array(N);
  const queue: number[] = [];
  const seed = (i: number) => {
    if (!bg[i]) {
      bg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < SPRITE_W; x++) seed(x);
  for (let y = 0; y < SPRITE_H * 0.6; y++) {
    seed(y * SPRITE_W);
    seed(y * SPRITE_W + SPRITE_W - 1);
  }
  const step = (i: number, j: number) =>
    Math.abs(red[i] - red[j]) + Math.abs(green[i] - green[j]) + Math.abs(blue[i] - blue[j]);
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % SPRITE_W;
    for (const j of [x > 0 ? i - 1 : -1, x < SPRITE_W - 1 ? i + 1 : -1, i - SPRITE_W, i + SPRITE_W]) {
      if (j >= 0 && j < N && !bg[j] && step(i, j) < 14) {
        bg[j] = 1;
        queue.push(j);
      }
    }
  }
  // A wand that swallowed most of the frame found no edge around the person;
  // keep the photo whole rather than erase them.
  let bgCount = 0;
  for (let i = 0; i < N; i++) bgCount += bg[i];
  if (bgCount > N * 0.75) bg.fill(0);

  // Expose for the face: percentiles over foreground pixels in the middle.
  const face: number[] = [];
  for (let y = Math.round(SPRITE_H * 0.15); y < SPRITE_H * 0.75; y++) {
    for (let x = Math.round(SPRITE_W * 0.25); x < SPRITE_W * 0.75; x++) {
      if (!bg[y * SPRITE_W + x]) face.push(lum[y * SPRITE_W + x]);
    }
  }
  // Hair and clothes are dark too; anchor black low and white on the
  // brightest skin so the face itself spans the light half of the ramp.
  const lo = percentile(face, 0.05);
  const span = Math.max(1, percentile(face, 0.97) - lo);

  // Hard key light from the left, shadow falling to the right.
  const tone = new Float32Array(N);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const i = y * SPRITE_W + x;
      let v = Math.min(1, Math.max(0, (lum[i] - lo) / span));
      v *= 1.12 - 0.38 * (x / SPRITE_W);
      tone[i] = Math.min(1, Math.max(0, (v - 0.04) / 0.9) ** 0.8);
    }
  }

  // Ink: the silhouette and the strongest edges inside it become black lines.
  const edge = new Float32Array(N);
  const inside: number[] = [];
  for (let y = 1; y < SPRITE_H - 1; y++) {
    for (let x = 1; x < SPRITE_W - 1; x++) {
      const at = (dx: number, dy: number) => tone[(y + dy) * SPRITE_W + x + dx];
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      const i = y * SPRITE_W + x;
      edge[i] = Math.hypot(gx, gy);
      if (!bg[i]) inside.push(edge[i]);
    }
  }
  const inkAt = Math.max(0.45, percentile(inside.length ? inside : edge, 0.9));

  const top = PHOTO_PALETTE.length - 1;
  const levels: Levels = new Uint8Array(N);
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const i = y * SPRITE_W + x;
      if (bg[i]) {
        // Flat backdrop with a faint diagonal light, like the codec frames.
        levels[i] = x + y < SPRITE_W * 0.55 && (x + y) % 2 === 0 ? 2 : 1;
        continue;
      }
      const silhouette =
        (x > 0 && bg[i - 1]) || (x < SPRITE_W - 1 && bg[i + 1]) || (y > 0 && bg[i - SPRITE_W]) ||
        (y < SPRITE_H - 1 && bg[i + SPRITE_W]);
      levels[i] = silhouette || edge[i] > inkAt ? 0 : Math.min(top, Math.floor(tone[i] * (top + 0.999)));
    }
  }
  return {
    quiet: toDataUrl(levels, PHOTO_PALETTE),
    talk: toDataUrl(openMouth(levels, PHOTO_MOUTH_Y, 0.14), PHOTO_PALETTE),
  };
}

// ── Generated from the speaker id ───────────────────────────────────────────

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generatedPortrait(seed: string): Portrait {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const S = 2; // draw on a 48×60 grid, scale ×2 to the sprite
  const W = SPRITE_W / S;
  const H = SPRITE_H / S;
  const grid = new Uint8Array(W * H);
  const set = (x: number, y: number, v: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[Math.floor(y) * W + Math.floor(x)] = v;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, v: number | ((x: number, y: number) => number)) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) set(x, y, typeof v === "number" ? v : v(x, y));
      }
    }
  };
  const rect = (x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, v);
  };
  const dither = (x: number, y: number, a: number, b: number) => ((x + y) % 2 === 0 ? a : b);

  // Backdrop: mid-dark with a soft light from the upper left, so dark hair and
  // clothes still read as a silhouette against it.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, x + y < 34 ? dither(x, y, 2, 1) : 1);

  const cx = W / 2;
  const faceY = 25;
  const rx = 13 + r() * 2;
  const ry = 16 + r() * 2;
  const lit = (x: number) => (x > cx + rx * 0.35 ? 2 : 3);

  // Shoulders, collar, neck.
  ellipse(cx, H + 4, 22, 16, (x, y) => (x > cx + 8 ? 0 : dither(x, y, 0, 1)));
  rect(Math.round(cx - 4), faceY + 10, 8, 12, 2);
  rect(Math.round(cx - 4), faceY + 10, 3, 12, 3);

  // Face, side-lit.
  ellipse(cx, faceY, rx, ry, (x) => lit(x));
  set(cx - rx - 0.5, faceY + 1, 2);
  set(cx + rx + 0.5, faceY + 1, 1);

  // Hair.
  const hair = pick(["short", "long", "bald", "spiky", "bandana", "slick"]);
  const hairTone = pick([0, 0, 2]);
  if (hair !== "bald") ellipse(cx, faceY - ry * 0.55, rx + 1.5, ry * 0.6, hairTone);
  if (hair === "long") {
    rect(Math.round(cx - rx - 2), faceY - 6, 4, 22, hairTone);
    rect(Math.round(cx + rx - 2), faceY - 6, 4, 22, hairTone);
  }
  if (hair === "spiky") {
    for (let i = -3; i <= 3; i++) for (let k = 0; k < 4; k++) set(cx + i * 3 + (k % 2), faceY - ry - 2 + k, hairTone);
  }
  if (hair === "bandana") rect(Math.round(cx - rx - 1), Math.round(faceY - ry * 0.45), Math.round(rx * 2 + 2), 3, 2);
  if (hair === "slick") for (let x = Math.round(cx - rx); x < cx + rx; x += 3) set(x, faceY - ry * 0.7, 2);
  // Re-open the forehead under the hairline.
  ellipse(cx, faceY + 2, rx - 1, ry - 4, (x) => lit(x));

  // Brows, eyes, glasses.
  const eyeY = faceY - 1;
  const eyeDx = 4 + Math.round(r());
  const browTilt = pick([0, 1]);
  for (const side of [-1, 1]) {
    const ex = Math.round(cx + side * eyeDx);
    rect(ex - 2, eyeY - 3 + (side === 1 ? browTilt : 0), 5, 1, 0);
    rect(ex - 1, eyeY, 3, 1, 0);
    set(ex + (side === -1 ? -1 : 1), eyeY, 4);
  }
  if (r() < 0.35) {
    for (const side of [-1, 1]) {
      const ex = Math.round(cx + side * eyeDx);
      rect(ex - 3, eyeY - 2, 7, 1, 0);
      rect(ex - 3, eyeY + 2, 7, 1, 0);
      rect(ex - 3, eyeY - 2, 1, 5, 0);
      rect(ex + 3, eyeY - 2, 1, 5, 0);
    }
    rect(Math.round(cx - 1), eyeY - 1, 2, 1, 0);
  }

  // Nose.
  rect(Math.round(cx), eyeY + 2, 1, 4, 2);
  rect(Math.round(cx) - 1, eyeY + 6, 3, 1, 2);

  // Beard or stubble.
  const beard = pick(["none", "none", "stubble", "beard", "moustache"]);
  const mouthY = eyeY + 9;
  if (beard === "stubble" || beard === "beard") {
    ellipse(cx, faceY + ry * 0.6, rx * 0.85, ry * 0.45, (x, y) =>
      beard === "beard" ? dither(x, y, 1, lit(x) - 1) : dither(x, y, lit(x), 2),
    );
  }
  if (beard === "moustache" || beard === "beard") rect(Math.round(cx - 3), mouthY - 1, 7, 1, hairTone);

  const closed = grid.slice();
  rect(Math.round(cx - 2), mouthY, 5, 1, 1);
  const quietGrid = grid.slice();
  grid.set(closed);
  rect(Math.round(cx - 2), mouthY, 5, 3, 0);
  rect(Math.round(cx - 1), mouthY + 2, 3, 1, 1);
  const talkGrid = grid;

  const upscale = (g: Uint8Array): Levels => {
    const out = new Uint8Array(SPRITE_W * SPRITE_H);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) out[y * SPRITE_W + x] = g[Math.floor(y / S) * W + Math.floor(x / S)];
    }
    return out;
  };
  return {
    quiet: toDataUrl(upscale(ink(quietGrid, W, H))),
    talk: toDataUrl(upscale(ink(talkGrid, W, H))),
  };
}
