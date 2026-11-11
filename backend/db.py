import json
import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

LOCAL_DATABASE = Path(__file__).resolve().parent / "audit.sqlite3"
COLUMNS = ("id", "report_id", "question_id", "action", "edits", "reply", "note", "reviewer", "created_at")
SELECT_COLUMNS = f"SELECT {', '.join(COLUMNS)} FROM audit_log"
# Any fixed number works: it only names the lock that lets one audit write run at a time.
AUDIT_WRITE_LOCK = 4_270_011


@dataclass
class NewAuditEntry:
    report_id: str
    question_id: str
    action: str
    edits: list[dict]
    reply: str
    note: str
    reviewer: str


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or None


def connect() -> psycopg.Connection | sqlite3.Connection:
    # Supabase in production; a local SQLite file when no DATABASE_URL is set, so the console runs without setup.
    if database_url():
        # No server-side prepared statements: they break behind a transaction-mode pooler such as Supabase's port 6543.
        return psycopg.connect(database_url(), row_factory=dict_row, autocommit=True, prepare_threshold=None)
    connection = sqlite3.connect(LOCAL_DATABASE, isolation_level=None, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def placeholder() -> str:
    return "%s" if database_url() else "?"


def create_audit_table() -> None:
    primary_key = "BIGSERIAL PRIMARY KEY" if database_url() else "INTEGER PRIMARY KEY AUTOINCREMENT"
    with closing(connect()) as connection:
        connection.execute(f"""
            CREATE TABLE IF NOT EXISTS audit_log (
                id {primary_key},
                report_id TEXT NOT NULL,
                question_id TEXT NOT NULL,
                action TEXT NOT NULL,
                edits TEXT NOT NULL,
                reply TEXT NOT NULL,
                note TEXT NOT NULL,
                reviewer TEXT NOT NULL,
                created_at TEXT NOT NULL
            )""")
        connection.execute("CREATE INDEX IF NOT EXISTS audit_log_report ON audit_log (report_id, id)")


def row_to_entry(row: dict | sqlite3.Row) -> dict:
    entry = {column: row[column] for column in COLUMNS}
    entry["edits"] = json.loads(entry["edits"])
    return entry


@contextmanager
def locked_transaction(connection: psycopg.Connection | sqlite3.Connection) -> Iterator[None]:
    """One audit write at a time. A check on the standing decisions and the insert that follows can then never
    interleave with another request, for example a double key press or a second browser tab."""
    if isinstance(connection, psycopg.Connection):
        with connection.transaction():
            connection.execute("SELECT pg_advisory_xact_lock(%s)", (AUDIT_WRITE_LOCK,))
            yield
        return
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    connection.execute("COMMIT")


def read_standing_decisions(connection: psycopg.Connection | sqlite3.Connection) -> dict[str, dict]:
    """The decision that stands for each report: its latest audit entry, unless that entry is an undo."""
    rows = connection.execute(f"{SELECT_COLUMNS} WHERE id IN (SELECT MAX(id) FROM audit_log GROUP BY report_id)").fetchall()
    entries = [row_to_entry(row) for row in rows]
    return {entry["report_id"]: entry for entry in entries if entry["action"] != "undo"}


def standing_decisions() -> dict[str, dict]:
    with closing(connect()) as connection:
        return read_standing_decisions(connection)


def write_entries(plan: Callable[[dict[str, dict]], list[NewAuditEntry]]) -> list[dict]:
    """Saves the entries that plan returns, in one locked transaction: all of them or none.
    plan gets the standing decisions read inside the same transaction, so its checks are still true at insert time.
    If plan raises, nothing is saved."""
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    marks = ", ".join([placeholder()] * 8)
    query = (f"INSERT INTO audit_log (report_id, question_id, action, edits, reply, note, reviewer, created_at) "
             f"VALUES ({marks}) RETURNING {', '.join(COLUMNS)}")
    with closing(connect()) as connection, locked_transaction(connection):
        entries = plan(read_standing_decisions(connection))
        rows = [connection.execute(query, (entry.report_id, entry.question_id, entry.action, json.dumps(entry.edits, ensure_ascii=False),
                                           entry.reply, entry.note, entry.reviewer, created_at)).fetchone()
                for entry in entries]
    return [row_to_entry(row) for row in rows]


def list_audit_entries() -> list[dict]:
    with closing(connect()) as connection:
        rows = connection.execute(f"{SELECT_COLUMNS} ORDER BY id DESC").fetchall()
    return [row_to_entry(row) for row in rows]
