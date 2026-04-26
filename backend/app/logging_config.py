"""Logging configuration for the application."""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_LEVEL = os.getenv("CALCULATIETOOL_LOG_LEVEL", "INFO").upper()


def setup_logging() -> None:
    """Configure application-wide logging."""
    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(LOG_LEVEL)

    # Format
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(LOG_LEVEL)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # File handler (rotating)
    file_handler = logging.handlers.RotatingFileHandler(
        LOG_DIR / "calculatietool.log",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
    )
    file_handler.setLevel(LOG_LEVEL)
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    # Log startup
    logger = logging.getLogger(__name__)
    logger.info(f"Logging initialized at level {LOG_LEVEL}")


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for a module."""
    return logging.getLogger(name)
