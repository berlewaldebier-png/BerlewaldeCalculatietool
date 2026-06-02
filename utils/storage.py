"""Compatibility alias for the backend storage module.

The canonical implementation lives in `app.utils.storage`. Older tests import
`utils.storage` and patch private helpers; aliasing the module keeps those
patches applied to the actual implementation.
"""

from __future__ import annotations

import sys

from app.utils import storage as _storage

sys.modules[__name__] = _storage
