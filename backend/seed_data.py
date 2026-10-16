import asyncio
import datetime
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.core.security import hash_password
from app.models.lead import LeadStatus


async def seed():
    print("================================================================================")
    print("           SEEDING TRAININGLOBE AI LEAD NURTURING DATABASE                      ")
    print("================================================================================")

    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]

    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Super Admin User
    superadmin_email = settings.SUPERADMIN_EMAIL.strip().lower()
    superadmin_pass = settings.SUPERADMIN_PASSWORD
    print(f"[*] Upserting Super Admin user: {superadmin_email}")

    superadmin_doc = {
        "email": superadmin_email,
        "name": settings.SUPERADMIN_NAME,
        "password_hash": hash_password(superadmin_pass),
        "role": "SUPER_ADMIN",
        "active": True,
        "created_at": now
    }
    await db.users.update_one(
        {"email": superadmin_email},
        {"$set": superadmin_doc},
        upsert=True
    )
    admin_user = await db.users.find_one({"email": superadmin_email})
    admin_id = str(admin_user["_id"])

    # 2. Staff Admin User
    staff_email = "member1@traininglobe.com"
    staff_doc = {
        "email": staff_email,
        "name": "Arjun Kumar (Sales Rep)",
        "password_hash": hash_password("Member@123"),
        "role": "ADMIN",
        "active": True,
        "created_at": now
    }
    await db.users.update_one(
        {"email": staff_email},
        {"$set": staff_doc},
        upsert=True
    )
    staff_user = await db.users.find_one({"email": staff_email})
    staff_id = str(staff_user["_id"])

    # 3. Knowledge Base
    print("[*] Seeding Traininglobe Knowledge Base...")
    kb_items = [
        {
            "category": "ABOUT",
            "title": "Traininglobe Core Identity",
            "content": "Traininglobe is a premier industry-mentored training organization. We deliver specialized hands-on technical programs designed to bridge the gap between academic/foundational knowledge and production engineering standards."
        },
        {
            "category": "SERVICES",
            "title": "Campus Placement Training",
            "content": "We partner with universities and colleges to run semester-aligned technical bootcamps in Fullstack Development, Cloud & DevOps, and Applied AI. Mentored by senior industry practitioners without altering core academic schedules."
        },
        {
            "category": "SERVICES",
            "title": "Corporate Talent Readiness",
            "content": "Customized 4-to-8 week onboarding academies for tech enterprises. We take new college hires and train them on production architecture, CI/CD, and coding standards, cutting ramp-up time by up to 50%."
        },
        {
            "category": "APPROVED_CLAIMS",
            "title": "Verified Program Standards",
            "content": "Every module is led by active software engineers with 5+ years experience. Over 85% of program time is spent on hands-on code reviews, real Git workflows, and system design exercises."
        },
        {
            "category": "RESTRICTIONS",
            "title": "Strict Guardrails for AI Outreaches",
            "content": "Never invent custom pricing, discounts, fake customer testimonials, or guarantee 100% job placement. All commercial quotes and bespoke contracts require formal evaluation by human account executives."
        }
    ]

    for item in kb_items:
        await db.knowledge_base.update_one(
            {"title": item["title"]},
            {"$set": {**item, "updated_at": now}},
            upsert=True
        )

    # 4. System Settings
    print("[*] Seeding System Settings...")
    settings_doc = {
        "_id": "global_config",
        "default_send_time": "18:00",
        "timezone": "Asia/Kolkata",
        "business_hours_start": 9,
        "business_hours_end": 19,
        "daily_send_limit": 100,
        "followup_intervals_days": [3, 5, 7],
        "max_followups": 3,
        "dry_run_mode": True,
        "updated_at": now
    }
    await db.system_settings.update_one(
        {"_id": "global_config"},
        {"$set": settings_doc},
        upsert=True
    )

    # 5. Realistic Leads & Approval Queue Samples
    print("[*] Seeding Sample Leads & Drafts...")
    sample_leads = [
        {
            "name": "Vikram Malhotra",
            "email": "vikram.malhotra@acme-healthtech.io",
            "company_name": "Acme HealthTech",
            "company_website": "https://acme-healthtech.io",
            "owner_id": admin_id,
            "source": "ZOHO_CRM",
            "status": LeadStatus.DRAFT_READY.value,
            "research": {
                "summary": "Acme HealthTech builds cloud-native telemetry and imaging software for hospitals across India.",
                "likely_needs": ["Microservices training for junior engineers", "HIPAA/HL7 compliance coding workshops"],
                "collaboration_opportunities": ["Custom junior dev backend bootcamp", "Mentored onboarding track"]
            },
            "draft": {
                "subject": "Quick thought on engineering talent onboarding at Acme HealthTech",
                "body": (
                    "Hi Vikram,\n\n"
                    "I was reviewing Acme HealthTech's healthcare telemetry systems and was impressed by your platform's scale.\n\n"
                    "At Traininglobe, we work with technical leadership to accelerate junior developer onboarding through industry-mentored "
                    "microservices and cloud workflows—helping teams cut initial ramp-up time by nearly half.\n\n"
                    "Would you be open to a 10-minute introductory call next Tuesday to see if this could be relevant for your upcoming hiring cohort?\n\n"
                    "Best regards,\nTraininglobe Team"
                )
            }
        },
        {
            "name": "Dr. Sunita Rao",
            "email": "sunita.rao@national-institute-tech.edu",
            "company_name": "National Institute of Science & Technology",
            "company_website": "https://nist.edu.in",
            "owner_id": staff_id,
            "source": "CSV_IMPORT",
            "status": LeadStatus.DRAFT_READY.value,
            "research": {
                "summary": "Premier autonomous engineering institute with 1,200+ annual computer science graduates.",
                "likely_needs": ["Industry-aligned AI/ML curriculum integration", "Live capstone project mentoring"],
                "collaboration_opportunities": ["Semester 7 elective delivery", "Placement readiness bootcamp"]
            },
            "draft": {
                "subject": "Bridging placement skill gaps for NIST 2027 graduates",
                "body": (
                    "Dear Dr. Rao,\n\n"
                    "I was following NIST's recent academic initiatives and student achievements in computer science.\n\n"
                    "Traininglobe collaborates directly with autonomous institutions to deliver industry-mentored training modules "
                    "that slot seamlessly into the existing academic timetable without disrupting exam schedules.\n\n"
                    "Would you be open to a short exploratory conversation on how we could support your next placement readiness cycle?\n\n"
                    "Warm regards,\nTraininglobe Partnerships"
                )
            }
        },
        {
            "name": "Rohit Verma",
            "email": "rohit@apexcloud.co",
            "company_name": "Apex Cloud Networks",
            "company_website": "https://apexcloud.co",
            "owner_id": admin_id,
            "source": "ZOHO_CRM",
            "status": LeadStatus.CONTACTED.value,
            "research": {
                "summary": "Fast-growing DevOps and SRE consultancy managing hybrid cloud Kubernetes deployments.",
                "likely_needs": ["Kubernetes and Terraform hands-on mentoring"],
                "collaboration_opportunities": ["Cloud engineering talent pipeline"]
            }
        },
        {
            "name": "Sneha Kulkarni",
            "email": "sneha.k@fintech-matrix.com",
            "company_name": "FinTech Matrix Solutions",
            "company_website": "https://fintech-matrix.com",
            "owner_id": admin_id,
            "source": "MANUAL",
            "status": LeadStatus.ENGAGED.value,
            "research": {
                "summary": "Digital lending API provider handling millions of daily banking micro-transactions.",
                "likely_needs": ["Distributed systems and high-concurrency training"],
                "collaboration_opportunities": ["Core engineering upskilling"]
            }
        }
    ]

    for item in sample_leads:
        lead_doc = {
            "name": item["name"],
            "email": item["email"].lower(),
            "company_name": item["company_name"],
            "company_website": item["company_website"],
            "owner_id": item["owner_id"],
            "source": item["source"],
            "status": item["status"],
            "followup_count": 1 if item["status"] in [LeadStatus.CONTACTED.value, LeadStatus.ENGAGED.value] else 0,
            "max_followups": 3,
            "next_action_at": now + datetime.timedelta(days=3),
            "preferred_contact_date": None,
            "created_at": now,
            "updated_at": now
        }
        await db.leads.update_one(
            {"email": item["email"].lower()},
            {"$set": lead_doc},
            upsert=True
        )
        saved_lead = await db.leads.find_one({"email": item["email"].lower()})
        lead_id = str(saved_lead["_id"])

        # Research doc
        if "research" in item:
            r = item["research"]
            await db.company_research.update_one(
                {"lead_id": lead_id},
                {
                    "$set": {
                        "lead_id": lead_id,
                        "company_name": item["company_name"],
                        "summary": r["summary"],
                        "likely_needs": r["likely_needs"],
                        "collaboration_opportunities": r["collaboration_opportunities"],
                        "sources": [item["company_website"]],
                        "is_verified": True,
                        "created_at": now
                    }
                },
                upsert=True
            )

        # Draft doc
        if "draft" in item:
            d = item["draft"]
            await db.emails.update_one(
                {"lead_id": lead_id, "status": "Draft Ready"},
                {
                    "$set": {
                        "lead_id": lead_id,
                        "thread_id": lead_id,
                        "message_id": None,
                        "in_reply_to": None,
                        "references": [],
                        "direction": "OUTBOUND",
                        "kind": "FIRST_TOUCH",
                        "stage": 0,
                        "status": "Draft Ready",
                        "subject": d["subject"],
                        "body": d["body"],
                        "confidence_score": 0.94,
                        "approved_by": None,
                        "approved_at": None,
                        "created_at": now
                    }
                },
                upsert=True
            )

    print("================================================================================")
    print("[SUCCESS] Database seeded successfully!")
    print(f"Super Admin Login: {superadmin_email}")
    print(f"Sample Admin Login: {staff_email} / Member@123")
    print("================================================================================")
    client.close()


if __name__ == "__main__":
    asyncio.run(seed())
