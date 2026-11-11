import re
import xml.etree.ElementTree as ElementTree
from collections import Counter

# These are the engine's modules. main.py puts engine/ on the import path before it imports this file.
from ai import Edit
from checks import run_all_checks
from guards import apply_edits_to_copy, find_edit_spans, find_new_problems, raw_html_for_field
from parse import MATH_BLOCK, Question, replace_named_entities_with_numeric
from vote import MATH_MINUS_SIGN

QUESTION_TYPES = ("scq", "mcq", "integerQuestion")
TEXT_FIELDS = ("question", "solution")
SINGLE_VALUE_FIELDS = (("answer", "answer key"), ("questionType", "question type"))


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
    for field_name in TEXT_FIELDS:
        new_blocks = Counter(find_broken_math(raw_html_for_field(after, field_name))) - Counter(find_broken_math(raw_html_for_field(before, field_name)))
        warnings += [f"Broken math in the {field_name} near: {snippet}" for snippet in new_blocks.elements()]
    return warnings


def find_ignored_key_text(typed_key: str, question_type: str) -> list[str]:
    """Flag text that the engine drops, so "A, B, Z" is not saved as "A, B"."""
    if question_type == "integerQuestion":
        number = typed_key.strip().replace(MATH_MINUS_SIGN, "-")
        return [] if re.fullmatch(r"-?\d+(\.\d+)?", number) else [f"An integer key must be only a number, not '{typed_key}'."]
    extra = [token for token in re.split(r"[\s,;/&]+|\bAND\b", typed_key.upper()) if token and token.strip("()") not in ("A", "B", "C", "D")]
    return [f"The key '{typed_key}' has text that is not an option letter: {', '.join(extra)}."] if extra else []


def unique_edits(edits: list[Edit]) -> list[Edit]:
    return list({(edit.field, edit.find, edit.replace): edit for edit in edits}.values())


def spans_overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    return first[0] < second[1] and second[0] < first[1]


def text_spans(question: Question, edits: list[Edit], field_name: str) -> list[tuple[int, int]]:
    raw = raw_html_for_field(question, field_name)
    return [span for edit in edits if edit.field == field_name for span in find_edit_spans(raw, edit.find)]


def single_values(edits: list[Edit], field_name: str) -> set[str]:
    return {edit.replace.strip() for edit in edits if edit.field == field_name}


def find_edit_errors(question: Question, edits: list[Edit]) -> list[str]:
    errors = [f"The question type must be one of {', '.join(QUESTION_TYPES)}, not '{edit.replace}'."
              for edit in edits if edit.field == "questionType" and edit.replace not in QUESTION_TYPES]
    for field_name, label in SINGLE_VALUE_FIELDS:
        values = sorted(single_values(edits, field_name))
        if len(values) > 1:
            errors.append(f"Two changes set different {label}s: {' and '.join(values)}. Keep only one.")
    for field_name in TEXT_FIELDS:
        raw = raw_html_for_field(question, field_name)
        if any(len(find_edit_spans(raw, edit.find)) != 1 for edit in edits if edit.field == field_name):
            errors.append(f"The text to replace must appear exactly once in the {field_name}. "
                          f"Copy it exactly, and add more words if it appears more than once.")
            continue
        spans = sorted(text_spans(question, edits, field_name))
        if any(spans_overlap(first, second) for first, second in zip(spans, spans[1:])):
            errors.append(f"Two changes overlap in the {field_name}. Merge them into one change.")
    return errors


def find_clashes_with_other_reports(question: Question, edits: list[Edit], other_edits: dict[str, list[Edit]]) -> list[str]:
    """Two reports on one question must not change the same thing in different ways. The same change twice is fine."""
    clashes = []
    for report_id, their_edits in other_edits.items():
        theirs = [edit for edit in their_edits if edit not in edits]
        changed = [label for field_name, label in SINGLE_VALUE_FIELDS
                   if single_values(edits, field_name) and single_values(theirs, field_name)
                   and single_values(edits, field_name) != single_values(theirs, field_name)]
        changed += [field_name for field_name in TEXT_FIELDS
                    if any(spans_overlap(mine, other) for mine in text_spans(question, edits, field_name)
                           for other in text_spans(question, theirs, field_name))]
        clashes += [f"Report {report_id} on this question already changes the {what}. "
                    f"Edit {report_id} instead, or reject or undo its change first." for what in changed]
    return clashes


def find_format_warnings(question: Question, edits: list[Edit], baseline_edits: list[Edit]) -> list[str]:
    combined = unique_edits([*baseline_edits, *edits])
    baseline, edited = apply_edits_to_copy(question, baseline_edits), apply_edits_to_copy(question, combined)
    warnings = [finding.detail for finding in find_new_problems(run_all_checks(baseline), run_all_checks(edited))]
    warnings += find_new_broken_math(baseline, edited)
    warnings += [warning for edit in edits if edit.field == "answer" for warning in find_ignored_key_text(edit.replace, edited.question_type)]
    return warnings


def check_teacher_edit(question: Question, edits: list[Edit], other_edits: dict[str, list[Edit]]) -> tuple[list[str], list[str]]:
    """Errors: the edit cannot be applied, so it is never saved. Warnings: format problems the teacher may accept.
    The edit is checked on top of the live edits of the other reports, and only new problems are reported."""
    errors = find_edit_errors(question, edits) or find_clashes_with_other_reports(question, edits, other_edits)
    if errors:
        return errors, []
    baseline_edits = unique_edits([edit for report_edits in other_edits.values() for edit in report_edits])
    # If the other changes do not apply cleanly themselves, check the edit against the stored question alone.
    if find_edit_errors(question, baseline_edits):
        baseline_edits = []
    return [], find_format_warnings(question, edits, baseline_edits)
