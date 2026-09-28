// Real browse/overlay controls with synthetic meetings and held POST responses.
// No Nextcloud instance, recording, or credentials are used.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const origin = server.resolvedUrls.local[0];
let browser;
const requests = [];
const held = [];
let revision = 1;
let serial = 1;
const tags = [{ id: "t-focus", label: "Focus", color: "red", icon: "" }];
let items = [{ id: "i-initial", tagId: "t-focus", target: { kind: "time-range", startMs: 1000, endMs: 3000 },
  actor: { kind: "person", id: "ana" }, createdAtUtc: "now", operationId: "op0" }];
const snapshot = () => ({ meetingId: "m1", revision, stateToken: `epoch:${revision}`, resolved: true,
  sync: { state: "pending", desired: revision, confirmed: 1 },
  annotations: { format: "cassini.annotations.v1", revision, audioOpusSha256: "audio", tagNamespace: "ns", tags, items },
  operationId: "op", added: [], removed: [], notFound: [] });
const vocabulary = () => ({ tags: tags.map(tag => ({ tagId: tag.id, namespace: "ns", label: tag.label, color: tag.color,
  icon: "", meetings: 1, marks: items.filter(item => item.tagId === tag.id).length })),
  meetings: [{ meetingId: "m1", tags: tags.map(tag => ({ tagId: tag.id,
    whole: items.some(item => item.tagId === tag.id && item.target.kind === "meeting"),
    stretches: items.filter(item => item.tagId === tag.id && item.target.kind === "time-range").length })) }],
  coverage: { visible: 1, indexed: 1 } });
async function waitForPost() {
  const deadline = Date.now() + 10000;
  while (!held.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(held.length, "expected an annotation POST");
}
async function commit() {
  await waitForPost();
  const route = held.shift();
  assert.ok(route, "expected a held POST");
  const request = route.request().postDataJSON();
  assert.equal(request.stateToken, `epoch:${revision}`, "write uses the latest confirmed precondition");
  for (const op of request.ops) {
    if (op.op === "unmark") items = items.filter(item => item.id !== op.itemId);
    if (op.op === "unmark-tag") items = items.filter(item => item.tagId !== op.tagId || item.target.kind !== op.target.kind);
    if (op.op === "mark") {
      let tag = tags.find(tag => tag.id === op.tag.id || tag.label === op.tag.label);
      if (!tag) { tag = { id: `t-${++serial}`, label: op.tag.label, color: "teal", icon: "" }; tags.push(tag); }
      items.push({ id: `i-${++serial}`, tagId: tag.id, target: op.target, actor: { kind: "person", id: "ana" }, createdAtUtc: "now", operationId: "op" });
    }
  }
  revision++;
  await route.fulfill({ json: snapshot() });
}
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/annotation-fixture", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
import { mount } from '/node_modules/.vite/deps/svelte.js';
import App from '/@fs/${fileURLToPath(new URL('../../cassini-viewer/src/App.svelte', import.meta.url))}';
import { buildTranscriptIndex } from '/@fs/${fileURLToPath(new URL('../../cassini-viewer/src/core/transcript.ts', import.meta.url))}';
import '/src/app.css';
const words = ['First', 'second', 'third', 'fourth', 'fifth', 'sixth'].map((text, i) => ({ text, startMs: i * 1000, endMs: (i + 1) * 1000 }));
const transcript = {version: 'transcript.words.v1', media: {src: '', durationMs: 6000}, speakers: [{id: 'ana', label: 'Ana'}], segments: [{id: 's1', speaker: 'ana', startMs: 0, endMs: 6000, text: words.map(w => w.text).join(' '), words}]};
const artifact = {transcript, index: buildTranscriptIndex(transcript), displayTranscript: null, readableTranscript: null, summary: null,
  audioSrc: '', captionsSrc: null, chaptersSrc: null, timingPrecision: {level:'word',label:'Word',detail:''}, metadata:null,
  wordEndsBoundedByAudio:true, availableTranscripts:[], currentTranscriptId:''};
const meeting = {id:'m1',title:'Annotation test',dateLabel:'2026-09-28',speakerCount:1,segmentCount:1,digestDurationMs:6000};
const provider = {loadCatalog:async()=>({version:'cassini.viewer.catalog.v1',meetings:[meeting,{...meeting,id:'m2',title:'Other meeting'}]}),
  loadMeetingForEntry:async()=>artifact,loadMeetingSummary:async()=>null,loadBundledArtifact:async()=>artifact,
  loadMeetingAnnotations:async()=>fetch('/test-annotations').then(r=>r.json()),
  loadTagVocabulary:async()=>fetch('/test-tags').then(r=>r.json()),
  applyAnnotationOps:async(_,request)=>fetch('/test-annotations',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json())};
mount(App,{target:document.getElementById('app'),props:{dataProvider:provider}});
</script></body></html>` }));
  await page.route("**/test-tags", route => route.fulfill({ json: vocabulary() }));
  await page.route("**/test-annotations", route => {
    if (route.request().method() === "POST") { requests.push(route.request().postDataJSON()); held.push(route); return; }
    return route.fulfill({ json: snapshot() });
  });
  await page.goto(new URL("annotation-fixture", origin).href);
  await page.getByRole("button", { name: /^Annotation test Mon/ }).click();
  const header = page.getByRole("group", { name: "Tags on the whole meeting" });
  await header.getByRole("button", { name: "Add tag", exact: true }).click();
  await page.getByRole("combobox", { name: "Find or create a tag" }).fill("Immediate");
  await page.getByRole("combobox", { name: "Find or create a tag" }).press("Enter");
  await header.getByRole("button", { name: "Remove Immediate", exact: true }).waitFor();
  assert.equal(await header.getByRole("button", { name: "Add tag", exact: true }).isEnabled(), true);
  assert.equal(revision, 1, "optimistic tag renders before server commit");
  await page.getByLabel("Meeting view", { exact: true }).getByRole("button", { name: "Close the meeting", exact: true }).click();
  await page.getByRole("button", { name: /^Annotation test Mon/ }).click();
  await header.getByRole("button", { name: "Remove Immediate", exact: true }).waitFor();
  await header.getByRole("button", { name: "Remove Immediate", exact: true }).click();
  assert.equal(await header.getByRole("button", { name: "Remove Immediate", exact: true }).count(), 0);
  assert.equal(requests.length, 1, "second edit is queued while the first POST is held");
  await commit();
  await waitForPost();
  assert.equal(requests[1].ops[0].op, "unmark-tag");
  assert.ok(!requests[1].ops[0].tagId.startsWith("local-"));
  await commit();
  await header.getByText("Tags saved · updating recording…", { exact: true }).waitFor();

  // Move a range, then delete it before its newly generated ID is acknowledged.
  await page.getByRole("button", { name: /^Focus, .*marked by ana$/ }).click();
  await page.getByRole("slider", { name: "Where the section ends" }).press("ArrowRight");
  await page.getByRole("button", { name: /^Save changes/ }).click();
  assert.equal(await page.getByRole("button", { name: /^Save changes/ }).count(), 0, "selection closes immediately");
  await page.getByRole("button", { name: /^Focus, .*marked by You$/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Focus, .*marked by/ }).count(), 0, "range disappears before response");
  assert.equal(requests.length, 3);
  await commit();
  await waitForPost();
  assert.equal(requests[3].ops[0].op, "unmark");
  assert.ok(!requests[3].ops[0].itemId.startsWith("local-"));
  await commit();
  await header.getByText("Tags saved · updating recording…", { exact: true }).waitFor();
  assert.equal(items.length, 0);
  assert.deepEqual(errors, []);
  console.log("annotation browser checks passed: immediate tags/ranges, continued editing, close/reopen, dependent move/delete, async archive status");
} finally {
  for (const route of held.splice(0)) await route.abort().catch(() => {});
  await browser?.close();
  await server.close();
}
