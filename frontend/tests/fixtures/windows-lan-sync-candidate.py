from __future__ import annotations

import json
import socket
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path.cwd()))

from backend.app import database, lan_sync_host
from backend.app.services import sync


def reply(request_id: object, result: object = None, error: str = "") -> None:
    payload = {"id": request_id, "ok": not error}
    if error:
        payload["error"] = error
    else:
        payload["result"] = result
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def seed_profiles(connection: sqlite3.Connection) -> None:
    for index, name in enumerate(("Profile A", "Profile B"), start=1):
        profile_id = connection.execute(
            "INSERT INTO question_bank_profiles(name, description) VALUES (?, '')",
            (name,),
        ).lastrowid
        paper_id = connection.execute(
            """
            INSERT INTO papers(profile_id, year, title, status, external_key)
            VALUES (?, ?, ?, 'published', ?)
            """,
            (profile_id, 2030 + index, f"{name} Paper", f"paper-{index}"),
        ).lastrowid
        connection.execute(
            """
            INSERT INTO units(paper_id, unit_type, title, external_key, sequence)
            VALUES (?, 'reading', ?, ?, 1)
            """,
            (paper_id, f"{name} Unit", f"unit-{index}"),
        )
    connection.commit()


def wait_ready(base_url: str) -> None:
    deadline = time.monotonic() + 5
    with httpx.Client(base_url=base_url, timeout=0.5) as client:
        while time.monotonic() < deadline:
            try:
                if client.get("/api/not-a-sync-route").status_code == 404:
                    return
            except httpx.HTTPError:
                time.sleep(0.02)
    raise RuntimeError("temporary Windows LAN sync host did not become ready")


def handle(connection: sqlite3.Connection, action: str, args: dict) -> object:
    if action == "insert_vocab":
        connection.execute(
            """
            INSERT INTO vocabulary_entries(term, normalized_term, note, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (args["term"], args["term"], args.get("note", ""), args["updated_at"]),
        )
        connection.commit()
        return True
    if action == "update_vocab":
        connection.execute(
            "UPDATE vocabulary_entries SET note = ?, updated_at = ? WHERE normalized_term = ?",
            (args["note"], args["updated_at"], args["term"]),
        )
        connection.commit()
        return True
    if action == "query_vocab":
        row = connection.execute(
            "SELECT normalized_term, note, updated_at FROM vocabulary_entries WHERE normalized_term = ?",
            (args["term"],),
        ).fetchone()
        return dict(row) if row else None
    if action == "delete_vocab":
        return sync.merge(
            connection,
            {},
            [{
                "table_name": "vocabulary_entries",
                "object_key": args["term"],
                "profile_name": "",
                "deleted_at": args["deleted_at"],
            }],
        )
    if action == "seed_profile_session":
        profile = args["profile"]
        unit = connection.execute(
            """
            SELECT u.id FROM units u
            JOIN papers pa ON pa.id = u.paper_id
            JOIN question_bank_profiles p ON p.id = pa.profile_id
            WHERE p.name = ? ORDER BY u.id LIMIT 1
            """,
            (profile,),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO practice_sessions(mode, unit_ids, sync_id, updated_at)
            VALUES ('unit', ?, ?, ?)
            """,
            (json.dumps([int(unit["id"])]), args["sync_id"], args["updated_at"]),
        )
        connection.commit()
        return True
    if action == "query_session":
        row = connection.execute(
            "SELECT sync_id, updated_at FROM practice_sessions WHERE sync_id = ?",
            (args["sync_id"],),
        ).fetchone()
        return dict(row) if row else None
    if action == "rotate":
        return sync.reset_passcode(connection)
    if action == "revoke":
        return sync.revoke_all_devices(connection)
    raise ValueError(f"unsupported fixture action: {action}")


def main() -> int:
    temporary = tempfile.TemporaryDirectory(prefix="english-practice-lan-sync-")
    database_path = Path(temporary.name) / "candidate.sqlite3"
    port = free_port()
    database_patch = patch("backend.app.database.DATABASE_PATH", database_path)
    host_patch = patch.object(lan_sync_host, "LAN_SYNC_HOST", "127.0.0.1")
    port_patch = patch.object(lan_sync_host, "LAN_SYNC_PORT", port)
    database_patch.start()
    host_patch.start()
    port_patch.start()
    try:
        database.initialize_database()
        with closing(connect(database_path)) as connection:
            sync._ensure_sync_columns(connection)
            seed_profiles(connection)
            passcode = sync.set_passcode(connection, "CANDIDATE-A")
        if not lan_sync_host.start_lan_sync_host_if_enabled():
            raise RuntimeError("temporary Windows LAN sync host did not start")
        base_url = f"http://127.0.0.1:{port}"
        wait_ready(base_url)
        print(json.dumps({"ready": True, "base_url": base_url, "passcode": passcode}), flush=True)

        for line in sys.stdin:
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("action") == "shutdown":
                reply(request_id, True)
                break
            try:
                with closing(connect(database_path)) as connection:
                    result = handle(connection, str(request.get("action")), request.get("args") or {})
                reply(request_id, result)
            except Exception as exc:  # fixture failures must be visible to the Node runner
                reply(request_id, error=f"{type(exc).__name__}: {exc}")
        return 0
    finally:
        lan_sync_host.stop_lan_sync_host(timeout=2)
        port_patch.stop()
        host_patch.stop()
        database_patch.stop()
        temporary.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
