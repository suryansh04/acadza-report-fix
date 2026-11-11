import json
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

PROJECT_DIR = Path(__file__).resolve().parent.parent
# The backend reuses the engine's checks and guards, which import each other by plain module name.
sys.path.insert(0, str(PROJECT_DIR / "engine"))

from ai import Edit, load_env_file
from parse import Question, load_questions_with_reports

import audit_log
import database
from edit_checks import check_teacher_edit

CASES_PATH = PROJECT_DIR / "cases.json"
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"


class ActionRequest(BaseModel):
    report_id: str
    action: Literal["approve", "edit", "reject"]
    edits: list[Edit] = []
    reply: str = ""
    note: str = ""
    reviewer: str
    save_anyway: bool = False


class BulkApproveRequest(BaseModel):
    report_ids: list[str] = Field(min_length=1)
    reviewer: str


class UndoRequest(BaseModel):
    entry_ids: list[int] = Field(min_length=1)
    reviewer: str


def load_cases() -> list[dict]:
    if not CASES_PATH.exists():
        raise RuntimeError(f"{CASES_PATH} is missing. Run the engine first: python engine/run.py")
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    load_env_file()
    database.open_pool()
    audit_log.create_audit_table()
    yield
    database.close_pool()


app = FastAPI(title="Acadza Report Fix", lifespan=lifespan)
QUESTIONS: dict[str, Question] = load_questions_with_reports()
CASES = load_cases()
REPORTS = {report["report_id"]: {**report, "questionId": case["questionId"]} for case in CASES for report in case["reports"]}
REPORT_IDS_BY_QUESTION = {case["questionId"]: [report["report_id"] for report in case["reports"]] for case in CASES}


def edits_in_effect(report_id: str, decisions: dict[str, dict]) -> list[Edit]:
    report, decision = REPORTS[report_id], decisions.get(report_id)
    if decision and decision["action"] == "edit":
        return [Edit(**edit) for edit in decision["edits"]]
    engine_fix_is_live = report["route"] == "auto_apply" if decision is None else decision["action"] == "approve"
    return [Edit(**edit) for edit in report["edits"]] if engine_fix_is_live else []


def require_reviewer(reviewer: str) -> str:
    if not reviewer.strip():
        raise HTTPException(422, "Add your name before you act on a case, so the audit log shows who did it.")
    return reviewer.strip()


def require_known_reports(report_ids: list[str]) -> None:
    unknown = [report_id for report_id in report_ids if report_id not in REPORTS]
    if unknown:
        raise HTTPException(404, f"Unknown reports: {', '.join(unknown)}.")


def require_meaningful_request(request: ActionRequest) -> None:
    if request.action != "edit" and request.edits:
        raise HTTPException(422, "Only an edit can change the question. Send approve or reject without edits.")
    if request.action == "edit" and not request.edits and request.reply.strip() in ("", REPORTS[request.report_id]["reply"].strip()):
        raise HTTPException(422, "This edit changes nothing. Approve the report instead.")


@app.get("/api/cases")
def get_cases() -> list[dict]:
    decisions = audit_log.standing_decisions()
    return [{**case, "reports": [{**report, "teacher_action": decisions.get(report["report_id"])} for report in case["reports"]]}
            for case in CASES]


@app.get("/api/audit")
def get_audit_log() -> list[dict]:
    return audit_log.list_audit_entries()


@app.post("/api/actions")
def save_action(request: ActionRequest) -> dict:
    require_known_reports([request.report_id])
    reviewer = require_reviewer(request.reviewer)
    require_meaningful_request(request)
    question_id = REPORTS[request.report_id]["questionId"]

    def plan(decisions: dict[str, dict]) -> list[audit_log.NewAuditEntry]:
        # One decision per report: a double key press or a second browser tab must not save twice.
        if request.report_id in decisions:
            raise HTTPException(409, f"{request.report_id} already has a decision. Undo it first to change it.")
        if request.action == "edit":
            other_edits = {report_id: edits_in_effect(report_id, decisions)
                           for report_id in REPORT_IDS_BY_QUESTION[question_id] if report_id != request.report_id}
            errors, warnings = check_teacher_edit(QUESTIONS[question_id], request.edits, other_edits)
            if errors:
                raise HTTPException(422, {"errors": errors})
            if warnings and not request.save_anyway:
                raise HTTPException(409, {"warnings": warnings})
        return [audit_log.NewAuditEntry(request.report_id, question_id, request.action, [edit.model_dump() for edit in request.edits],
                                 request.reply, request.note, reviewer)]

    return audit_log.write_entries(plan)[0]


@app.post("/api/actions/bulk")
def approve_many(request: BulkApproveRequest) -> list[dict]:
    require_known_reports(request.report_ids)
    reviewer = require_reviewer(request.reviewer)
    return audit_log.write_entries(lambda decisions: [
        audit_log.NewAuditEntry(report_id, REPORTS[report_id]["questionId"], "approve", [], "", "", reviewer)
        for report_id in dict.fromkeys(request.report_ids) if report_id not in decisions])


@app.post("/api/actions/undo")
def undo_decisions(request: UndoRequest) -> list[dict]:
    """By entry id, so an old Undo button never cancels a newer decision."""
    reviewer = require_reviewer(request.reviewer)

    def plan(decisions: dict[str, dict]) -> list[audit_log.NewAuditEntry]:
        standing = {entry["id"]: entry for entry in decisions.values()}
        targets = [standing[entry_id] for entry_id in dict.fromkeys(request.entry_ids) if entry_id in standing]
        if not targets:
            raise HTTPException(409, "Nothing to undo: these decisions were already undone or changed.")
        return [audit_log.NewAuditEntry(entry["report_id"], entry["question_id"], "undo", [], "", f"Undoes entry {entry['id']}.", reviewer)
                for entry in targets]

    return audit_log.write_entries(plan)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": "supabase" if database.database_url() else "local sqlite"}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def serve_frontend(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, f"No API route /{path}.")
        file = (FRONTEND_DIST / path).resolve()
        # Only files inside dist are served, so a path like ../../.env can never leak.
        if path and file.is_file() and FRONTEND_DIST.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")
