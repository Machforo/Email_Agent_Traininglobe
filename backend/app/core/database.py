from typing import Any, Dict
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.core.config import settings

client: AsyncIOMotorClient = None
db: AsyncIOMotorDatabase = None


async def connect_to_mongo():
    global client, db
    client = AsyncIOMotorClient(settings.MONGO_URI, serverSelectionTimeoutMS=8000)
    db = client[settings.MONGO_DB_NAME]

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


async def close_mongo_connection():
    global client
    if client:
        client.close()


def get_database() -> AsyncIOMotorDatabase:
    return db


def serialize_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Mongo ObjectId _id to string id for API responses."""
    if not doc:
        return doc
    res = dict(doc)
    if "_id" in res:
        res["id"] = str(res.pop("_id"))
    for k, v in res.items():
        if isinstance(v, dict):
            res[k] = serialize_doc(v)
        elif isinstance(v, list):
            res[k] = [serialize_doc(item) if isinstance(item, dict) else item for item in v]
    return res
