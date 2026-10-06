"""Upload service for the standalone codec site.

POST /api/upload?id=…&title=…&date=…&durationMs=…&speakers=… with the .opus as
the raw request body. The file must be a Cassini portable meeting; it is stored
as meetings/<id>.opus and added to catalog.json (replacing an entry with the
same id), and the new catalog entry is returned as JSON.

Authentication is Traefik's job: this listens only on the internal network,
behind the same basic-auth middleware as the site.
"""

import json
import os
import re
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SITE = os.environ.get("SITE_DIR", "/site")
MAX_BYTES = int(os.environ.get("MAX_BYTES", str(300 * 1024 * 1024)))
CATALOG = os.path.join(SITE, "catalog.json")
MEETINGS = os.path.join(SITE, "meetings")
# The portable-meeting tag sits in OpusTags, in the first kilobyte of every
# file seen so far; 64 KiB leaves plenty of room.
HEAD_BYTES = 64 * 1024
FORMAT_TAG = b"CASSINI_FORMAT=org.cassini.portable-meeting/1"

catalog_lock = threading.Lock()


def clean(value, limit):
    return re.sub(r"[\x00-\x1f\x7f]", "", value or "").strip()[:limit]


def write_json_atomic(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/upload":
            return self.reply(404, {"error": "not found"})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}

        meeting_id = re.sub(r"[^A-Za-z0-9_-]", "", q.get("id", ""))[:96]
        title = clean(q.get("title"), 160) or meeting_id
        date = clean(q.get("date"), 32)
        if not meeting_id:
            return self.reply(400, {"error": "missing meeting id"})
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?", date):
            return self.reply(400, {"error": "date must be YYYY-MM-DD[ HH:MM]"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.reply(411, {"error": "empty upload"})
        if length > MAX_BYTES:
            return self.reply(413, {"error": f"larger than {MAX_BYTES // (1024 * 1024)} MB"})

        os.makedirs(MEETINGS, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=MEETINGS, suffix=".part")
        head = b""
        left = length
        try:
            with os.fdopen(fd, "wb") as f:
                while left:
                    chunk = self.rfile.read(min(1 << 20, left))
                    if not chunk:
                        break
                    if len(head) < HEAD_BYTES:
                        head += chunk[: HEAD_BYTES - len(head)]
                    f.write(chunk)
                    left -= len(chunk)
            if left:
                raise ValueError("upload was cut short")
            if not head.startswith(b"OggS") or b"OpusHead" not in head[:512] or FORMAT_TAG not in head:
                raise ValueError("not a Cassini portable .opus")
            os.chmod(tmp, 0o644)
            os.replace(tmp, os.path.join(MEETINGS, f"{meeting_id}.opus"))
        except ValueError as e:
            os.unlink(tmp)
            return self.reply(400, {"error": str(e)})
        except Exception as e:
            os.unlink(tmp)
            self.log_error("upload of %s failed: %r", meeting_id, e)
            return self.reply(500, {"error": "could not store the file"})

        entry = {
            "id": meeting_id,
            "title": title,
            "dateLabel": date,
            "audioPath": f"./meetings/{meeting_id}.opus",
        }
        for key, field in (("durationMs", "digestDurationMs"), ("speakers", "speakerCount")):
            if q.get(key, "").isdigit():
                entry[field] = int(q[key])

        with catalog_lock:
            try:
                with open(CATALOG) as f:
                    catalog = json.load(f)
            except FileNotFoundError:
                catalog = {"version": "cassini.viewer.catalog.v1", "meetings": []}
            catalog["meetings"] = [m for m in catalog["meetings"] if m.get("id") != meeting_id] + [entry]
            write_json_atomic(CATALOG, catalog)
        self.log_message("added %s (%d bytes): %s", meeting_id, length, title)
        return self.reply(200, entry)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
