"""Configuration validation at startup.

Ensures all required environment variables and dependencies are set
before the application starts.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def validate_config() -> None:
    """Validate critical configuration before startup."""
    errors: list[str] = []
    
    # Check PostgreSQL configuration
    from app.domain import postgres_storage
    if postgres_storage.uses_postgres():
        if not postgres_storage.database_url():
            errors.append("PostgreSQL configured but missing connection URL (CALCULATIETOOL_POSTGRES_*)")
    
    # Check auth configuration
    from app.domain import auth_service
    if auth_service.auth_enabled():
        try:
            secret = auth_service._auth_secret()
            if "change-me" in secret.lower() or secret == "":
                errors.append("AUTH_SECRET is not properly configured (looks like default)")
        except RuntimeError as e:
            errors.append(f"AUTH_SECRET issue: {e}")
    
    # Check environment
    env = os.getenv("CALCULATIETOOL_ENV", "local").strip().lower()
    if env not in {"local", "dev", "development", "staging", "production"}:
        errors.append(f"Invalid CALCULATIETOOL_ENV: {env}")
    
    # Validate CORS origins
    cors_origins = os.getenv("CALCULATIETOOL_CORS_ORIGINS", "http://localhost:3000").split(",")
    if not cors_origins or not cors_origins[0].strip():
        errors.append("CALCULATIETOOL_CORS_ORIGINS is empty or not configured")
    
    # Log all configuration issues
    if errors:
        logger.error("Configuration validation failed:")
        for error in errors:
            logger.error(f"  - {error}")
        raise RuntimeError(f"Configuration validation failed with {len(errors)} error(s)")
    
    logger.info("Configuration validation passed")


def log_startup_info() -> None:
    """Log startup configuration for debugging."""
    from app.domain import postgres_storage, auth_service
    
    logger.info("=" * 60)
    logger.info("CalculatieTool API Startup")
    logger.info("=" * 60)
    logger.info(f"Environment: {auth_service.environment_name()}")
    logger.info(f"Storage Provider: {postgres_storage.storage_provider()}")
    logger.info(f"Auth Enabled: {auth_service.auth_enabled()}")
    logger.info(f"Auth Mode: {auth_service.auth_mode()}")
    logger.info("=" * 60)
