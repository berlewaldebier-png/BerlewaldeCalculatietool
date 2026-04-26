from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.data import router as data_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.meta import router as meta_router
from app.api.routes.quotes import router as quotes_router
from app.domain import postgres_storage, db_pool

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CalculatieTool API",
    version="0.1.0",
    summary="Nieuwe backend voor de CalculatieTool met behoud van bestaande Python-logica.",
)

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


@app.on_event("startup")
def startup_event():
    """Initialize database connection pool and validate configuration."""
    logger.info("Initializing application...")
    
    # Validate critical configuration
    if postgres_storage.uses_postgres():
        db_url = postgres_storage.database_url()
        if not db_url:
            raise RuntimeError("PostgreSQL configured but connection URL missing")
        
        logger.info("Initializing PostgreSQL connection pool...")
        db_pool.initialize_pool(db_url, min_size=5, max_size=20)
        logger.info("Connection pool initialized successfully")
    
    logger.info("Application startup complete")


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
    if postgres_storage.uses_postgres() and postgres_storage.database_url():
        with db_pool.get_connection() as conn:
            token = postgres_storage.set_request_connection(conn)
            try:
                response = await call_next(request)
            finally:
                postgres_storage.reset_request_connection(token)
            return response

    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "calculatietool-api"}
