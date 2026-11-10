import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from parse import OPTION_LETTERS, Question

MIN_SOLUTION_LENGTH = 25
LATEX_COMMAND = re.compile(r"\\[A-Za-z]+(\{|\b)")
VISIBLE_HTML_TAG = re.compile(r"</?[a-z][a-z0-9]*(\s[^<>]*)?>", re.IGNORECASE)
EXAM_TAG = re.compile(r"\(?\s*\b(JEE(\s+(Main|Advanced))?|NEET|AIEEE|AIIMS|BITSAT)\b[^()\n]{0,20}?\b(19|20)\d{2}\s*\)?", re.IGNORECASE)
NOISE_TEXT = re.compile(r"space\s+for\s+rough\s+work|^\s*Q\.?\s*\d+[.):]", re.IGNORECASE | re.MULTILINE)
FIGURE_REFERENCE = re.compile(r"\b(shown\s+in\s+(the\s+)?(figure|fig|diagram)|as\s+shown|given\s+figure|figure\s+shows)\b", re.IGNORECASE)


@dataclass
class Finding:
    check: str
    detail: str
    suggested_repair: str | None
    report_id: str | None = None


def parse_iso_timestamp(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def is_single_option_letter(value: Any) -> bool:
    return isinstance(value, str) and value.strip() in OPTION_LETTERS


def is_number(value: Any) -> bool:
    try:
        float(str(value).strip())
        return True
    except ValueError:
        return False


def normalize_option_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def check_answer_format(question: Question) -> list[Finding]:
    answer = question.answer
    kind = question.question_type

    if kind == "scq" and not is_single_option_letter(answer):
        return [Finding("answer_format", f"Single-answer key must be one letter A-D, found {answer!r}.", "answer_key")]

    if kind == "integerQuestion" and not is_number(answer):
        return [Finding("answer_format", f"Integer key must be a number, found {answer!r}.", "answer_key")]

    if kind == "mcq":
        if not isinstance(answer, list) or not all(is_single_option_letter(item) for item in answer):
            findings = [Finding("answer_format", f"Multi-answer key must be a list of single letters, found {answer!r}.", "answer_key")]
            usable_letters = extract_option_letters(answer)
            if len(usable_letters) == 1:
                findings.append(Finding("single_answer_in_mcq", f"Only one usable letter ({usable_letters[0]}) in a multi-answer key.", "type_mismatch"))
            return findings
        if len(set(answer)) != len(answer):
            return [Finding("answer_format", f"Multi-answer key repeats a letter: {answer!r}.", "answer_key")]
        if len(answer) == 1:
            return [Finding("single_answer_in_mcq", "Multi-answer question has only one correct letter.", "type_mismatch")]
    return []


def extract_option_letters(answer: Any) -> list[str]:
    items = answer if isinstance(answer, list) else [answer]
    return sorted({letter for item in items for letter in re.findall(r"\b[A-D]\b", str(item).upper())})


def check_key_points_to_existing_option(question: Question) -> list[Finding]:
    if question.question_type == "integerQuestion":
        return []
    letters = extract_option_letters(question.answer)
    findings = []
    for letter in letters:
        if letter not in question.options:
            findings.append(Finding("key_option_missing", f"Key {letter} points to an option that does not exist.", "option_repair"))
        elif not question.options[letter]:
            findings.append(Finding("key_option_blank", f"Key {letter} points to a blank option.", "option_repair"))
    return findings


def check_options(question: Question) -> list[Finding]:
    if question.question_type == "integerQuestion":
        return []
    findings = []
    missing = [letter for letter in OPTION_LETTERS if letter not in question.options]
    if missing:
        findings.append(Finding("option_missing", f"Option(s) {', '.join(missing)} not found in the question.", "option_repair"))

    blank = [letter for letter, text in question.options.items() if not text]
    if blank:
        findings.append(Finding("option_blank", f"Option(s) {', '.join(blank)} are blank.", "option_repair"))

    seen: dict[str, str] = {}
    for letter, text in question.options.items():
        normalized = normalize_option_text(text)
        if not normalized:
            continue
        if normalized in seen:
            findings.append(Finding("identical_options", f"Options {seen[normalized]} and {letter} are the same: {text!r}.", "identical_options"))
        else:
            seen[normalized] = letter
    return findings


def check_solution_present(question: Question) -> list[Finding]:
    if len(question.solution_text) < MIN_SOLUTION_LENGTH:
        return [Finding("solution_missing", f"Solution is empty or too short ({len(question.solution_text)} characters).", "solution_missing")]
    return []


def check_markup_leak(question: Question) -> list[Finding]:
    findings = []
    for field_name, text in (("question", question.stem_text + "\n" + "\n".join(question.options.values())),
                             ("solution", question.solution_text)):
        leak = LATEX_COMMAND.search(text) or VISIBLE_HTML_TAG.search(text)
        if leak:
            findings.append(Finding("markup_leak", f"Raw markup {leak.group(0)!r} shows as text in the {field_name}.", "markup_leak"))
    return findings


def check_exam_reference(question: Question) -> list[Finding]:
    match = EXAM_TAG.search(question.stem_text)
    if match:
        return [Finding("exam_reference", f"Exam tag {match.group(0).strip()!r} inside the question.", "exam_reference")]
    return []


def check_noise_text(question: Question) -> list[Finding]:
    match = NOISE_TEXT.search(question.stem_text)
    if match:
        return [Finding("noise", f"Stray text {match.group(0).strip()!r} in the question.", "noise")]
    return []


def check_figure_without_image(question: Question) -> list[Finding]:
    match = FIGURE_REFERENCE.search(question.stem_text)
    if match and question.image_count == 0:
        return [Finding("figure_missing", f"Question says {match.group(0)!r} but has no image.", "diagram")]
    return []


def check_changed_after_reports(question: Question) -> list[Finding]:
    updated_at = parse_iso_timestamp(question.updated_at)
    if not updated_at:
        return []
    history_notes = "; ".join(entry.get("note", "") for entry in question.error_history) or "no history note"
    findings = []
    for report in question.reports:
        reported_at = parse_iso_timestamp(report.reported_at)
        if reported_at and updated_at > reported_at:
            findings.append(Finding("changed_after_report", f"Question was edited after this report. History: {history_notes}.", None, report.report_id))
    return findings


ALL_CHECKS = (
    check_answer_format,
    check_key_points_to_existing_option,
    check_options,
    check_solution_present,
    check_markup_leak,
    check_exam_reference,
    check_noise_text,
    check_figure_without_image,
    check_changed_after_reports,
)


def run_all_checks(question: Question) -> list[Finding]:
    return [finding for check in ALL_CHECKS for finding in check(question)]
