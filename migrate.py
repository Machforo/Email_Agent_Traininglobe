#!/usr/bin/env python3
"""
PostgreSQL to MongoDB Atlas Data Migration Script.

Migrates all tables and rows from a PostgreSQL database into a MongoDB Atlas database.
Configuration is loaded securely from the .env file.
"""

import argparse
import datetime
import decimal
import os
import re
import sys
import uuid
from typing import Any, Dict, List, Set

import psycopg2
import psycopg2.extras
import pymongo
from dotenv import load_dotenv


def sanitize_message(msg: Any) -> str:
    """Strip out potential credentials (usernames/passwords) from error messages or strings."""
    text = str(msg)
    # Masks uri schemes like postgresql://user:pass@host or mongodb+srv://user:pass@host
    return re.sub(r"://([^:@\s]+):([^@\s]+)@", r"://***:***@", text)


def convert_value(val: Any) -> Any:
    """
    Convert PostgreSQL data types to MongoDB-compatible BSON types:
      - Decimal -> float
      - UUID -> str
      - date -> datetime (pure dates converted to datetime at midnight)
      - bytes / memoryview -> bytes
      - JSON / JSONB -> nested dicts and lists (recursively converted)
      - arrays / lists -> list of converted values
    """
    if val is None:
        return None
    if isinstance(val, decimal.Decimal):
        return float(val)
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, datetime.datetime):
        return val
    if isinstance(val, datetime.date):
        return datetime.datetime(val.year, val.month, val.day)
    if isinstance(val, (bytes, memoryview)):
        return bytes(val)
    if isinstance(val, dict):
        return {str(k): convert_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [convert_value(item) for item in val]
    return val


def get_public_tables(pg_conn) -> List[str]:
    """Discover all base tables in the Postgres 'public' schema using information_schema."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
            """
        )
        return [row[0] for row in cur.fetchall()]


def get_tables_with_id_pk(pg_conn) -> Set[str]:
    """Find all tables in the 'public' schema whose primary key is named 'id'."""
    with pg_conn.cursor() as cur:
        cur.execute(
            """
            SELECT tc.table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = 'public'
              AND kcu.column_name = 'id';
            """
        )
        return {row[0] for row in cur.fetchall()}


def get_pg_row_count(pg_conn, table_name: str) -> int:
    """Get the exact row count for a given table in Postgres."""
    with pg_conn.cursor() as cur:
        cur.execute(f'SELECT COUNT(*) FROM "public"."{table_name}"')
        return cur.fetchone()[0]


def migrate():
    parser = argparse.ArgumentParser(
        description="Migrate all data from local PostgreSQL to MongoDB Atlas."
    )
    parser.add_argument(
        "--drop",
        action="store_true",
        help="Confirm dropping existing target collections before migrating. "
        "If not specified, tables that already contain data in MongoDB will be skipped.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Batch size for server-side streaming cursor (default: 1000).",
    )
    args = parser.parse_args()

    # Load environment variables
    load_dotenv()
    database_url = os.getenv("DATABASE_URL")
    mongo_uri = os.getenv("MONGO_URI")
    mongo_db_name = os.getenv("MONGO_DB_NAME")

    if not database_url:
        print("[ERROR] DATABASE_URL is not set in the environment or .env file.")
        sys.exit(1)
    if not mongo_uri:
        print("[ERROR] MONGO_URI is not set in the environment or .env file.")
        sys.exit(1)
    if not mongo_db_name:
        print("[ERROR] MONGO_DB_NAME is not set in the environment or .env file.")
        sys.exit(1)

    print("================================================================================")
    print("                POSTGRESQL -> MONGODB ATLAS DATA MIGRATOR                       ")
    print("================================================================================")
    print(f"Target Database: {mongo_db_name}")
    print(f"Batch Size:      {args.batch_size}")
    print(f"Drop Existing:   {'ENABLED (--drop)' if args.drop else 'DISABLED (tables with data will be skipped)'}")
    print("--------------------------------------------------------------------------------")

    # Connect to PostgreSQL
    try:
        pg_conn = psycopg2.connect(database_url)
        # Register automatic JSON/JSONB decoding so dicts and lists are returned natively
        psycopg2.extras.register_default_json(pg_conn)
        psycopg2.extras.register_default_jsonb(pg_conn)
        print("[OK] Connected to PostgreSQL successfully.")
    except psycopg2.Error as e:
        print("\n[ERROR] PostgreSQL Connection Failure: Unable to connect to PostgreSQL database.")
        print("Please verify the DATABASE_URL variable in your .env file and ensure the Postgres server is running.")
        print(f"Details: {sanitize_message(e)}\n")
        sys.exit(1)

    # Connect to MongoDB Atlas
    try:
        mongo_client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=10000)
        # Ping the server to verify connectivity and credentials
        mongo_client.admin.command("ping")
        mongo_db = mongo_client[mongo_db_name]
        print("[OK] Connected to MongoDB Atlas successfully.")
    except pymongo.errors.PyMongoError as e:
        print("\n[ERROR] MongoDB Connection Failure: Unable to connect to MongoDB Atlas.")
        print("Please verify MONGO_URI and MONGO_DB_NAME in your .env file.")
        print("Important: Ensure your current IP address is whitelisted in MongoDB Atlas Network Access.")
        print(f"Details: {sanitize_message(e)}\n")
        pg_conn.close()
        sys.exit(1)

    print("--------------------------------------------------------------------------------")

    # Discover tables
    try:
        tables = get_public_tables(pg_conn)
        tables_with_id_pk = get_tables_with_id_pk(pg_conn)
    except Exception as e:
        print(f"[ERROR] Failed to discover tables in schema 'public': {sanitize_message(e)}")
        pg_conn.close()
        mongo_client.close()
        sys.exit(1)

    if not tables:
        print("No tables found in PostgreSQL schema 'public'. Nothing to migrate.")
        pg_conn.close()
        mongo_client.close()
        return

    print(f"Discovered {len(tables)} table(s) in 'public' schema:")
    for t in tables:
        pk_info = " [PK: 'id' -> '_id']" if t in tables_with_id_pk else ""
        print(f"  - {t}{pk_info}")
    print("--------------------------------------------------------------------------------")

    summary_records = []

    for table_name in tables:
        collection = mongo_db[table_name]
        has_id_pk = table_name in tables_with_id_pk

        try:
            pg_count = get_pg_row_count(pg_conn, table_name)
        except Exception as e:
            print(f"[{table_name}] Error reading row count from Postgres: {sanitize_message(e)}")
            pg_conn.rollback()
            pg_count = -1

        # Check existing collection state
        try:
            existing_doc_count = collection.count_documents({})
        except Exception as e:
            print(f"[{table_name}] Error querying MongoDB collection: {sanitize_message(e)}")
            summary_records.append({
                "table": table_name,
                "pg_count": pg_count,
                "mongo_count": -1,
                "status": "FAILED",
                "notes": "MongoDB query error",
            })
            continue

        if existing_doc_count > 0:
            if args.drop:
                collection.drop()
                print(f"[{table_name}] Target collection dropped ({existing_doc_count} existing documents removed).")
            else:
                print(f"[{table_name}] SKIPPED: collection already contains {existing_doc_count} document(s). Use --drop to overwrite.")
                summary_records.append({
                    "table": table_name,
                    "pg_count": pg_count,
                    "mongo_count": existing_doc_count,
                    "status": "SKIPPED",
                    "notes": "Collection already contains data (use --drop to overwrite)",
                })
                continue

        # If Postgres table is empty
        if pg_count == 0:
            print(f"[{table_name}] 0 rows in PostgreSQL. Nothing to migrate.")
            summary_records.append({
                "table": table_name,
                "pg_count": 0,
                "mongo_count": collection.count_documents({}),
                "status": "MATCH",
                "notes": "Empty table",
            })
            continue

        # Stream table rows using a server-side named cursor
        print(f"[{table_name}] Starting migration ({pg_count} row(s) to migrate)...")
        cursor_name = f"cur_{re.sub(r'[^a-zA-Z0-9_]', '_', table_name)}_{uuid.uuid4().hex[:8]}"
        rows_migrated = 0
        table_failed = False

        try:
            with pg_conn.cursor(name=cursor_name) as cur:
                cur.itersize = args.batch_size
                cur.execute(f'SELECT * FROM "public"."{table_name}"')
                col_names = None

                while True:
                    rows = cur.fetchmany(args.batch_size)
                    if not rows:
                        break

                    if col_names is None:
                        col_names = [desc[0] for desc in cur.description]

                    docs = []
                    for row in rows:
                        row_dict = dict(zip(col_names, row))
                        converted = {k: convert_value(v) for k, v in row_dict.items()}
                        if has_id_pk and "id" in converted:
                            converted["_id"] = converted.pop("id")
                        docs.append(converted)

                    if docs:
                        collection.insert_many(docs)
                        rows_migrated += len(docs)
                        print(f"  -> [{table_name}] {rows_migrated}/{pg_count} rows migrated...")

            # Commit the read transaction to release server-side cursor resources
            pg_conn.commit()
            print(f"[{table_name}] COMPLETED: {rows_migrated} rows migrated successfully.")

        except Exception as e:
            table_failed = True
            print(f"[ERROR] Batch migration failed for table '{table_name}': {sanitize_message(e)}")
            print(f"Continuing with next table...")
            try:
                pg_conn.rollback()
            except Exception:
                pass

        final_mongo_count = collection.count_documents({})
        if table_failed:
            status = "FAILED"
        elif pg_count == final_mongo_count:
            status = "MATCH"
        else:
            status = "MISMATCH"

        summary_records.append({
            "table": table_name,
            "pg_count": pg_count,
            "mongo_count": final_mongo_count,
            "status": status,
            "notes": "OK" if status == "MATCH" else "Count mismatch or batch failure",
        })

    # Close database connections
    try:
        pg_conn.close()
    except Exception:
        pass
    try:
        mongo_client.close()
    except Exception:
        pass

    # Print summary table
    print("\n" + "=" * 80)
    print("                            MIGRATION SUMMARY")
    print("=" * 80)
    print(f"{'Table Name':<32} {'Postgres Rows':<15} {'MongoDB Docs':<15} {'Status':<10}")
    print("-" * 80)

    total_pg = 0
    total_mongo = 0
    matches = 0
    mismatches = 0
    skipped = 0
    failed = 0

    for rec in summary_records:
        t_name = rec["table"]
        p_cnt = rec["pg_count"]
        m_cnt = rec["mongo_count"]
        st = rec["status"]

        if p_cnt >= 0:
            total_pg += p_cnt
        if m_cnt >= 0:
            total_mongo += m_cnt

        if st == "MATCH":
            matches += 1
        elif st == "MISMATCH":
            mismatches += 1
        elif st == "SKIPPED":
            skipped += 1
        elif st == "FAILED":
            failed += 1

        print(f"{t_name:<32} {str(p_cnt):<15} {str(m_cnt):<15} {st:<10}")

    print("=" * 80)
    print(
        f"Total Tables: {len(summary_records)} | "
        f"Matched: {matches} | "
        f"Mismatched: {mismatches} | "
        f"Skipped: {skipped} | "
        f"Failed: {failed}"
    )
    print(f"Total Rows: PostgreSQL = {total_pg} | MongoDB = {total_mongo}")
    print("=" * 80)

    if mismatches > 0 or failed > 0:
        print("\n[WARNING] Migration finished with errors or count mismatches. Please inspect the log above.")
        sys.exit(1)
    else:
        print("\n[SUCCESS] Migration completed successfully with all counts matching!")


if __name__ == "__main__":
    migrate()
