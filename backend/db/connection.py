import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

LOCAL_DATABASE = Path(__file__).resolve().parent.parent / "audit.sqlite3"

Connection = psycopg.Connection | sqlite3.Connection
Result = TypeVar("Result")
_pool: ConnectionPool | None = None


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
