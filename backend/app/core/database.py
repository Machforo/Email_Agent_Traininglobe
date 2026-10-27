from typing import Any, Dict
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import certifi
from app.core.config import settings

client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None


async def connect_to_mongo():
    global client, db
    uri = settings.MONGO_URI
    kwargs = {"serverSelectionTimeoutMS": 4000}
    if "mongodb+srv://" in uri or "tls=true" in uri.lower() or "ssl=true" in uri.lower():
        try:
            kwargs["tlsCAFile"] = certifi.where()
        except Exception:
            pass
    try:
        client = AsyncIOMotorClient(uri, **kwargs)
        # Test connection
        await client.admin.command("ping")
        db = client[settings.MONGO_DB_NAME]
        print(f"[SUCCESS] Connected to primary MongoDB successfully: {settings.MONGO_DB_NAME}")
    except Exception as exc:
        print(f"[WARN] Failed to connect to primary MongoDB at {uri}: {exc}")
        print("[INFO] Falling back to local MongoDB at mongodb://localhost:27017...")
        client = AsyncIOMotorClient("mongodb://localhost:27017", serverSelectionTimeoutMS=3000)
        await client.admin.command("ping")
        db = client[settings.MONGO_DB_NAME]
        print("[SUCCESS] Connected to local MongoDB successfully.")

    # Initialize collections and indexes
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("email", unique=True)
    await db.leads.create_index([("owner_id", 1), ("status", 1)])
    await db.company_research.create_index("lead_id")
    await db.emails.create_index("lead_id")
    await db.emails.create_index("thread_id")
    await db.emails.create_index("message_id")
    await db.emails.create_index("status")
    await db.opt_out_suppression.create_index("email", unique=True)
    await db.audit_logs.create_index([("user_id", 1), ("timestamp", -1)])
    await db.knowledge_base.create_index("category")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index("scheduled_email_id")
    await db.notifications.create_index("is_active")
    await db.emails.create_index("reminder_at")
    await db.emails.create_index("reminder_status")


async def close_mongo_connection():
    global client
    if client:
        client.close()


def get_database() -> AsyncIOMotorDatabase:
    return db


def serialize_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Mongo ObjectId _id to string id and all ObjectIds to string for API responses."""
    if not doc:
        return doc
    res = dict(doc)
    if "_id" in res:
        res["id"] = str(res.pop("_id"))
    for k, v in list(res.items()):
        if isinstance(v, ObjectId):
            res[k] = str(v)
        elif isinstance(v, dict):
            res[k] = serialize_doc(v)
        elif isinstance(v, list):
            res[k] = [
                serialize_doc(item) if isinstance(item, dict)
                else (str(item) if isinstance(item, ObjectId) else item)
                for item in v
            ]
    return res
