from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.routes.auth import router as auth_router
from app.api.routes.data import router as data_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.meta import router as meta_router
from app.api.routes.quotes import router as quotes_router
from app.config_validation import validate_config, log_startup_info
from app.domain import postgres_storage, db_pool
from app.logging_config import setup_logging, get_logger
from app.rate_limits import limiter

# Initialize logging
setup_logging()
logger = get_logger(__name__)


app = FastAPI(
    title="CalculatieTool API",
    version="0.1.0",
    summary="Nieuwe backend voor de CalculatieTool met behoud van bestaande Python-logica.",
)

# Add rate limiting
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CALCULATIETOOL_CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(quotes_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(integrations_router, prefix="/api")


async def _open_request_connection() -> tuple[Any, Any]:
    connection_manager = db_pool.get_connection()
    conn = await run_in_threadpool(connection_manager.__enter__)
    return connection_manager, conn


async def _rollback_and_close_request_connection(connection_manager: Any, conn: Any) -> None:
    try:
        if not bool(getattr(conn, "closed", False)):
            await run_in_threadpool(conn.rollback)
    except Exception:
        logger.warning("Request database connection was already lost before rollback")
    finally:
        await run_in_threadpool(connection_manager.__exit__, None, None, None)


@app.on_event("startup")
def startup_event():
    """Initialize database connection pool and validate configuration."""
    logger.info("Initializing application...")
    
    try:
        # Validate critical configuration first
        validate_config()
        
        # Log startup information
        log_startup_info()
        
        # Initialize connection pool if using PostgreSQL
        if postgres_storage.uses_postgres():
            db_url = postgres_storage.database_url()
            logger.info("Initializing PostgreSQL connection pool...")
            db_pool.initialize_pool(db_url, min_size=5, max_size=20)
            logger.info("Connection pool initialized successfully")

            # Ensure base database schema is present before handling requests.
            postgres_storage.ensure_schema()
            logger.info("PostgreSQL schema ensured successfully")
        
        logger.info("Application startup complete")
    except Exception as e:
        logger.error(f"Startup failed: {e}")
        raise


@app.on_event("shutdown")
def shutdown_event():
    """Clean up resources on shutdown."""
    logger.info("Shutting down application...")
    
    if db_pool.is_pool_initialized():
        logger.info("Closing database connection pool...")
        db_pool.close_pool()
    
    logger.info("Application shutdown complete")


@app.middleware("http")
async def postgres_request_connection(request, call_next):
    """Bind a database connection to the request context for transaction support."""
    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return await call_next(request)

    if postgres_storage.uses_postgres() and postgres_storage.database_url():
        connection_manager, conn = await _open_request_connection()
        token = postgres_storage.set_request_connection(conn)
        try:
            return await call_next(request)
        finally:
            # Keep sync pool/rollback work out of the event loop.
            postgres_storage.reset_request_connection(token)
            await _rollback_and_close_request_connection(connection_manager, conn)

    return await call_next(request)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler for unhandled errors."""
    request_id = str(uuid.uuid4())
    logger.exception(
        "Unhandled exception",
        exc_info=exc,
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
        },
    )
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "request_id": request_id,
            "detail": "An unexpected error occurred. Please contact support with the request ID.",
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "calculatietool-api"}
