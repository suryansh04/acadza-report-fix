import json
import re
import sys
import xml.etree.ElementTree as ElementTree
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
from checks import run_all_checks
from guards import apply_edits_to_copy, find_edit_spans, find_new_problems, raw_html_for_field
from parse import MATH_BLOCK, Question, load_questions_with_reports, replace_named_entities_with_numeric

import db

CASES_PATH = PROJECT_DIR / "cases.json"
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"


class ActionRequest(BaseModel):
    report_id: str
    action: Literal["approve", "edit", "reject", "undo"]
    edits: list[Edit] = []
    reply: str = ""
    note: str = ""
    reviewer: str
    save_anyway: bool = False


class BulkActionRequest(BaseModel):
    report_ids: list[str] = Field(min_length=1)
    action: Literal["approve", "undo"]
    reviewer: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_env_file()
    db.create_audit_table()
    yield


app = FastAPI(title="Acadza Report Fix", lifespan=lifespan)
QUESTIONS: dict[str, Question] = load_questions_with_reports()
CASES: list[dict] = json.loads(CASES_PATH.read_text(encoding="utf-8"))
QUESTION_ID_BY_REPORT = {report["report_id"]: case["questionId"] for case in CASES for report in case["reports"]}


def find_broken_math(markup: str) -> list[str]:
    broken = []
    for block in MATH_BLOCK.findall(markup):
        try:
            ElementTree.fromstring(replace_named_entities_with_numeric(block))
        except ElementTree.ParseError:
            broken.append(re.sub(r"<[^>]+>", " ", block).strip()[:40])
    return broken


def find_typed_key_warnings(question: Question, typed_key: str) -> list[str]:
    question_type = question.question_type
    parts = [part.strip().upper() for part in typed_key.split(",") if part.strip()]
    if question_type == "integerQuestion":
        return [] if re.fullmatch(r"-?\d+(\.\d+)?", typed_key.strip()) else [f"An integer key must be a number, not '{typed_key}'."]
    if question_type == "scq" and len(parts) != 1:
        return [f"A single-correct key must be exactly one letter, not '{typed_key}'."]
    if not parts or len(set(parts)) != len(parts):
        return [f"The key '{typed_key}' is empty or repeats a letter."]
    unknown = [part for part in parts if part not in question.options]
    return [f"The key has {', '.join(unknown)}, which is not an option in this question."] if unknown else []


def find_format_warnings(question: Question, edits: list[Edit]) -> list[str]:
    """Format checks for a teacher's edit. They warn and never block: the teacher has the final word."""
    warnings = [warning for edit in edits if edit.field == "answer" for warning in find_typed_key_warnings(question, edit.replace)]
    for edit in edits:
        if edit.field in ("question", "solution") and len(find_edit_spans(raw_html_for_field(question, edit.field), edit.find)) != 1:
            warnings.append(f"The text to replace was not found exactly once in the {edit.field}.")
    if warnings:
        return warnings

    edited = apply_edits_to_copy(question, edits)
    warnings += [finding.detail for finding in find_new_problems(run_all_checks(question), run_all_checks(edited))]
    for field_name in ("question", "solution"):
        warnings += [f"Broken math in the {field_name} near: {snippet}" for snippet in find_broken_math(raw_html_for_field(edited, field_name))]
    return warnings


@app.get("/api/cases")
def get_cases() -> list[dict]:
    latest_action = {}
    for entry in reversed(db.list_audit_entries()):
        latest_action[entry["report_id"]] = None if entry["action"] == "undo" else entry
    return [{**case, "reports": [{**report, "teacher_action": latest_action.get(report["report_id"])} for report in case["reports"]]}
            for case in CASES]


@app.get("/api/audit")
def get_audit_log() -> list[dict]:
    return db.list_audit_entries()


@app.post("/api/actions")
def save_action(request: ActionRequest) -> dict:
    question_id = QUESTION_ID_BY_REPORT.get(request.report_id)
    if question_id is None:
        raise HTTPException(404, f"Unknown report {request.report_id}.")
    if not request.reviewer.strip():
        raise HTTPException(422, "Add your name before you act on a case, so the audit log shows who did it.")

    if request.action == "edit" and not request.save_anyway:
        warnings = find_format_warnings(QUESTIONS[question_id], request.edits)
        if warnings:
            raise HTTPException(409, {"warnings": warnings})

    entry = db.NewAuditEntry(request.report_id, question_id, request.action, [edit.model_dump() for edit in request.edits],
                             request.reply, request.note, request.reviewer.strip())
    return db.insert_audit_entries([entry])[0]


@app.post("/api/actions/bulk")
def save_bulk_action(request: BulkActionRequest) -> list[dict]:
    """Approve or undo many reports at once, for example "keep all auto-fixes". Edits are never bulk: each needs its own check."""
    unknown = [report_id for report_id in request.report_ids if report_id not in QUESTION_ID_BY_REPORT]
    if unknown:
        raise HTTPException(404, f"Unknown reports: {', '.join(unknown)}.")
    if not request.reviewer.strip():
        raise HTTPException(422, "Add your name before you act on a case, so the audit log shows who did it.")
    entries = [db.NewAuditEntry(report_id, QUESTION_ID_BY_REPORT[report_id], request.action, [], "", "", request.reviewer.strip())
               for report_id in dict.fromkeys(request.report_ids)]
    return db.insert_audit_entries(entries)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "database": "supabase" if db.database_url() else "local sqlite"}


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
