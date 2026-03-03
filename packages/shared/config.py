"""
Configuration management using Pydantic Settings.
Loads from environment variables and .env files.
"""

from functools import lru_cache
from typing import Optional

from pydantic import Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """PostgreSQL database configuration."""

    host: str = Field(default="localhost", alias="POSTGRES_HOST")
    port: int = Field(default=5432, alias="POSTGRES_PORT")
    db: str = Field(default="worlddash", alias="POSTGRES_DB")
    user: str = Field(default="worlddash", alias="POSTGRES_USER")
    password: str = Field(default="changeme", alias="POSTGRES_PASSWORD")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def url(self) -> str:
        """Generate PostgreSQL connection URL."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.db}"

    @property
    def async_url(self) -> str:
        """Generate async PostgreSQL connection URL."""
        return f"postgresql+asyncpg://{self.user}:{self.password}@{self.host}:{self.port}/{self.db}"


class RedisSettings(BaseSettings):
    """Redis configuration."""

    host: str = Field(default="localhost", alias="REDIS_HOST")
    port: int = Field(default=6379, alias="REDIS_PORT")
    db: int = Field(default=0, alias="REDIS_DB")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def url(self) -> str:
        """Generate Redis connection URL."""
        return f"redis://{self.host}:{self.port}/{self.db}"


class CelerySettings(BaseSettings):
    """Celery task queue configuration."""

    broker_url: str = Field(default="redis://localhost:6379/1", alias="CELERY_BROKER_URL")
    result_backend: str = Field(
        default="redis://localhost:6379/2", alias="CELERY_RESULT_BACKEND"
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class APISettings(BaseSettings):
    """FastAPI application configuration."""

    host: str = Field(default="0.0.0.0", alias="API_HOST")
    port: int = Field(default=8000, alias="API_PORT")
    workers: int = Field(default=4, alias="API_WORKERS")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    reload: bool = Field(default=False, alias="API_RELOAD")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class IngestionSettings(BaseSettings):
    """Feed ingestion configuration."""

    poll_interval_seconds: int = Field(default=300, alias="FEED_POLL_INTERVAL_SECONDS")
    max_retries: int = Field(default=3, alias="MAX_FEED_RETRIES")
    request_timeout_seconds: int = Field(default=30, alias="REQUEST_TIMEOUT_SECONDS")
    user_agent: str = Field(
        default="WorldDash/1.0 (+https://github.com/worlddash)", alias="USER_AGENT"
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ObservabilitySettings(BaseSettings):
    """Observability and monitoring configuration."""

    enable_metrics: bool = Field(default=True, alias="ENABLE_METRICS")
    enable_tracing: bool = Field(default=True, alias="ENABLE_TRACING")
    metrics_port: int = Field(default=9090, alias="METRICS_PORT")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class OllamaSettings(BaseSettings):
    """Ollama / LLM configuration."""

    endpoint: str = Field(default="http://localhost:11434", alias="OLLAMA_ENDPOINT")
    model: str = Field(default="llama2", alias="OLLAMA_MODEL")
    embedding_model: str = Field(default="nomic-embed-text", alias="OLLAMA_EMBEDDING_MODEL")
    timeout_seconds: int = Field(default=60, alias="OLLAMA_TIMEOUT_SECONDS")
    enabled: bool = Field(default=True, alias="OLLAMA_ENABLED")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class Settings(BaseSettings):
    """Main application settings aggregator."""

    environment: str = Field(default="development", alias="ENVIRONMENT")

    # Sub-configurations
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    redis: RedisSettings = Field(default_factory=RedisSettings)
    celery: CelerySettings = Field(default_factory=CelerySettings)
    api: APISettings = Field(default_factory=APISettings)
    ingestion: IngestionSettings = Field(default_factory=IngestionSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)
    ollama: OllamaSettings = Field(default_factory=OllamaSettings)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached application settings.
    Uses LRU cache to ensure settings are loaded only once.
    """
    return Settings()
