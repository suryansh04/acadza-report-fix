import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

LOCAL_DATABASE = Path(__file__).resolve().parent / "audit.sqlite3"

Connection = psycopg.Connection | sqlite3.Connection
Result = TypeVar("Result")
_pool: ConnectionPool | None = None


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or None


def open_pool() -> None:
    """A new Supabase connection takes seconds, so requests borrow open ones."""
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
    """Supabase can drop an idle connection. That fails before any write, so one retry is safe."""
    try:
        with _connection() as connection:
            return work(connection)
    except psycopg.OperationalError:
        with _connection() as connection:
            return work(connection)


def placeholder() -> str:
    return "%s" if database_url() else "?"
