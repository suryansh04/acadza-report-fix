import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

LOCAL_DATABASE = Path(__file__).resolve().parent / "audit.sqlite3"
COLUMNS = ("id", "report_id", "question_id", "action", "edits", "reply", "note", "reviewer", "created_at")


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
        return psycopg.connect(database_url(), row_factory=dict_row, autocommit=True)
    connection = sqlite3.connect(LOCAL_DATABASE, isolation_level=None)
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


def row_to_entry(row: dict | sqlite3.Row) -> dict:
    entry = {column: row[column] for column in COLUMNS}
    entry["edits"] = json.loads(entry["edits"])
    return entry


@contextmanager
def transaction(connection: psycopg.Connection | sqlite3.Connection) -> Iterator[None]:
    if isinstance(connection, psycopg.Connection):
        with connection.transaction():
            yield
        return
    connection.execute("BEGIN")
    try:
        yield
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    connection.execute("COMMIT")


def insert_audit_entries(entries: list[NewAuditEntry]) -> list[dict]:
    """Saves all entries in one transaction: a bulk action is saved in full or not at all."""
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    marks = ", ".join([placeholder()] * 8)
    query = (f"INSERT INTO audit_log (report_id, question_id, action, edits, reply, note, reviewer, created_at) "
             f"VALUES ({marks}) RETURNING {', '.join(COLUMNS)}")
    with closing(connect()) as connection, transaction(connection):
        rows = [connection.execute(query, (entry.report_id, entry.question_id, entry.action, json.dumps(entry.edits, ensure_ascii=False),
                                           entry.reply, entry.note, entry.reviewer, created_at)).fetchone()
                for entry in entries]
    return [row_to_entry(row) for row in rows]


def list_audit_entries() -> list[dict]:
    with closing(connect()) as connection:
        rows = connection.execute(f"SELECT {', '.join(COLUMNS)} FROM audit_log ORDER BY id DESC").fetchall()
    return [row_to_entry(row) for row in rows]
