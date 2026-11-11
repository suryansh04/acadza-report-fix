from fastapi import APIRouter

from case_data import CASES
from db import audit_log, connection

router = APIRouter(prefix="/api")


@router.get("/cases")
def get_cases() -> list[dict]:
    decisions = audit_log.standing_decisions()
    return [{**case, "reports": [{**report, "teacher_action": decisions.get(report["report_id"])} for report in case["reports"]]}
            for case in CASES]


@router.get("/audit")
def get_audit_log() -> list[dict]:
    return audit_log.list_audit_entries()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "database": "supabase" if connection.database_url() else "local sqlite"}
