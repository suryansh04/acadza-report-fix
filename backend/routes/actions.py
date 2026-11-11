"""Teacher decisions. Each save runs in one locked transaction, so the checks here are still true when the row is written."""
from fastapi import APIRouter, HTTPException

from case_data import QUESTIONS, REPORT_IDS_BY_QUESTION, REPORTS, edits_in_effect
from db import audit_log
from format_warnings import find_format_warnings
from schemas import ActionRequest, BulkApproveRequest, UndoRequest
from validation import require_known_reports, require_meaningful_request, require_reviewer

router = APIRouter(prefix="/api/actions")


@router.post("")
def save_action(request: ActionRequest) -> dict:
    require_known_reports([request.report_id])
    reviewer = require_reviewer(request.reviewer)
    require_meaningful_request(request)
    question_id = REPORTS[request.report_id]["questionId"]

    def plan(decisions: dict[str, dict]) -> list[audit_log.NewAuditEntry]:
        # One decision per report: a double key press or a second browser tab must not save twice.
        if request.report_id in decisions:
            raise HTTPException(409, f"{request.report_id} already has a decision. Undo it first to change it.")
        if request.action == "edit" and not request.save_anyway:
            other_edits = [edit for report_id in REPORT_IDS_BY_QUESTION[question_id] if report_id != request.report_id
                           for edit in edits_in_effect(report_id, decisions)]
            warnings = find_format_warnings(QUESTIONS[question_id], request.edits, other_edits)
            if warnings:
                raise HTTPException(409, {"warnings": warnings})
        return [audit_log.NewAuditEntry(request.report_id, question_id, request.action, [edit.model_dump() for edit in request.edits],
                                        request.reply, request.note, reviewer)]

    return audit_log.write_entries(plan)[0]


@router.post("/bulk")
def approve_many(request: BulkApproveRequest) -> list[dict]:
    """Approve many reports at once, for example "keep all auto-fixes". Reports that already have a decision are skipped.
    Edits are never bulk: each needs its own format check."""
    require_known_reports(request.report_ids)
    reviewer = require_reviewer(request.reviewer)
    return audit_log.write_entries(lambda decisions: [
        audit_log.NewAuditEntry(report_id, REPORTS[report_id]["questionId"], "approve", [], "", "", reviewer)
        for report_id in dict.fromkeys(request.report_ids) if report_id not in decisions])


@router.post("/undo")
def undo_decisions(request: UndoRequest) -> list[dict]:
    """Undo decisions by their audit entry id. A decision that was already undone or replaced is left alone,
    so an old "Undo" button can never cancel a newer decision."""
    reviewer = require_reviewer(request.reviewer)

    def plan(decisions: dict[str, dict]) -> list[audit_log.NewAuditEntry]:
        standing = {entry["id"]: entry for entry in decisions.values()}
        targets = [standing[entry_id] for entry_id in dict.fromkeys(request.entry_ids) if entry_id in standing]
        if not targets:
            raise HTTPException(409, "Nothing to undo: these decisions were already undone or changed.")
        return [audit_log.NewAuditEntry(entry["report_id"], entry["question_id"], "undo", [], "", f"Undoes entry {entry['id']}.", reviewer)
                for entry in targets]

    return audit_log.write_entries(plan)
