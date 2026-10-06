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
//                      "talk": "chima-talk.jpg" } ] }
// `talk` is optional; without it the same picture is used while they talk.

import type { Portrait } from "./portrait";

interface Entry {
  names: string[];
  image: string;
  talk?: string;
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
  for (const entry of entries) {
    const quiet = new URL(entry.image, url).toString();
    const talk = entry.talk ? new URL(entry.talk, url).toString() : quiet;
    for (const name of entry.names) byName.set(norm(name), { quiet, talk, smooth: true });
  }
  // A label matches on the whole name, or on its first word ("Alex Rossi").
  return (label) => byName.get(norm(label)) ?? byName.get(norm(label.split(/\s+/)[0] ?? ""));
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
