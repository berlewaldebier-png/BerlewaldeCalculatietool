from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


def _read_json(response: urllib.response.addinfourl) -> Any:
    raw = response.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def _float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class Coordinate:
    lat: float
    lng: float


class OrsClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("CALCULATIETOOL_ORS_BASE_URL", "").strip() or "https://api.openrouteservice.org"
        self.api_key = os.getenv("CALCULATIETOOL_ORS_API_KEY", "").strip()

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _auth_headers(self) -> dict[str, str]:
        # ORS supports API keys via Authorization header. Using headers avoids issues with
        # proxies/logs leaking query params and matches official examples.
        return {
            # ORS v2 directions responds with GeoJSON.
            "Accept": "application/geo+json;charset=UTF-8",
            "Authorization": self.api_key,
            # Some upstreams reject requests without a UA; keep it explicit.
            "User-Agent": "CalculatieTool/1.0",
        }

    def geocode(self, query: str, *, country: str = "NL", focus: Coordinate | None = None) -> Coordinate | None:
        if not self.api_key:
            raise RuntimeError("ORS API key ontbreekt (CALCULATIETOOL_ORS_API_KEY).")
        q = str(query or "").strip()
        if not q:
            return None

        params = {
            "text": q,
            "size": "1",
            "boundary.country": str(country or "NL").upper(),
        }
        if focus is not None:
            params["focus.point.lat"] = str(focus.lat)
            params["focus.point.lon"] = str(focus.lng)
        url = f"{self.base_url.rstrip('/')}/geocode/search?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url=url, headers=self._auth_headers())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = _read_json(resp)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
            raise RuntimeError(f"ORS geocode faalde ({exc.code}): {body[:500]}".strip()) from exc
        features = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(features, list) or not features:
            return None
        first = features[0]
        geom = first.get("geometry") if isinstance(first, dict) else None
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if not isinstance(coords, list) or len(coords) < 2:
            return None
        lng = _float(coords[0])
        lat = _float(coords[1])
        if abs(lat) < 0.0001 and abs(lng) < 0.0001:
            return None
        return Coordinate(lat=lat, lng=lng)

    def driving_distance_km_one_way(self, start: Coordinate, end: Coordinate, *, profile: str = "driving-car") -> float | None:
        if not self.api_key:
            raise RuntimeError("ORS API key ontbreekt (CALCULATIETOOL_ORS_API_KEY).")
        prof = str(profile or "driving-car").strip() or "driving-car"
        params = {"start": f"{start.lng},{start.lat}", "end": f"{end.lng},{end.lat}"}
        url = f"{self.base_url.rstrip('/')}/v2/directions/{urllib.parse.quote(prof)}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url=url, headers=self._auth_headers())
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                payload = _read_json(resp)
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                body = ""
            raise RuntimeError(f"ORS route faalde ({exc.code}): {body[:500]}".strip()) from exc
        features = payload.get("features") if isinstance(payload, dict) else None
        if not isinstance(features, list) or not features:
            return None
        props = features[0].get("properties") if isinstance(features[0], dict) else None
        summary = props.get("summary") if isinstance(props, dict) else None
        dist_m = summary.get("distance") if isinstance(summary, dict) else None
        km = _float(dist_m) / 1000.0
        return km if km > 0 else None
