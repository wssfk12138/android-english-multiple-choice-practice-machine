"""LAN internal channel plus user-approved Android diagnostic receiver."""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 1024 * 1024
FORMAT = "english-practice-machine-diagnostics"


class Handler(SimpleHTTPRequestHandler):
    server_version = "EnglishPracticeDiagnostics/1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-English-Practice-Diagnostics")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/diagnostics/health":
            self._json(200, {"status": "ok", "receiver": "diagnostics"})
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/diagnostics":
            self._json(404, {"status": "not_found"})
            return
        if self.headers.get("X-English-Practice-Diagnostics") != "1":
            self._json(400, {"status": "invalid_request", "message": "missing diagnostics header"})
            return
        content_length = self.headers.get("Content-Length", "")
        if not content_length.isdigit() or int(content_length) > MAX_BODY:
            self._json(413, {"status": "too_large", "message": "payload exceeds 1 MiB"})
            return
        try:
            payload = json.loads(self.rfile.read(int(content_length)))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"status": "invalid_json"})
            return
        entries = payload.get("entries") if isinstance(payload, dict) else None
        if (not isinstance(payload, dict) or payload.get("format") != FORMAT
                or payload.get("schemaVersion") != 1 or not isinstance(entries, list)
                or len(entries) > 50):
            self._json(422, {"status": "invalid_diagnostics"})
            return
        target_root = Path(getattr(self.server, "target_root"))
        target_root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", f"{timestamp}-{time.time_ns() % 1_000_000_000:09d}")
        (target_root / f"diagnostics-{safe_name}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
        )
        self._json(201, {"status": "received", "message": "diagnostic log received", "count": len(entries)})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[diagnostic-receiver] {self.address_string()} {fmt % args}")

    def _json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("INTERNAL_CHANNEL_PORT", "8877"))
    project_root = Path(__file__).resolve().parent
    channel_root = project_root / "work" / "internal-channel"
    log_root = project_root / "work" / "diagnostics-received"
    handler = lambda *args, **kwargs: Handler(*args, directory=str(channel_root), **kwargs)  # noqa: E731
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    server.target_root = str(log_root)  # type: ignore[attr-defined]
    print(f"Internal channel: http://0.0.0.0:{port}/")
    print(f"Diagnostic receiver: http://0.0.0.0:{port}/diagnostics")
    server.serve_forever()


if __name__ == "__main__":
    main()
