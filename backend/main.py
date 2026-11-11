import json
import re
import sys
import xml.etree.ElementTree as ElementTree
from collections import Counter
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
from checks import run_all_checks
from guards import apply_edits_to_copy, find_edit_spans, find_new_problems, raw_html_for_field
from parse import MATH_BLOCK, Question, load_questions_with_reports, replace_named_entities_with_numeric
from vote import MATH_MINUS_SIGN

import db

CASES_PATH = PROJECT_DIR / "cases.json"
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"
QUESTION_TYPES = ("scq", "mcq", "integerQuestion")


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
    db.open_pool()
    db.create_audit_table()
    yield
    db.close_pool()


app = FastAPI(title="Acadza Report Fix", lifespan=lifespan)
QUESTIONS: dict[str, Question] = load_questions_with_reports()
CASES = load_cases()
REPORTS = {report["report_id"]: {**report, "questionId": case["questionId"]} for case in CASES for report in case["reports"]}
REPORT_IDS_BY_QUESTION = {case["questionId"]: [report["report_id"] for report in case["reports"]] for case in CASES}


def find_broken_math(markup: str) -> list[str]:
    broken = []
    for block in MATH_BLOCK.findall(markup):
        try:
            ElementTree.fromstring(replace_named_entities_with_numeric(block))
        except ElementTree.ParseError:
            broken.append(re.sub(r"<[^>]+>", " ", block).strip()[:40])
    return broken


def find_new_broken_math(before: Question, after: Question) -> list[str]:
    """Only math that the edit broke. A block that was already broken is not the teacher's doing."""
    warnings = []
    for field_name in ("question", "solution"):
        new_blocks = Counter(find_broken_math(raw_html_for_field(after, field_name))) - Counter(find_broken_math(raw_html_for_field(before, field_name)))
        warnings += [f"Broken math in the {field_name} near: {snippet}" for snippet in new_blocks.elements()]
    return warnings


def find_ignored_key_text(typed_key: str, question_type: str) -> list[str]:
    """The engine reads keys leniently: "(A) and (C)" means A and C. For a key that a teacher types, flag any text the engine
    would drop, so "A, B, Z" is never saved as "A, B" without a word. All other key checks are the engine's (run_all_checks)."""
    if question_type == "integerQuestion":
        number = typed_key.strip().replace(MATH_MINUS_SIGN, "-")
        return [] if re.fullmatch(r"-?\d+(\.\d+)?", number) else [f"An integer key must be only a number, not '{typed_key}'."]
    extra = [token for token in re.split(r"[\s,;/&]+|\bAND\b", typed_key.upper()) if token and token.strip("()") not in ("A", "B", "C", "D")]
    return [f"The key '{typed_key}' has text that is not an option letter: {', '.join(extra)}."] if extra else []


def find_edit_conflicts(question: Question, edits: list[Edit]) -> list[str]:
    """Edits that cannot be applied together: an unknown type, two different keys or types,
    or text that is missing, found twice, or overlapping another edit in the same field."""
    problems = [f"The question type must be one of {', '.join(QUESTION_TYPES)}, not '{edit.replace}'."
                for edit in edits if edit.field == "questionType" and edit.replace not in QUESTION_TYPES]
    for field_name, label in (("answer", "answer keys"), ("questionType", "question types")):
        values = sorted({edit.replace.strip() for edit in edits if edit.field == field_name})
        if len(values) > 1:
            problems.append(f"Two changes set different {label}: {' and '.join(values)}.")
    for field_name in ("question", "solution"):
        raw = raw_html_for_field(question, field_name)
        spans = []
        for edit in edits:
            if edit.field != field_name:
                continue
            found = find_edit_spans(raw, edit.find)
            if len(found) == 1:
                spans.extend(found)
            else:
                problems.append(f"The text to replace was not found exactly once in the {field_name}.")
        spans.sort()
        if any(next_start < end for (_, end), (next_start, _) in zip(spans, spans[1:])):
            problems.append(f"Two changes overlap in the {field_name}.")
    return problems


def unique_edits(edits: list[Edit]) -> list[Edit]:
    return list({(edit.field, edit.find, edit.replace): edit for edit in edits}.values())


def edits_in_effect(report_id: str, decisions: dict[str, dict]) -> list[Edit]:
    """The edits live for one report, as the console shows them: a teacher edit replaces the engine fix,
    a reject removes it, and an auto-fix is live until a teacher rejects it."""
    report, decision = REPORTS[report_id], decisions.get(report_id)
    if decision is None:
        return [Edit(**edit) for edit in report["edits"]] if report["route"] == "auto_apply" else []
    if decision["action"] == "edit":
        return [Edit(**edit) for edit in decision["edits"]]
    return [] if decision["action"] == "reject" else [Edit(**edit) for edit in report["edits"]]


def find_format_warnings(question: Question, edits: list[Edit], other_edits: list[Edit]) -> list[str]:
    """Format checks for a teacher's edit. They warn and never block: the teacher has the final word.
    The edit is checked on top of the changes other reports on this question already made, so two edits cannot clash,
    and only problems that this edit adds are reported."""
    baseline_edits = unique_edits(other_edits)
    # If the other changes do not apply cleanly themselves, check the edit against the stored question alone.
    if find_edit_conflicts(question, baseline_edits):
        baseline_edits = []
    combined = unique_edits([*baseline_edits, *edits])
    conflicts = find_edit_conflicts(question, combined)
    if conflicts:
        return conflicts

    baseline, edited = apply_edits_to_copy(question, baseline_edits), apply_edits_to_copy(question, combined)
    warnings = [finding.detail for finding in find_new_problems(run_all_checks(baseline), run_all_checks(edited))]
    warnings += find_new_broken_math(baseline, edited)
    warnings += [warning for edit in edits if edit.field == "answer" for warning in find_ignored_key_text(edit.replace, edited.question_type)]
    return warnings


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
    decisions = db.standing_decisions()
    return [{**case, "reports": [{**report, "teacher_action": decisions.get(report["report_id"])} for report in case["reports"]]}
            for case in CASES]


@app.get("/api/audit")
def get_audit_log() -> list[dict]:
    return db.list_audit_entries()


@app.post("/api/actions")
def save_action(request: ActionRequest) -> dict:
    require_known_reports([request.report_id])
    reviewer = require_reviewer(request.reviewer)
    require_meaningful_request(request)
    question_id = REPORTS[request.report_id]["questionId"]

    def plan(decisions: dict[str, dict]) -> list[db.NewAuditEntry]:
        # One decision per report: a double key press or a second browser tab must not save twice.
        if request.report_id in decisions:
            raise HTTPException(409, f"{request.report_id} already has a decision. Undo it first to change it.")
        if request.action == "edit" and not request.save_anyway:
            other_edits = [edit for report_id in REPORT_IDS_BY_QUESTION[question_id] if report_id != request.report_id
                           for edit in edits_in_effect(report_id, decisions)]
            warnings = find_format_warnings(QUESTIONS[question_id], request.edits, other_edits)
            if warnings:
                raise HTTPException(409, {"warnings": warnings})
        return [db.NewAuditEntry(request.report_id, question_id, request.action, [edit.model_dump() for edit in request.edits],
                                 request.reply, request.note, reviewer)]

    return db.write_entries(plan)[0]


@app.post("/api/actions/bulk")
def approve_many(request: BulkApproveRequest) -> list[dict]:
    """Approve many reports at once, for example "keep all auto-fixes". Reports that already have a decision are skipped.
    Edits are never bulk: each needs its own format check."""
    require_known_reports(request.report_ids)
    reviewer = require_reviewer(request.reviewer)
    return db.write_entries(lambda decisions: [
        db.NewAuditEntry(report_id, REPORTS[report_id]["questionId"], "approve", [], "", "", reviewer)
        for report_id in dict.fromkeys(request.report_ids) if report_id not in decisions])


@app.post("/api/actions/undo")
def undo_decisions(request: UndoRequest) -> list[dict]:
    """Undo decisions by their audit entry id. A decision that was already undone or replaced is left alone,
    so an old "Undo" button can never cancel a newer decision."""
    reviewer = require_reviewer(request.reviewer)

    def plan(decisions: dict[str, dict]) -> list[db.NewAuditEntry]:
        standing = {entry["id"]: entry for entry in decisions.values()}
        targets = [standing[entry_id] for entry_id in dict.fromkeys(request.entry_ids) if entry_id in standing]
        if not targets:
            raise HTTPException(409, "Nothing to undo: these decisions were already undone or changed.")
        return [db.NewAuditEntry(entry["report_id"], entry["question_id"], "undo", [], "", f"Undoes entry {entry['id']}.", reviewer)
                for entry in targets]

    return db.write_entries(plan)


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
