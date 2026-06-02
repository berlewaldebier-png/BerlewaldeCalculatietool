from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TRANSIENT_STATUSES = {429, 500, 502, 503, 504}


def parse_json_payload(raw: str) -> dict[str, Any]:
    parsed = json.loads(raw or "")
    if not isinstance(parsed, dict):
        raise ValueError("Expected JSON object")
    return parsed


async def probe_url(url: str, method: str) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "calculatietool/0.1 (+http://localhost)",
    }
    body = "x=1" if method.upper() == "POST" else None

    async with httpx.AsyncClient(follow_redirects=False, timeout=10.0) as client:
        try:
            response = await client.request(method.upper(), url, headers=headers, content=body)
            return {
                "ok": True,
                "status": response.status_code,
                "url": str(response.url),
                "server": response.headers.get("Server", ""),
                "allow": response.headers.get("Allow", ""),
                "location": response.headers.get("Location", ""),
            }
        except httpx.RequestError as exc:
            logger.exception("Douano probe failed")
            return {"ok": False, "status": None, "url": url, "error": str(exc)}


async def request(
    *,
    tokens: dict[str, Any],
    method: str,
    url: str,
    form: dict[str, str] | None = None,
    timeout: int = 20,
    retries: int = 2,
    retry_delays: tuple[float, ...] = (0.25, 1.0),
) -> tuple[int, dict[str, str], str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "calculatietool/0.1 (+http://localhost)",
    }
    access = str(tokens.get("access_token", "") or "").strip()
    if access:
        headers["Authorization"] = f"Bearer {access}"

    data = None
    if form is not None:
        data = form
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    attempts = max(1, int(retries) + 1)
    last_response: tuple[int, dict[str, str], str] = (0, {}, "")
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        for attempt in range(attempts):
            try:
                response = await client.request(method.upper(), url, headers=headers, data=data)
                raw = response.text
                status = response.status_code
                last_response = (status, dict(response.headers.items()), raw)
            except httpx.RequestError:
                logger.exception("Douano request failed")
                last_response = (0, {}, "")

            status = int(last_response[0] or 0)
            if status not in TRANSIENT_STATUSES and status > 0:
                return last_response
            if attempt < attempts - 1:
                await asyncio.sleep(retry_delays[min(attempt, len(retry_delays) - 1)])

    return last_response
