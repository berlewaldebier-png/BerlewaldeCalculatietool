"""Database connection pooling for PostgreSQL.

Provides a singleton connection pool that manages connections efficiently
across requests and prevents connection exhaustion.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator

_pool: Any = None


def initialize_pool(database_url: str, min_size: int = 5, max_size: int = 20) -> None:
    """Initialize the connection pool.
    
    Args:
        database_url: PostgreSQL connection URL
        min_size: Minimum number of connections to maintain
        max_size: Maximum number of connections allowed
    """
    global _pool
    
    if _pool is not None:
        return  # Already initialized
    
    try:
        from psycopg_pool import ConnectionPool
    except ImportError as exc:
        raise RuntimeError(
            "psycopg-pool is required for connection pooling. "
            "Install with: pip install psycopg-pool"
        ) from exc
    
    if not database_url:
        raise ValueError("database_url cannot be empty")
    
    _pool = ConnectionPool(database_url, min_size=min_size, max_size=max_size)
    _pool.open()


def get_pool() -> Any:
    """Get the connection pool instance."""
    if _pool is None:
        raise RuntimeError(
            "Connection pool not initialized. Call initialize_pool() first."
        )
    return _pool


@contextmanager
def get_connection() -> Iterator[Any]:
    """Get a connection from the pool.
    
    Usage:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


def close_pool() -> None:
    """Close the connection pool. Should be called on application shutdown."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def is_pool_initialized() -> bool:
    """Check if the pool is initialized."""
    return _pool is not None
