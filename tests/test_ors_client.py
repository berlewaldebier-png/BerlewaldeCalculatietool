from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain.ors_client import Coordinate, OrsClient


class _FakeAsyncResponse:
    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self._text = text
        self.headers: dict[str, str] = {}

    @property
    def text(self) -> str:
        return self._text


class _FakeAsyncClient:
    def __init__(self, response: _FakeAsyncResponse) -> None:
        self.response = response
        self.entered = False
        self.exited = False

    async def __aenter__(self) -> "_FakeAsyncClient":
        self.entered = True
        return self

    async def __aexit__(self, *_: object) -> None:
        self.exited = True

    async def get(self, *_: object, **__: object) -> _FakeAsyncResponse:
        return self.response


class OrsClientTests(unittest.TestCase):
    def test_geocode_returns_coordinate(self) -> None:
        payload = {
            "features": [
                {
                    "geometry": {"coordinates": [6.2, 51.95]},
                }
            ]
        }
        response = _FakeAsyncResponse(200, json.dumps(payload))
        client = _FakeAsyncClient(response)

        with patch("app.domain.ors_client.httpx.AsyncClient", return_value=client):
            coord = asyncio.run(OrsClient().geocode("Teststraat 1, NL"))

        self.assertIsNotNone(coord)
        self.assertEqual(coord.lat, 51.95)
        self.assertEqual(coord.lng, 6.2)
        self.assertTrue(client.entered)
        self.assertTrue(client.exited)

    def test_driving_distance_km_one_way_returns_distance(self) -> None:
        payload = {
            "features": [
                {
                    "properties": {"summary": {"distance": 12345.0}}
                }
            ]
        }
        response = _FakeAsyncResponse(200, json.dumps(payload))
        client = _FakeAsyncClient(response)

        with patch("app.domain.ors_client.httpx.AsyncClient", return_value=client):
            km = asyncio.run(
                OrsClient().driving_distance_km_one_way(
                    Coordinate(lat=51.95, lng=6.2),
                    Coordinate(lat=52.1, lng=6.3),
                )
            )

        self.assertAlmostEqual(km or 0.0, 12.345, places=3)

    def test_fetch_json_raises_runtime_error_on_bad_status(self) -> None:
        response = _FakeAsyncResponse(500, '{"error":"server"}')
        client = _FakeAsyncClient(response)

        with patch("app.domain.ors_client.httpx.AsyncClient", return_value=client):
            with self.assertRaises(RuntimeError) as exc:
                asyncio.run(OrsClient().geocode("Teststraat 1, NL"))

        self.assertIn("ORS request faalde", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
