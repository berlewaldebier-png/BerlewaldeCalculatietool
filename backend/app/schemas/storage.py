from __future__ import annotations

from pydantic import BaseModel


class StorageStatus(BaseModel):
    provider: str
    postgres_enabled: bool
    postgres_configured: bool
