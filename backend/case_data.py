import json

from paths import CASES_PATH
from ai import Edit
from parse import Question, load_questions_with_reports


def load_cases() -> list[dict]:
    if not CASES_PATH.exists():
        raise RuntimeError(f"{CASES_PATH} is missing. Run the engine first: python engine/run.py")
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


QUESTIONS: dict[str, Question] = load_questions_with_reports()
CASES = load_cases()
REPORTS = {report["report_id"]: {**report, "questionId": case["questionId"]} for case in CASES for report in case["reports"]}
REPORT_IDS_BY_QUESTION = {case["questionId"]: [report["report_id"] for report in case["reports"]] for case in CASES}


def edits_in_effect(report_id: str, decisions: dict[str, dict]) -> list[Edit]:
    """The edits live for one report, as the console shows them: a teacher edit replaces the engine fix,
    a reject removes it, and an auto-fix is live until a teacher rejects it."""
    report, decision = REPORTS[report_id], decisions.get(report_id)
    if decision is None:
        return [Edit(**edit) for edit in report["edits"]] if report["route"] == "auto_apply" else []
    if decision["action"] == "edit":
        return [Edit(**edit) for edit in decision["edits"]]
    return [] if decision["action"] == "reject" else [Edit(**edit) for edit in report["edits"]]
