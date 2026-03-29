from __future__ import annotations

import os
from pathlib import Path
import re


BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
BACKEND_ENV_FILE = BACKEND_ROOT / ".env.local.ps1"


def _load_powershell_env_file() -> None:
    if not BACKEND_ENV_FILE.exists():
        return

    pattern = re.compile(r'^\$env:([A-Z0-9_]+)\s*=\s*"(.*)"\s*$')
    for raw_line in BACKEND_ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = pattern.match(line)
        if not match:
            continue

        key, value = match.groups()
        os.environ.setdefault(key, value)


_load_powershell_env_file()
