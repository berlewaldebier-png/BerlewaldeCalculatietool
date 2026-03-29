from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.data import router as data_router
from app.api.routes.meta import router as meta_router


app = FastAPI(
    title="CalculatieTool API",
    version="0.1.0",
    summary="Nieuwe backend voor de CalculatieTool met behoud van bestaande Python-logica.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(auth_router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "calculatietool-api"}
