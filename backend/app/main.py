from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.data import router as data_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.meta import router as meta_router
from app.domain import postgres_storage


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
app.include_router(auth_router, prefix="/api")
app.include_router(integrations_router, prefix="/api")


@app.middleware("http")
async def postgres_request_connection(request, call_next):
    # One connection per request, reused across dataset loads.
    if postgres_storage.uses_postgres() and postgres_storage.database_url():
        psycopg = postgres_storage._require_psycopg()
        conn = psycopg.connect(postgres_storage.database_url())
        token = postgres_storage.set_request_connection(conn)
        try:
            response = await call_next(request)
        finally:
            try:
                conn.close()
            finally:
                postgres_storage.reset_request_connection(token)
        return response

    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "calculatietool-api"}
