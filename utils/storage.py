"""Test compatibility shim.

The canonical implementation lives in `app.utils.storage` (backend runtime).
This module exists so unit tests can `from utils import storage` and patch
`utils.storage.*` without accidentally importing a third-party `utils` package.
"""

from app.utils.storage import *  # noqa: F403

