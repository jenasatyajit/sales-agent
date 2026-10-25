"""Environment-driven configuration. Values come from backend/.env (see .env.example)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    sarvam_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./pitch_simulator.db"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    allowed_origin: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
