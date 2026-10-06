// Adding a dropped .opus to the shared MEMORY list: read what the file says
// about itself, then hand it to the site's upload service (deploy/codec), which
// stores it and adds it to catalog.json.

import { extractPortableManifestFromArrayBuffer } from "../viewer/portable";

export interface DroppedMeeting {
  id: string;
  title: string;
  dateLabel: string;
  durationMs?: number;
  speakers?: number;
}

/** Reads a dropped file's manifest; throws if it is not a Cassini meeting. */
export async function describeDropped(file: File): Promise<DroppedMeeting> {
  const { manifest } = await extractPortableManifestFromArrayBuffer(await file.arrayBuffer());
  const meeting = manifest.meeting ?? {};
  const id = meeting.id || manifest.integrity?.opusAudioSha256 || file.name.replace(/\.[^.]+$/, "");
  const when = meeting.recordedAtLocal || meeting.createdAtUtc || new Date(file.lastModified).toISOString();
  return {
    id,
    title: meeting.title || file.name.replace(/\.[^.]+$/, ""),
    dateLabel: when.slice(0, 16).replace("T", " "),
    durationMs: meeting.durationMs ?? manifest.audio?.durationMs,
    speakers: Array.isArray(manifest.speakers) ? manifest.speakers.length : undefined,
  };
}

export class UploadUnavailableError extends Error {}

/** Uploads to `api/upload` beside the page. XHR, for upload progress. */
export function uploadMeeting(
  file: File,
  meta: DroppedMeeting,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const url = new URL("api/upload", document.baseURI);
  url.searchParams.set("id", meta.id);
  url.searchParams.set("title", meta.title);
  url.searchParams.set("date", meta.dateLabel);
  if (meta.durationMs !== undefined) url.searchParams.set("durationMs", String(Math.round(meta.durationMs)));
  if (meta.speakers !== undefined) url.searchParams.set("speakers", String(meta.speakers));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // No service behind this page (dev server, the Nextcloud easter egg).
      if (xhr.status === 404 || xhr.status === 405) {
        return reject(new UploadUnavailableError("this site does not take uploads"));
      }
      let message = `HTTP ${xhr.status}`;
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        // not JSON: keep the status
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(file);
  });
}
