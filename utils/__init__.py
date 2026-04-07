"""Compatibility utilities for tests and one-off scripts.

The production backend imports helpers from `app.utils.*`.
Older tests historically imported `utils.storage`; we keep a thin
re-export layer here to avoid accidental imports of unrelated 3rd party
packages named `utils`.
"""

