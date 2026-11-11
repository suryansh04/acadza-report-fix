# These are the engine's modules. main.py puts engine/ on the import path before it imports this file.
import re
import xml.etree.ElementTree as ElementTree
from collections import Counter

from ai import Edit
from checks import run_all_checks
from guards import apply_edits_to_copy, find_edit_spans, find_new_problems, raw_html_for_field
from parse import MATH_BLOCK, Question, replace_named_entities_with_numeric
from vote import MATH_MINUS_SIGN

QUESTION_TYPES = ("scq", "mcq", "integerQuestion")


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
