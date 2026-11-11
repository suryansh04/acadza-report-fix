import json
import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

LOCAL_DATABASE = Path(__file__).resolve().parent / "audit.sqlite3"
COLUMNS = ("id", "report_id", "question_id", "action", "edits", "reply", "note", "reviewer", "created_at")
INSERT_COLUMNS = COLUMNS[1:]
SELECT_COLUMNS = f"SELECT {', '.join(COLUMNS)} FROM audit_log"
LATEST_ENTRIES = f"{SELECT_COLUMNS} WHERE id IN (SELECT MAX(id) FROM audit_log GROUP BY report_id)"
# Any fixed number works: it only names the lock that lets one audit write run at a time.
AUDIT_WRITE_LOCK = 4_270_011

Connection = psycopg.Connection | sqlite3.Connection
Result = TypeVar("Result")
_pool: ConnectionPool | None = None


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


def open_pool() -> None:
    """Open the Supabase connection pool once, at server start. A new connection to Supabase takes seconds,
    so each request borrows an open one instead. Without DATABASE_URL the console uses a local SQLite file."""
    global _pool
    if database_url() and _pool is None:
        # No server-side prepared statements: they break behind a transaction-mode pooler such as Supabase's port 6543.
        _pool = ConnectionPool(database_url(), min_size=1, max_size=5, open=True, name="audit",
                               kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None})
        _pool.wait()


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def _connection() -> Iterator[Connection]:
    if _pool is not None:
        with _pool.connection() as connection:
            yield connection
        return
    if database_url():
        # Scripts that never opened the pool still get a working connection.
        with closing(psycopg.connect(database_url(), row_factory=dict_row, autocommit=True, prepare_threshold=None)) as connection:
            yield connection
        return
    connection = sqlite3.connect(LOCAL_DATABASE, isolation_level=None, timeout=10)
    connection.row_factory = sqlite3.Row
    with closing(connection):
        yield connection


def run(work: Callable[[Connection], Result]) -> Result:
    """Run work on a database connection. Supabase can drop a connection that sat idle in the pool.
    That fails before anything is saved, so one retry on a fresh connection is safe."""
    try:
        with _connection() as connection:
            return work(connection)
    except psycopg.OperationalError:
        with _connection() as connection:
            return work(connection)


def placeholder() -> str:
    return "%s" if database_url() else "?"


def create_audit_table() -> None:
    primary_key = "BIGSERIAL PRIMARY KEY" if database_url() else "INTEGER PRIMARY KEY AUTOINCREMENT"

    def create(connection: Connection) -> None:
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

    run(create)


def row_to_entry(row: dict | sqlite3.Row) -> dict:
    entry = {column: row[column] for column in COLUMNS}
    entry["edits"] = json.loads(entry["edits"])
    return entry


def decisions_from_rows(rows: list) -> dict[str, dict]:
    """The decision that stands for each report: its latest audit entry, unless that entry is an undo."""
    entries = [row_to_entry(row) for row in rows]
    return {entry["report_id"]: entry for entry in entries if entry["action"] != "undo"}


def read_standing_decisions(connection: Connection) -> dict[str, dict]:
    return decisions_from_rows(connection.execute(LATEST_ENTRIES).fetchall())


def standing_decisions() -> dict[str, dict]:
    return run(read_standing_decisions)


def build_insert(entries: list[NewAuditEntry]) -> tuple[str, list]:
    """One INSERT statement for all entries, so a bulk action costs one round trip, not one for each row."""
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    row_marks = "(" + ", ".join([placeholder()] * len(INSERT_COLUMNS)) + ")"
    values = [value for entry in entries for value in (entry.report_id, entry.question_id, entry.action,
                                                       json.dumps(entry.edits, ensure_ascii=False), entry.reply, entry.note,
                                                       entry.reviewer, created_at)]
    query = (f"INSERT INTO audit_log ({', '.join(INSERT_COLUMNS)}) VALUES {', '.join([row_marks] * len(entries))} "
             f"RETURNING {', '.join(COLUMNS)}")
    return query, values


def sorted_entries(rows: list) -> list[dict]:
    # RETURNING gives no fixed order, so sort by id.
    return sorted((row_to_entry(row) for row in rows), key=lambda entry: entry["id"])


def write_postgres(connection: psycopg.Connection, plan: Callable[[dict[str, dict]], list[NewAuditEntry]]) -> list[dict]:
    # Supabase is far away, so each round trip costs time. A client-side cursor sends several statements as one string:
    # 1. BEGIN, the write lock and the read of the standing decisions.  2. The INSERT and the COMMIT.
    cursor = psycopg.ClientCursor(connection)
    try:
        cursor.execute(f"BEGIN; SELECT pg_advisory_xact_lock({AUDIT_WRITE_LOCK}); {LATEST_ENTRIES}")
        while cursor.nextset():
            pass
        entries = plan(decisions_from_rows(cursor.fetchall()))
        if not entries:
            cursor.execute("COMMIT")
            return []
        query, values = build_insert(entries)
        cursor.execute(f"{query}; COMMIT", values)
        return sorted_entries(cursor.fetchall())
    except BaseException:
        if not connection.broken:
            connection.execute("ROLLBACK")
        raise


def write_sqlite(connection: sqlite3.Connection, plan: Callable[[dict[str, dict]], list[NewAuditEntry]]) -> list[dict]:
    # BEGIN IMMEDIATE takes the write lock at once, so no other request can write between the check and the insert.
    connection.execute("BEGIN IMMEDIATE")
    try:
        entries = plan(read_standing_decisions(connection))
        rows = connection.execute(*build_insert(entries)).fetchall() if entries else []
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    connection.execute("COMMIT")
    return sorted_entries(rows)


def write_entries(plan: Callable[[dict[str, dict]], list[NewAuditEntry]]) -> list[dict]:
    """Saves the entries that plan returns, in one locked transaction: all of them or none. One audit write runs at
    a time, so a check on the standing decisions and the insert that follows can never interleave with another request.
    plan gets the decisions read inside the transaction, so its checks are still true at insert time. If plan raises,
    nothing is saved."""
    return run(lambda connection: write_postgres(connection, plan) if isinstance(connection, psycopg.Connection)
               else write_sqlite(connection, plan))


def list_audit_entries() -> list[dict]:
    return run(lambda connection: [row_to_entry(row) for row in connection.execute(f"{SELECT_COLUMNS} ORDER BY id DESC").fetchall()])
