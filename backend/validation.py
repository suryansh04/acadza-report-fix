"""Checks on a request before anything is saved. Each one raises an HTTP error that says how to correct the request."""
from fastapi import HTTPException

from case_data import REPORTS
from schemas import ActionRequest


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
