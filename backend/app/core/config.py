import os
from typing import List
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Load root or local .env
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env"))


class Settings(BaseSettings):
    # Database
    MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB_NAME: str = os.getenv("MONGO_DB_NAME", "traininglobe_lead_nurturing")

    # Security & Auth
    JWT_SECRET: str = os.getenv("JWT_SECRET", "default_secret_key_change_in_production_123456789")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

    # Initial Super Admin
    SUPERADMIN_EMAIL: str = os.getenv("SUPERADMIN_EMAIL", "admin@traininglobe.com")
    SUPERADMIN_PASSWORD: str = os.getenv("SUPERADMIN_PASSWORD", "121archis")
    SUPERADMIN_NAME: str = os.getenv("SUPERADMIN_NAME", "Super Admin")

    # Zoho Configuration
    ZOHO_CLIENT_ID: str = os.getenv("ZOHO_CLIENT_ID", "")
    ZOHO_CLIENT_SECRET: str = os.getenv("ZOHO_CLIENT_SECRET", "")
    ZOHO_REFRESH_TOKEN: str = os.getenv("ZOHO_REFRESH_TOKEN", "")
    ZOHO_AUTH_URL: str = os.getenv("ZOHO_AUTH_URL", "https://accounts.zoho.in")
    ZOHO_API_DOMAIN: str = os.getenv("ZOHO_API_DOMAIN", "https://www.zohoapis.in")
    ZOHO_FROM_EMAIL: str = os.getenv("ZOHO_FROM_EMAIL", "outreach@traininglobe.com")
    ZOHO_DRY_RUN: bool = os.getenv("ZOHO_DRY_RUN", "true").lower() in ("true", "1", "yes")

    # LLM Settings
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "mock").lower()
    LLM_MODEL: str = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")

    # Business Rules
    DEFAULT_SEND_TIME: str = os.getenv("DEFAULT_SEND_TIME", "18:00")
    TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Kolkata")
    BUSINESS_HOURS_START: int = int(os.getenv("BUSINESS_HOURS_START", "9"))
    BUSINESS_HOURS_END: int = int(os.getenv("BUSINESS_HOURS_END", "19"))
    DAILY_SEND_LIMIT: int = int(os.getenv("DAILY_SEND_LIMIT", "100"))
    MAX_FOLLOWUPS: int = int(os.getenv("MAX_FOLLOWUPS", "3"))

    class Config:
        case_sensitive = True
        extra = "allow"


settings = Settings()
