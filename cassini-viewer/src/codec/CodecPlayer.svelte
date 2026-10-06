<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { loadPortableArtifactFromAudioPath, type LoadedArtifact } from "../viewer/loadArtifact";
  import { StaticCatalogProvider, type DataProvider, type MeetingCatalogEntry } from "../viewer/dataProvider";
  import { formatMeetingDateShort, formatMeetingDuration } from "../viewer/catalog";
  import type { DisplayTranscriptBlock, TranscriptSpeaker } from "../core/types";
  import { generatedPortrait, portraitFromImage, type Portrait } from "./portrait";
  import { MUSIC_URL, connect, hangUp, loadSamples, ring, staticBurst, tuneBlip } from "./sfx";
  import SevenSeg from "./SevenSeg.svelte";
  import Static from "./Static.svelte";
  import "./codec.css";

  // The meeting list comes from the same provider the viewer browses with:
  // catalog.json standalone, the operator's list when embedded.
  // onexit, when given, is how the host closes the codec (the viewer's easter
  // egg); standalone there is nothing to exit to.
  let {
    provider = new StaticCatalogProvider(),
    onexit,
  }: { provider?: DataProvider; onexit?: () => void } = $props();

  // A finished line stays on screen this long after its last word.
  const HOLD_MS = 1500;
  const FLAP_MS = 110;
  const METER_BARS = 9;
  // Bars shorten along a curve from the top, clearing the digits below.
  const meterWidth = (i: number) => 100 - 78 * Math.min(1, i / (METER_BARS - 1) / 0.5) ** 0.6;

  let phase = $state<"idle" | "loading" | "ready" | "error">("idle");
  // MEMORY is the contact list; a call is one meeting playing.
  let view = $state<"memory" | "call">("call");
  let entries = $state<MeetingCatalogEntry[]>([]);
  let cursor = $state(0);
  // What the frequency is derived from: the meeting id, or the file for a drop.
  let freqKey = $state("");
  let error = $state("");
  let artifact = $state<LoadedArtifact | null>(null);
  let audioUrl = $state("");
  let title = $state("");
  let portraits = $state<Record<string, Portrait>>({});
  let slots = $state<[string | null, string | null]>([null, null]);
  let timeMs = $state(0);
  let durationMs = $state(0);
  let playing = $state(false);
  let level = $state(0);
  let dragging = $state(false);
  // The first CALL rings and opens the link; after that it is plain play/pause.
  let call = $state<"off" | "ringing" | "open">("off");
  // Bumped per side to replay the static burst on that portrait.
  let cuts = $state<[number, number]>([0, 0]);

  let audio: HTMLAudioElement | undefined = $state();
  let music: HTMLAudioElement | undefined = $state();
  // The background track loops from the moment the page opens; it sits lower
  // while the meeting itself is playing so the voices stay clear.
  const MUSIC_IDLE = 0.1;
  const MUSIC_UNDER_VOICES = 0.025;
  $effect(() => {
    if (music) music.volume = playing ? MUSIC_UNDER_VOICES : MUSIC_IDLE;
  });

  // Browsers refuse sound before the visitor interacts with the page, so if
  // the first attempt is blocked, start on the first click, key or drop.
  function startMusic() {
    if (!music || !music.paused) return;
    music.play().catch((e) => {
      if (e?.name !== "NotAllowedError") {
        console.info(`codec: background track did not start`, e);
        return;
      }
      const retry = () => {
        for (const ev of ["pointerdown", "keydown", "drop"]) window.removeEventListener(ev, retry, true);
        startMusic();
      };
      for (const ev of ["pointerdown", "keydown", "drop"]) window.addEventListener(ev, retry, true);
    });
  }
  let photoInput: HTMLInputElement | undefined = $state();
  let photoFor: string | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let lastSpeaker: string | null = null;
  let raf = 0;
  const lastSpoke = new Map<string, number>();

  const blocks = $derived<DisplayTranscriptBlock[]>(artifact?.displayTranscript?.blocks ?? []);
  const speakers = $derived<TranscriptSpeaker[]>(artifact?.transcript.speakers ?? []);
  const labelOf = (id: string | null) =>
    id ? (speakers.find((s) => s.id === id)?.label ?? id) : "";

  // Every meeting gets its own stable frequency, 140.00–149.99, nudged up on a
  // collision so no two entries in the list share one.
  const hashFreq = (key: string) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 14000 + (h % 1000);
  };
  const freqs = $derived.by(() => {
    const taken = new Set<number>();
    const out = new Map<string, string>();
    for (const e of entries) {
      let f = hashFreq(e.id);
      while (taken.has(f)) f = f >= 14999 ? 14000 : f + 1;
      taken.add(f);
      out.set(e.id, (f / 100).toFixed(2));
    }
    return out;
  });
  const freqOf = (key: string) => freqs.get(key) ?? (hashFreq(key) / 100).toFixed(2);
  const frequency = $derived(
    view === "memory" && entries[cursor] ? freqOf(entries[cursor].id) : freqOf(freqKey || title),
  );

  const activeBlock = $derived.by(() => {
    let lo = 0;
    let hi = blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].startMs <= timeMs) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const block = found >= 0 ? blocks[found] : null;
    return block && timeMs <= block.endMs + HOLD_MS ? block : null;
  });

  // A block can run for minutes; show it a page at a time, like codec text,
  // breaking after a sentence once a page is long enough.
  const PAGE_WORDS = 16;
  const pages = $derived.by(() => {
    if (!activeBlock) return [];
    const out: { text: string; atMs: number }[][] = [[]];
    let words = 0;
    let lastMs = activeBlock.startMs;
    for (const t of activeBlock.tokens) {
      // Punctuation carries no timing of its own: it lands with its word.
      if (t.kind === "word") lastMs = t.startMs ?? lastMs;
      const page = out[out.length - 1];
      page.push({ text: (t.spaceBefore && page.length ? " " : "") + t.text, atMs: lastMs });
      if (t.kind === "word") words++;
      const sentenceEnd = /[.?!]$/.test(t.text);
      if ((words >= PAGE_WORDS && sentenceEnd) || words >= PAGE_WORDS * 1.6) {
        out.push([]);
        words = 0;
      }
    }
    return out.filter((p) => p.length);
  });
  const revealed = $derived.by(() => {
    const current = pages.findLast((p) => p[0].atMs <= timeMs) ?? pages[0];
    return current ? current.filter((t) => t.atMs <= timeMs).map((t) => t.text).join("") : "";
  });

  const talking = $derived(
    !!activeBlock &&
      playing &&
      activeBlock.tokens.some(
        (t) => t.kind === "word" && t.startMs !== undefined && t.startMs <= timeMs && timeMs <= (t.endMs ?? t.startMs) + 60,
      ),
  );
  const mouthOpen = $derived(talking && Math.floor(timeMs / FLAP_MS) % 2 === 0);
  const speaking = $derived(activeBlock?.speaker ?? null);

  // Keep the current speaker on screen; they take the side whose occupant spoke
  // least recently, the way a codec call cuts between people.
  $effect(() => {
    const id = speaking;
    if (!id) return;
    lastSpoke.set(id, timeMs);
    if (!slots.includes(id)) {
      const [a, b] = slots;
      if (a === null) slots = [id, b];
      else if (b === null) slots = [a, id];
      else slots = (lastSpoke.get(a) ?? -1) <= (lastSpoke.get(b) ?? -1) ? [id, b] : [a, id];
    }
    // A cut to someone else: static on their portrait, and a hiss.
    if (id !== lastSpeaker) {
      if (lastSpeaker !== null) {
        const side = slots.indexOf(id);
        cuts = side === 0 ? [cuts[0] + 1, cuts[1]] : [cuts[0], cuts[1] + 1];
        if (playing && audioCtx) staticBurst(audioCtx);
      }
      lastSpeaker = id;
    }
  });

  async function open(src: string, name: string) {
    phase = "loading";
    view = "call";
    call = "off";
    try {
      present(await loadPortableArtifactFromAudioPath(src), name, name);
    } catch (e) {
      console.error("codec: could not open meeting", e);
      error = e instanceof Error ? e.message : String(e);
      phase = "error";
    }
  }

  function present(loaded: LoadedArtifact, name: string, key: string) {
    {
      artifact = loaded;
      audioUrl = loaded.audioSrc;
      freqKey = key;
      title = loaded.metadata?.sections.flatMap((s) => s.rows).find((r) => r.label === "Title")?.value ?? name;
      durationMs = loaded.transcript.media.durationMs;
      const next: Record<string, Portrait> = {};
      for (const s of loaded.transcript.speakers) next[s.id] = portraits[s.id] ?? generatedPortrait(s.id);
      portraits = next;
      const order = [...new Set(loaded.displayTranscript?.blocks.map((b) => b.speaker).filter(Boolean))] as string[];
      slots = [order[0] ?? null, order[1] ?? null];
      lastSpoke.clear();
      lastSpeaker = null;
      cuts = [0, 0];
      phase = "ready";
    }
  }

  // Dial a meeting from MEMORY: ring while it loads, then open the link.
  async function dial(entry: MeetingCatalogEntry) {
    if (call === "ringing") return;
    audio?.pause();
    view = "call";
    phase = "loading";
    call = "ringing";
    const ctx = ensureCtx();
    const loading = provider.loadMeetingForEntry(entry);
    try {
      if (ctx) {
        await ctx.resume();
        await loadSamples(ctx);
        await Promise.all([ring(ctx), loading]);
      }
      present(await loading, entry.title, entry.id);
      await tick();
      openLink();
    } catch (e) {
      console.error(`codec: could not dial ${entry.id}`, e);
      error = e instanceof Error ? e.message : String(e);
      call = "off";
      phase = "error";
    }
  }

  function openLink() {
    if (audioCtx) connect(audioCtx);
    call = "open";
    void audio?.play();
  }

  // Hang up and go back to the list, cursor still on the meeting just called.
  function hangup() {
    if (view !== "call" || !entries.length || call === "ringing") return;
    audio?.pause();
    if (audioCtx) hangUp(audioCtx);
    call = "off";
    view = "memory";
    const at = entries.findIndex((e) => e.id === freqKey);
    if (at >= 0) cursor = at;
  }

  function exit() {
    if (!onexit) return;
    audio?.pause();
    music?.pause();
    if (audioCtx) hangUp(audioCtx);
    onexit();
  }

  function moveCursor(by: number) {
    if (!entries.length) return;
    const next = (cursor + by + entries.length) % entries.length;
    if (next === cursor) return;
    cursor = next;
    const ctx = ensureCtx();
    if (ctx) tuneBlip(ctx);
  }

  // Images named after a speaker (`<id>.jpg`, `<id>-quiet.png` + `<id>-talk.png`)
  // become that speaker's portrait. Ids are matched loosely against labels too.
  async function addPortraitFiles(files: File[]) {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const pairs = new Map<string, { quiet?: File; talk?: File; photo?: File }>();
    for (const f of files) {
      const m = f.name.match(/^(.*?)(?:-(quiet|talk))?\.(png|jpe?g|webp|gif)$/i);
      if (!m) continue;
      const speaker = speakers.find((s) => norm(s.id) === norm(m[1]) || norm(s.label) === norm(m[1]));
      if (!speaker) {
        console.warn(`codec: ${f.name} matches no speaker`, speakers.map((s) => s.id));
        continue;
      }
      const entry = pairs.get(speaker.id) ?? {};
      if (m[2]) entry[m[2].toLowerCase() as "quiet" | "talk"] = f;
      else entry.photo = f;
      pairs.set(speaker.id, entry);
    }
    for (const [id, { quiet, talk, photo }] of pairs) {
      if (quiet && talk) {
        portraits = { ...portraits, [id]: { quiet: URL.createObjectURL(quiet), talk: URL.createObjectURL(talk) } };
      } else if (photo ?? quiet ?? talk) {
        portraits = { ...portraits, [id]: await portraitFromImage((photo ?? quiet ?? talk)!) };
      }
    }
  }

  async function onFiles(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    const opus = files.find((f) => /\.(opus|ogg)$/i.test(f.name));
    if (opus) await open(URL.createObjectURL(opus), opus.name.replace(/\.[^.]+$/, ""));
    await addPortraitFiles(files.filter((f) => f !== opus));
  }

  async function onPhotoPicked(list: FileList | null) {
    const file = list?.[0];
    if (file && photoFor) portraits = { ...portraits, [photoFor]: await portraitFromImage(file) };
    photoFor = null;
    if (photoInput) photoInput.value = "";
  }

  function pickPhoto(id: string | null) {
    if (!id) return;
    photoFor = id;
    photoInput?.click();
  }

  function ensureCtx(): AudioContext | null {
    if (!audioCtx) {
      try {
        audioCtx = new AudioContext();
      } catch (e) {
        console.warn("codec: no Web Audio, so no effects or signal meter", e);
        return null;
      }
    }
    // The meeting's <audio> stays mounted, so it is routed through once.
    if (audio && !analyser) {
      try {
        const node = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        node.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch (e) {
        console.warn("codec: no signal meter, audio still plays", e);
      }
    }
    return audioCtx;
  }

  async function toggle() {
    if (!audio || call === "ringing") return;
    const ctx = ensureCtx();
    if (call === "off") {
      call = "ringing";
      if (ctx) {
        await ctx.resume();
        await loadSamples(ctx);
        await ring(ctx);
      }
      openLink();
      return;
    }
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function seek(ms: number) {
    if (audio) audio.currentTime = Math.max(0, Math.min(durationMs, ms)) / 1000;
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    if (view === "memory") {
      if (e.code === "Escape") {
        exit();
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowLeft") moveCursor(-1);
      else if (e.code === "ArrowDown" || e.code === "ArrowRight") moveCursor(1);
      else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        if (entries[cursor]) void dial(entries[cursor]);
      } else return;
      e.preventDefault();
      return;
    }
    if (e.code === "Escape") {
      hangup();
      return;
    }
    if (phase !== "ready") return;
    if (e.code === "Space") {
      e.preventDefault();
      toggle();
    } else if (e.code === "ArrowLeft") seek(timeMs - 5000);
    else if (e.code === "ArrowRight") seek(timeMs + 5000);
  }

  const buf = new Uint8Array(512);
  function frame() {
    if (audio) timeMs = audio.currentTime * 1000;
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
    }
    raf = requestAnimationFrame(frame);
  }

  const clock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  onMount(() => {
    raf = requestAnimationFrame(frame);
    const src = new URLSearchParams(location.search).get("src");
    if (src) {
      void open(src, src.split("/").pop() ?? src);
      return;
    }
    provider
      .loadCatalog()
      .then((catalog) => {
        entries = catalog?.meetings ?? [];
        if (entries.length) view = "memory";
      })
      .catch((e) => console.error("codec: could not load the meeting list", e));
  });
  onDestroy(() => cancelAnimationFrame(raf));
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<main
  class="codec"
  class:dragging
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    void onFiles(e.dataTransfer?.files);
  }}
>
  <div class="screen" class:ringing={call === "ringing"} class:standby={call !== "open"} class:memory={view === "memory"}>
    <div class="unit">
      {#each [0, 1] as side (side)}
        {@const id = slots[side]}
        <div class="seat" style="order:{side === 0 ? 0 : 2}">
          <button
            class="portrait"
            class:live={id !== null && id === speaking}
            class:empty={!id}
            title={id ? `${labelOf(id)} (click to use a photo)` : ""}
            onclick={() => pickPhoto(id)}
            disabled={!id}
          >
            {#if call === "open" && cuts[side] > 0}
              {#key `${id}:${cuts[side]}`}
                <Static />
              {/key}
            {/if}
            {#if id && portraits[id] && call === "open"}
              <img
                src={id === speaking && mouthOpen ? portraits[id].talk : portraits[id].quiet}
                alt={labelOf(id)}
                draggable="false"
              />
            {/if}
          </button>
          <span class="name">{labelOf(id)}</span>
        </div>
      {/each}

      <div class="console" style="order:1">
        <div class="rail"><span class="ctab ptt">PTT</span></div>
        <div class="tuner">
          <button class="arrow" aria-label="Previous frequency" disabled={view !== "memory"} onclick={() => moveCursor(-1)}>◀</button>
          <div class="display">
            <div class="meter" aria-hidden="true">
              {#each Array(METER_BARS) as _, i (i)}
                <span
                  class:on={(METER_BARS - 1 - i) < level * METER_BARS}
                  style="width:{meterWidth(i)}%"
                ></span>
              {/each}
            </div>
            <div class="freq"><SevenSeg value={frequency} /></div>
          </div>
          <button class="arrow" aria-label="Next frequency" disabled={view !== "memory"} onclick={() => moveCursor(1)}>▶</button>
        </div>
        <div class="rail">
          <button class="ctab memory" class:lit={view === "memory"} disabled={!entries.length} onclick={hangup}>MEMORY</button>
        </div>
      </div>
    </div>

    {#if view === "memory"}
      <ol class="contacts" aria-label="Meetings">
        {#each entries as entry, i (entry.id)}
          {#if Math.abs(i - Math.min(Math.max(cursor, 2), entries.length - 3)) <= 2}
            <li>
              <button class="contact" class:selected={i === cursor} onclick={() => (i === cursor ? dial(entry) : (cursor = i))}>
                <span class="cfreq">{freqOf(entry.id)}</span>
                <span class="ctitle">{entry.title}</span>
                <span class="cmeta">
                  {formatMeetingDateShort(entry.dateLabel)}{entry.digestDurationMs ? ` · ${formatMeetingDuration(entry.digestDurationMs)}` : ""}
                </span>
              </button>
            </li>
          {/if}
        {/each}
      </ol>
      <div class="contacts-hint">{cursor + 1} / {entries.length} &nbsp;·&nbsp; ↑↓ TUNE &nbsp;·&nbsp; ENTER CALL</div>
      {#if onexit}
        <button class="exit" onclick={exit}>PRESS ESC TO EXIT</button>
      {/if}
    {:else}
    <div class="subtitle" aria-live="polite">
      {#if phase === "idle"}
        Drop a Cassini .opus here, or <label class="clink">choose one<input type="file" accept=".opus,.ogg,image/*" multiple hidden onchange={(e) => onFiles(e.currentTarget.files)} /></label>.
        <br /><small>Add speaker photos too: name them after the speaker, e.g. <code>bob.jpg</code>.</small>
      {:else if call === "ringing"}
        <span class="incoming">CALL</span>
      {:else if phase === "loading"}
        Establishing link...
      {:else if call === "off"}
        <span class="prompt">PRESS CALL TO CONNECT</span>
      {:else if phase === "error"}
        Signal lost: {error}
      {:else}
        {revealed}
      {/if}
    </div>
    {/if}
  </div>

  {#if phase === "ready" && view === "call"}
    <div class="controls">
      <button class="call" onclick={toggle} disabled={call === "ringing"}>
        {call === "ringing" ? "RINGING" : playing ? "■ HOLD" : call === "off" ? "▶ CALL" : "▶ RESUME"}
      </button>
      <input
        type="range"
        min="0"
        max={durationMs}
        step="100"
        value={timeMs}
        oninput={(e) => seek(Number(e.currentTarget.value))}
        aria-label="Seek"
      />
      <span class="clock">{clock(timeMs)} / {clock(durationMs)}</span>
      {#if entries.length}
        <button class="call" onclick={hangup}>✕ HANG UP</button>
      {/if}
    </div>
  {/if}
  <audio
    bind:this={audio}
    src={audioUrl || undefined}
    preload="auto"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => (playing = false)}
    onloadedmetadata={() => audio && Number.isFinite(audio.duration) && (durationMs = audio.duration * 1000)}
  ></audio>
  <!-- Optional local background track, looping from page load. -->
  <audio
    bind:this={music}
    data-role="music"
    src={MUSIC_URL}
    loop
    preload="auto"
    oncanplay={startMusic}
    onerror={() => console.info(`codec: no background track at ${MUSIC_URL}`)}
  ></audio>
  <input bind:this={photoInput} type="file" accept="image/*" hidden onchange={(e) => onPhotoPicked(e.currentTarget.files)} />
</main>
