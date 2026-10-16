from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import close_mongo_connection, connect_to_mongo
from app.services.scheduler_service import start_scheduler, stop_scheduler
from app.api import approvals, audit, auth, emails, leads, reports, settings as settings_api


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB Atlas & start background scheduler
    await connect_to_mongo()
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()
    await close_mongo_connection()


app = FastAPI(
    title="Traininglobe AI Lead Nurturing",
    description="Intelligent B2B Lead Nurturing with Mandatory Human Approval, Zoho Integration, and Grounded AI Outreach",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for React dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth.router, prefix="/api")
app.include_router(leads.router, prefix="/api")
app.include_router(approvals.router, prefix="/api")
app.include_router(emails.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(audit.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Traininglobe AI Lead Nurturing API",
        "dry_run_mode": settings.ZOHO_DRY_RUN
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
