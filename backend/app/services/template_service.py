import datetime
import re
from typing import Any, Dict, List, Optional, Tuple
from bson import ObjectId

from app.core.database import get_database, serialize_doc


DEFAULT_TEMPLATES = [
    {
        "name": "Enterprise AI Workshops - First Outreach",
        "kind": "FIRST_TOUCH",
        "service_line": "Enterprise AI Workshops",
        "stage": 0,
        "description": "Default reference template for enterprise AI workshops first touch outreach (180-240 words).",
        "subject_template": "Practical AI capability building for {company}",
        "body_template": (
            "{lead_name},\n\n"
            "I hope this message finds you well.\n\n"
            "I am {sender_name} from {company_legal_name}, a leading global digital transformation and AI training organization. {track_record_statement}\n\n"
            "{company_paragraph}\n\n"
            "We specialize in high-impact, 1-to-3-day executive and technical AI workshops built on 100% live simulation sandbox labs, covering {topics}.\n\n"
            "{impact}\n\n"
            "{reference_clients}\n\n"
            "Would you be open to a brief discussion next week to explore how this could complement {company}'s current digital transformation and business priorities?\n\n"
            "Best regards,\n"
            "{sender_name}\n"
            "{designation}\n"
            "{company_legal_name}"
        )
    },
    {
        "name": "Enterprise AI Workshops - Follow-up Stage 1",
        "kind": "FOLLOWUP",
        "service_line": "Enterprise AI Workshops",
        "stage": 1,
        "description": "Stage 1 follow-up focusing on practical simulation labs and rapid productivity gains (100-170 words).",
        "subject_template": "Re: {previous_subject}",
        "body_template": (
            "{lead_name},\n\n"
            "I hope this note finds you well. Following up on my earlier message regarding practical enterprise AI capability building for {company}.\n\n"
            "A central challenge we observe across enterprise technology teams is moving from theoretical AI concepts to tangible day-to-day execution. Our 1-to-3-day intensive workshops are conducted on 100% live simulation sandbox labs, enabling teams to build direct execution capability across {topics}.\n\n"
            "By equipping teams with production-ready workflows, these programs typically boost employee productivity by 10%-40% while delivering immediate business ROI and operational capability gains.\n\n"
            "Would you have 15 minutes open later this week for a brief introductory discussion to explore how this aligns with {company}'s upcoming initiatives?\n\n"
            "Best regards,\n"
            "{sender_name}\n"
            "{designation}\n"
            "{company_legal_name}"
        )
    },
    {
        "name": "Enterprise AI Workshops - Follow-up Stage 2",
        "kind": "FOLLOWUP",
        "service_line": "Enterprise AI Workshops",
        "stage": 2,
        "description": "Stage 2 follow-up focusing on executive governance and leadership strategy (100-170 words).",
        "subject_template": "Re: {previous_subject}",
        "body_template": (
            "{lead_name},\n\n"
            "I wanted to follow up on my previous messages with a different angle regarding {company}'s digital transformation roadmap.\n\n"
            "Beyond core technical upskilling, organizations frequently leverage our executive tracks—specifically AI Strategy & Governance and Executive Leadership Strategy—to establish clear governance guardrails and prioritize high-value AI investments before committing major capital.\n\n"
            "Every workshop is facilitated by active enterprise practitioners, ensuring your leadership and technical teams gain actionable frameworks rather than generic vendor overviews.\n\n"
            "Would you be open to a quick 15-minute call next Tuesday or Wednesday to discuss whether this framework would be valuable for {company}'s leadership team?\n\n"
            "Best regards,\n"
            "{sender_name}\n"
            "{designation}\n"
            "{company_legal_name}"
        )
    },
    {
        "name": "Enterprise AI Workshops - Follow-up Stage 3",
        "kind": "FOLLOWUP",
        "service_line": "Enterprise AI Workshops",
        "stage": 3,
        "description": "Stage 3 final check-in with high courtesy and long-term value invitation (100-170 words).",
        "subject_template": "Re: {previous_subject}",
        "body_template": (
            "{lead_name},\n\n"
            "I realize you have a demanding schedule guiding strategic priorities at {company}, so I will keep this note brief as my final follow-up.\n\n"
            "At {company_legal_name}, our focus is delivering high-impact, 1-to-3-day executive and technical AI workshops on 100% live simulation labs that boost productivity by 10%-40% without long onboarding cycles.\n\n"
            "If enterprise AI upskilling, Copilot adoption, or technical talent enablement becomes a priority for {company} later in the year, please feel free to reconnect or reply to this thread anytime.\n\n"
            "Wishing you and the {company} team continued success with your digital transformation initiatives.\n\n"
            "Best regards,\n"
            "{sender_name}\n"
            "{designation}\n"
            "{company_legal_name}"
        )
    },
    {
        "name": "Enterprise AI Workshops - Reply",
        "kind": "REPLY",
        "service_line": "Enterprise AI Workshops",
        "stage": 0,
        "description": "Reply template addressing prospect's questions, scoping needs, without inventing custom pricing.",
        "subject_template": "Re: {previous_subject}",
        "body_template": (
            "{lead_name},\n\n"
            "Thank you for your response and for considering {company_legal_name} as an AI capability partner for {company}.\n\n"
            "{reply_body}\n\n"
            "Would you have 15 to 20 minutes open later this week or early next week for a brief scoping call so we can understand your specific requirements and share relevant workshop outlines?\n\n"
            "Best regards,\n"
            "{sender_name}\n"
            "{designation}\n"
            "{company_legal_name}"
        )
    }
]


INITIAL_NEW_KB_ITEMS = [
    {
        "category": "ABOUT",
        "title": "Company Description",
        "content": "Traininglobe Consultancy Pvt. Ltd. is a leading global digital transformation and AI training organization.",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": False,
        "region": None,
        "source": "Corporate Overview"
    },
    {
        "category": "APPROVED_CLAIMS",
        "title": "Track Record across GCC",
        "content": "Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating.",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": False,
        "region": "GCC",
        "source": "GCC Delivery Registry"
    },
    {
        "category": "SERVICES",
        "title": "Workshop Format",
        "content": "High-impact, 1-to-3-day executive and technical AI workshops built on 100% live simulation sandbox labs.",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": False,
        "region": None,
        "source": "Enterprise AI Syllabus"
    },
    {
        "category": "SERVICES",
        "title": "Workshop Topics",
        "content": "Generative AI & Enterprise Documentation Automation; Microsoft 365 Copilot; AI Strategy & Governance; Enterprise Data Science & Predictive AI; Agentic AI & Talent Enablement; Executive Leadership Strategy",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": False,
        "region": None,
        "source": "Enterprise AI Curriculum"
    },
    {
        "category": "APPROVED_CLAIMS",
        "title": "Productivity & ROI Impact",
        "content": "Our practical workshops typically boost employee productivity by 10%-40% while delivering immediate business ROI and operational capability gains.",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": False,
        "region": None,
        "source": "Impact Assessment Studies"
    },
    {
        "category": "REFERENCE_CLIENTS",
        "title": "Enterprise AI Reference Clients",
        "content": "Our experience includes programs with QatarEnergy, Saudi Aramco helping organizations build practical enterprise AI capabilities.",
        "service_line": "Enterprise AI Workshops",
        "status": "Pending verification",
        "approved_for_outreach": True,
        "region": "GCC",
        "source": "Client Engagement Registry"
    }
]


async def seed_templates_and_kb():
    """Ensure default templates and knowledge base facts are properly seeded and migrated."""
    db = get_database()
    if db is None:
        return

    now = datetime.datetime.now(datetime.timezone.utc)

    # 1. Backfill existing 6 KB items with status="Verified" and appropriate service_lines
    await db.knowledge_base.update_many(
        {"status": {"$exists": False}},
        {"$set": {"status": "Verified", "approved_for_outreach": True, "service_line": "Corporate Onboarding"}}
    )
    # Special-case Campus Placement item if exists
    await db.knowledge_base.update_many(
        {"title": {"$regex": "Campus Placement", "$options": "i"}},
        {"$set": {"service_line": "Campus Placement"}}
    )

    # 2. Seed the new enterprise AI facts as 'Pending verification' if not already present
    for item in INITIAL_NEW_KB_ITEMS:
        exists = await db.knowledge_base.find_one({"title": item["title"]})
        if not exists:
            doc = {**item, "updated_at": now}
            await db.knowledge_base.insert_one(doc)

    # 3. Seed default templates
    for tpl in DEFAULT_TEMPLATES:
        exists = await db.templates.find_one({"name": tpl["name"]})
        if not exists:
            doc = {**tpl, "updated_at": now}
            await db.templates.insert_one(doc)

    # 4. Ensure system_settings has sender defaults and no email_length
    cfg = await db.system_settings.find_one({"_id": "global_config"})
    if not cfg:
        await db.system_settings.insert_one({
            "_id": "global_config",
            "default_sender_name": "Pallabi Hansda",
            "default_sender_designation": "Business Development Manager",
            "company_legal_name": "Traininglobe Consultancy Pvt. Ltd.",
            "enable_lead_owner_override": True,
            "reminder_enabled": True,
            "reminder_lead_minutes": 30,
            "reminder_channels": ["email", "dashboard"],
            "updated_at": now
        })
    else:
        updates = {}
        if "default_sender_name" not in cfg:
            updates["default_sender_name"] = "Pallabi Hansda"
        if "default_sender_designation" not in cfg:
            updates["default_sender_designation"] = "Business Development Manager"
        if "company_legal_name" not in cfg:
            updates["company_legal_name"] = "Traininglobe Consultancy Pvt. Ltd."
        if "enable_lead_owner_override" not in cfg:
            updates["enable_lead_owner_override"] = True
        if updates:
            await db.system_settings.update_one({"_id": "global_config"}, {"$set": updates})


def render_template_string(template_str: str, placeholders: Dict[str, Any]) -> str:
    """Render a template string safely replacing known placeholders."""
    rendered = template_str
    # Replace standard aliases
    if "{designation}" in rendered and "designation" not in placeholders and "sender_designation" in placeholders:
        placeholders["designation"] = placeholders["sender_designation"]
    if "{sender_designation}" in rendered and "sender_designation" not in placeholders and "designation" in placeholders:
        placeholders["sender_designation"] = placeholders["designation"]

    for key, value in placeholders.items():
        placeholder_key = "{" + key + "}"
        rendered = rendered.replace(placeholder_key, str(value or ""))

    # Clean up any leftover empty lines or multiple consecutive blanks
    rendered = re.sub(r"\n{3,}", "\n\n", rendered).strip()
    return rendered
