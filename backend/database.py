import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from typing import TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

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
        pool = ConnectionPool(database_url(), min_size=1, max_size=5, open=True, name="audit",
                              kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None})
        try:
            pool.wait()
        except PoolTimeout as error:
            pool.close()
            raise RuntimeError("Could not connect to the database in DATABASE_URL. Check the URL in .env, or in the Render settings.") from error
        _pool = pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def _connection() -> Iterator[Connection]:
    if database_url():
        # The server opens the pool at start. Code that runs without the server opens it here, on first use.
        open_pool()
        with _pool.connection() as connection:
            yield connection
        return
    connection = sqlite3.connect(LOCAL_DATABASE, isolation_level=None, timeout=10)
    connection.row_factory = sqlite3.Row
    with closing(connection):
        yield connection


def run_with_connection(work: Callable[[Connection], Result]) -> Result:
    """Supabase can drop an idle connection, so retry once. A retry cannot save twice: each save reads the decisions again."""
    try:
        with _connection() as connection:
            return work(connection)
    except psycopg.OperationalError:
        with _connection() as connection:
            return work(connection)


def sql_placeholder() -> str:
    return "%s" if database_url() else "?"
