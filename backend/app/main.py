from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import close_mongo_connection, connect_to_mongo
from app.services.scheduler_service import start_scheduler, stop_scheduler, recover_pending_scheduled, check_scheduled_deliveries
from app.services.reminder_service import process_due_reminders
from app.services.template_service import seed_templates_and_kb
from app.api import approvals, audit, auth, emails, leads, notifications, reports, settings as settings_api


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB Atlas & start background scheduler
    await connect_to_mongo()
    start_scheduler()
    # Seed templates & KB and recover any pending reminders and scheduled deliveries immediately on server startup
    try:
        await seed_templates_and_kb()
        await recover_pending_scheduled()
        await process_due_reminders()
        await check_scheduled_deliveries()
    except Exception:
        pass
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

import logging
import uuid
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("app.main")

# Enable CORS for React dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = uuid.uuid4().hex[:8]
    logger.error(
        f"[Req {request_id}] Unhandled exception on {request.method} {request.url.path}: {exc}",
        exc_info=True
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "An unexpected error occurred. Please try again.",
            "request_id": request_id
        }
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "status_code": exc.status_code
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "message": "Invalid request parameters"
        }
    )

# Register API Routers
app.include_router(auth.router, prefix="/api")
app.include_router(leads.router, prefix="/api")
app.include_router(approvals.router, prefix="/api")
app.include_router(emails.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")


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
