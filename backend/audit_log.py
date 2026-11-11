import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

import psycopg

from database import Connection, database_url, run_with_connection, sql_placeholder

COLUMNS = ("id", "report_id", "question_id", "action", "edits", "reply", "note", "reviewer", "created_at")
INSERT_COLUMNS = COLUMNS[1:]
SELECT_COLUMNS = f"SELECT {', '.join(COLUMNS)} FROM audit_log"
LATEST_ENTRIES = f"{SELECT_COLUMNS} WHERE id IN (SELECT MAX(id) FROM audit_log GROUP BY report_id)"
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


EntryPlan = Callable[[dict[str, dict]], list[NewAuditEntry]]


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

    run_with_connection(create)


def row_to_entry(row: dict | sqlite3.Row) -> dict:
    entry = {column: row[column] for column in COLUMNS}
    entry["edits"] = json.loads(entry["edits"])
    return entry


def decisions_from_rows(rows: list) -> dict[str, dict]:
    entries = [row_to_entry(row) for row in rows]
    return {entry["report_id"]: entry for entry in entries if entry["action"] != "undo"}


def read_standing_decisions(connection: Connection) -> dict[str, dict]:
    return decisions_from_rows(connection.execute(LATEST_ENTRIES).fetchall())


def standing_decisions() -> dict[str, dict]:
    return run_with_connection(read_standing_decisions)


def build_insert(entries: list[NewAuditEntry]) -> tuple[str, list]:
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    row_marks = "(" + ", ".join([sql_placeholder()] * len(INSERT_COLUMNS)) + ")"
    values = [value for entry in entries for value in (entry.report_id, entry.question_id, entry.action,
                                                       json.dumps(entry.edits, ensure_ascii=False), entry.reply, entry.note,
                                                       entry.reviewer, created_at)]
    query = (f"INSERT INTO audit_log ({', '.join(INSERT_COLUMNS)}) VALUES {', '.join([row_marks] * len(entries))} "
             f"RETURNING {', '.join(COLUMNS)}")
    return query, values


def sorted_entries(rows: list) -> list[dict]:
    # RETURNING gives no fixed order, so sort by id.
    return sorted((row_to_entry(row) for row in rows), key=lambda entry: entry["id"])


def write_postgres(connection: psycopg.Connection, plan: EntryPlan) -> list[dict]:
    # Supabase is far away. Send all statements in 2 round trips.
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


def write_sqlite(connection: sqlite3.Connection, plan: EntryPlan) -> list[dict]:
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


def write_entries(plan: EntryPlan) -> list[dict]:
    """One locked transaction. If plan raises, nothing is saved."""
    return run_with_connection(lambda connection: write_postgres(connection, plan) if isinstance(connection, psycopg.Connection)
               else write_sqlite(connection, plan))


def list_audit_entries() -> list[dict]:
    return run_with_connection(lambda connection: [row_to_entry(row) for row in connection.execute(f"{SELECT_COLUMNS} ORDER BY id DESC").fetchall()])
