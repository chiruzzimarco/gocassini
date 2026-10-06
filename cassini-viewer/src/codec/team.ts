// Who gets which portrait.
//
//   a known face   a picture from the site's portraits/ folder, listed in
//                  portraits/portraits.json (kept out of git, like codec-sfx/)
//   anyone else    a pixel face generated from their speaker id (portrait.ts)
//   no one        white noise: an empty frame, or a speaker the recording
//                  could not name ("Speaker 1", "participant-XdnngcWg", …)
//
// portraits.json:
//   { "portraits": [ { "names": ["chima", "marco"], "image": "chima.jpg",
//                      "mouth": [0.54, 0.575, 0.12] } ] }
// While someone talks the player alternates their picture with a talking one:
// `talk` names a ready-made image; otherwise `mouth` (centre x, lip line y and
// width, as fractions of the picture) lets one be drawn by dropping the jaw a
// little. With neither, the same picture is used throughout.

import type { Portrait } from "./portrait";

interface Entry {
  names: string[];
  image: string;
  talk?: string;
  mouth?: [number, number, number];
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export type TeamPortraits = (label: string) => Portrait | undefined;

/** Loads the site's known faces; resolves to a lookup that finds none if there are none. */
export async function loadTeamPortraits(): Promise<TeamPortraits> {
  const url = new URL("portraits/portraits.json", document.baseURI);
  let entries: Entry[] = [];
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entries = ((await res.json()) as { portraits?: Entry[] }).portraits ?? [];
  } catch (e) {
    console.info(`codec: no team portraits at ${url}`, e);
  }
  const byName = new Map<string, Portrait>();
  await Promise.all(
    entries.map(async (entry) => {
      const quiet = new URL(entry.image, url).toString();
      let talk = quiet;
      if (entry.talk) talk = new URL(entry.talk, url).toString();
      else if (entry.mouth) {
        try {
          talk = await openMouth(quiet, entry.mouth);
        } catch (e) {
          console.warn(`codec: could not draw a talking frame for ${entry.image}`, e);
        }
      }
      for (const name of entry.names) byName.set(norm(name), { quiet, talk, smooth: true });
    }),
  );
  // A label matches on the whole name, or on its first word ("Alex Rossi").
  return (label) => byName.get(norm(label)) ?? byName.get(norm(label.split(/\s+/)[0] ?? ""));
}

/**
 * A talking frame from a still: the area below the lip line slides down a
 * little, most at the middle of the mouth, fading to nothing at its corners and
 * towards the chin so nothing tears, and the gap is shaded as an open mouth.
 */
async function openMouth(src: string, [mx, my, mw]: [number, number, number]): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const cx = mx * W;
  const lip = my * H;
  const half = (mw * W) / 2;
  const drop = H * 0.016;
  const reachX = half * 1.5; // the jaw moves a bit wider than the lips
  const reachY = half * 2.2; // and down to about the chin
  const x0 = Math.max(0, Math.floor(cx - reachX));
  const x1 = Math.min(W, Math.ceil(cx + reachX));
  const y0 = Math.max(0, Math.floor(lip));
  const y1 = Math.min(H, Math.ceil(lip + reachY));
  const before = ctx.getImageData(0, 0, W, H);
  const after = ctx.getImageData(0, 0, W, H);
  for (let y = y0; y < y1; y++) {
    const down = 1 - (y - lip) / reachY;
    for (let x = x0; x < x1; x++) {
      const across = Math.cos((Math.PI / 2) * Math.min(1, Math.abs(x - cx) / reachX));
      const d = drop * across * Math.max(0, down);
      // Sample from higher up, blending the two nearest rows.
      const sy = Math.max(0, y - d);
      const r0 = Math.floor(sy);
      const t = sy - r0;
      const r1 = Math.min(H - 1, r0 + 1);
      for (let c = 0; c < 3; c++) {
        after.data[(y * W + x) * 4 + c] =
          before.data[(r0 * W + x) * 4 + c] * (1 - t) + before.data[(r1 * W + x) * 4 + c] * t;
      }
    }
  }
  ctx.putImageData(after, 0, 0);
  // The opening: a soft dark ellipse along the lip line.
  ctx.filter = `blur(${Math.max(1, drop * 0.3)}px)`;
  ctx.fillStyle = "rgba(2, 12, 6, 0.82)";
  ctx.beginPath();
  ctx.ellipse(cx, lip + drop * 0.45, half * 0.78, drop * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** A speaker label the recording made up rather than a person's name. */
export function isAnonymous(label: string | undefined): boolean {
  const l = (label ?? "").trim();
  return (
    l === "" ||
    /^(unknown|anonymous|guest|speaker|participant|user)(\s+(speaker|participant|user))?([\s_-]+[\w-]+)?$/i.test(l) ||
    /^s\d+$/i.test(l) ||
    // A generated handle: a word, a dash, then a run of mixed letters and digits.
    /^[a-z]+-(?=[A-Za-z0-9]*\d|[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{6,}$/.test(l)
  );
}
