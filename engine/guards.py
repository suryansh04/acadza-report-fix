import copy
import re
from dataclasses import dataclass, field

from ai import TAXONOMY, Edit, ReportJudgment
from checks import Finding, extract_option_letters, run_all_checks
from parse import Question, build_question
from vote import Vote, answers_match, normalize_answer

LOW_RISK_REPAIRS = {"spelling", "noise", "exam_reference", "markup_leak"}
SOLUTION_REPAIRS = {"solution_fix", "solution_missing"}
MAX_EDIT_LENGTH = 600
QUESTION_TYPES = {"scq", "mcq", "integerQuestion"}
KEY_CONFIRMED_OUTCOMES = {"all_agree", "key_confirmed", "solution_wrong"}
FINDINGS_EACH_REPAIR_MUST_CLEAR = {
    "option_repair": {"option_missing", "option_blank", "key_option_missing", "key_option_blank"},
    "markup_leak": {"markup_leak"},
    "exam_reference": {"exam_reference"},
    "noise": {"noise"},
    "type_mismatch": {"single_answer_in_mcq", "answer_format"},
}
DEFAULT_PENDING_REPLY = "Thank you for reporting this. A teacher will check this question soon."


@dataclass
class Decision:
    report_id: str
    route: str
    reason: str
    confidence: float
    reply: str
    edits: list[Edit] = field(default_factory=list)


def extract_math_blocks(markup: str) -> list[str]:
    return re.findall(r"<math\b.*?</math>", markup, flags=re.DOTALL)


def extract_numbers(text: str) -> list[str]:
    return re.findall(r"\d+(?:\.\d+)?", text)


def is_subsequence(shorter: str, longer: str) -> bool:
    remaining = iter(longer)
    return all(character in remaining for character in shorter)


def squash_spaces(text: str) -> str:
    return re.sub(r"\s+", "", text)


def build_edit_pattern(find: str) -> re.Pattern:
    # Stored HTML uses Windows line breaks; the model writes plain "\n". Treat both as the same break.
    return re.compile(r"\r?\n".join(re.escape(part) for part in find.replace("\r\n", "\n").split("\n")))


def find_edit_spans(raw: str, find: str) -> list[tuple[int, int]]:
    return [match.span() for match in build_edit_pattern(find).finditer(raw)] if find else []


def splice_edits_into_text(raw: str, edits: list[Edit]) -> str:
    # Each edit goes where its text was in the original, so one edit's new text can never catch another edit's find.
    for (start, end), replace in sorted(((find_edit_spans(raw, edit.find)[0], edit.replace) for edit in edits), reverse=True):
        raw = raw[:start] + replace + raw[end:]
    return raw


def raw_html_for_field(question: Question, field_name: str) -> str:
    return question.raw_question_html if field_name == "question" else question.raw_solution_html


def find_new_problems(findings_before: list[Finding], findings_after: list[Finding]) -> list[Finding]:
    before = {(finding.check, finding.detail) for finding in findings_before}
    return [finding for finding in findings_after if (finding.check, finding.detail) not in before]


def apply_edits_to_copy(question: Question, edits: list[Edit]) -> Question:
    record = copy.deepcopy(question.raw_record)
    for edit in sorted(edits, key=lambda item: item.field != "questionType"):
        kind = record["questionType"]
        if edit.field == "questionType":
            record[edit.replace] = record.pop(kind)
            record["questionType"] = edit.replace
        elif edit.field == "answer":
            normalized = normalize_answer(edit.replace, kind)
            # An unusable key is stored as written, so the checks flag it and the case goes to a teacher.
            if normalized is None:
                record[kind]["answer"] = edit.replace
            else:
                record[kind]["answer"] = normalized.split(", ") if kind == "mcq" else normalized
    kind = record["questionType"]
    for field_name in ("question", "solution"):
        field_edits = [edit for edit in edits if edit.field == field_name]
        if field_edits:
            record[kind][field_name] = splice_edits_into_text(record[kind][field_name], field_edits)
    edited = build_question(record)
    edited.reports = question.reports
    return edited


def find_edit_problems(question: Question, edit: Edit, repair: str) -> list[str]:
    allowed_fields = TAXONOMY["repairs"][repair]["fields"]
    if edit.field not in allowed_fields:
        return [f"edit changes '{edit.field}', which {repair} does not allow"]

    if edit.field == "questionType":
        if edit.find != question.question_type or edit.replace not in QUESTION_TYPES:
            return [f"type edit '{edit.find}' -> '{edit.replace}' does not match the stored type"]
        return []
    if edit.field == "answer":
        return []

    raw = raw_html_for_field(question, edit.field)
    problems = []
    occurrences = len(find_edit_spans(raw, edit.find))
    if occurrences != 1:
        problems.append(f"the text to replace appears {occurrences} times in the {edit.field}, not once")
    if repair not in SOLUTION_REPAIRS and max(len(edit.find), len(edit.replace)) > MAX_EDIT_LENGTH:
        problems.append("the edit is too large for a surgical fix")
    if repair == "spelling" and (extract_numbers(edit.find) != extract_numbers(edit.replace)
                                 or extract_math_blocks(edit.find) != extract_math_blocks(edit.replace)):
        problems.append("the spelling fix changes a number or a formula")
    if repair in ("noise", "exam_reference") and not (len(edit.replace) < len(edit.find) and is_subsequence(edit.replace, edit.find)):
        problems.append(f"this {repair} fix may only remove text")
    if repair == "answer_form" and not (len(edit.replace) > len(edit.find) and is_subsequence(edit.find, edit.replace)):
        problems.append("an answer_form fix may only add text")
    if repair == "stem_data":
        added_numbers = set(extract_numbers(edit.replace)) - set(extract_numbers(edit.find))
        missing = [number for number in added_numbers if number not in extract_numbers(question.solution_text)]
        if missing:
            problems.append(f"the added value(s) {', '.join(missing)} are not stated in the solution")
    return problems


def solution_ends_at_key(question: Question) -> bool:
    if question.question_type == "integerQuestion":
        targets = [str(question.answer)]
    else:
        targets = [question.options.get(letter, "") for letter in extract_option_letters(question.answer)]
    tail = squash_spaces(question.solution_text)[-max(60, len(squash_spaces(question.solution_text)) // 3):]
    return bool(targets) and all(target and squash_spaces(target) in tail for target in targets)


def find_vote_problems(repair: str, vote: Vote, edited: Question, edits: list[Edit]) -> list[str]:
    if repair in LOW_RISK_REPAIRS:
        return []
    new_answer = next((normalize_answer(edit.replace, edited.question_type) for edit in edits if edit.field == "answer"), None)

    if repair in ("answer_key", "type_mismatch") and new_answer is None:
        return ["the new key is not a valid answer for this question type"]
    if repair == "answer_key":
        if not answers_match(new_answer, vote.agreed_answer, edited.question_type):
            return [f"the new key {new_answer} is not the answer the solvers agree on ({vote.agreed_answer})"]
        if vote.outcome != "key_wrong" and not answers_match(vote.key, vote.agreed_answer, edited.question_type):
            return [f"the vote does not prove the key is wrong ({vote.outcome})"]
        return []
    if repair == "type_mismatch":
        if not answers_match(new_answer, vote.agreed_answer, edited.question_type):
            return [f"the new key {new_answer} is not the answer the solvers agree on ({vote.agreed_answer})"]
        return []
    if repair in SOLUTION_REPAIRS:
        if vote.outcome not in KEY_CONFIRMED_OUTCOMES:
            return [f"the solvers do not confirm the key ({vote.outcome})"]
        if not solution_ends_at_key(edited):
            return ["the new solution does not end at the key's answer"]
        return []
    if repair in ("stem_data", "option_repair"):
        if vote.outcome not in KEY_CONFIRMED_OUTCOMES | {"question_unsolvable"}:
            return [f"the vote does not support this fix ({vote.outcome})"]
        return []
    if vote.outcome not in KEY_CONFIRMED_OUTCOMES:
        return [f"the solvers do not confirm the key ({vote.outcome})"]
    return []


def find_test_problems(question: Question, edited: Question, repair: str, findings_before: list[Finding]) -> list[str]:
    findings_after = run_all_checks(edited)
    problems = [f"the fixed copy has a new problem: {finding.detail}" for finding in find_new_problems(findings_before, findings_after)]
    still_present = {finding.check for finding in findings_after} & FINDINGS_EACH_REPAIR_MUST_CLEAR.get(repair, set())
    if still_present:
        problems.append(f"the fix did not clear: {', '.join(sorted(still_present))}")
    if repair == "option_repair" and edited.stem_text != question.stem_text:
        problems.append("an option fix changed the question text")
    if repair not in ("answer_key", "type_mismatch") and edited.answer != question.answer:
        problems.append(f"a {repair} fix changed the answer key")
    return problems


def build_teacher_decision(judgment: ReportJudgment, vote: Vote, reason: str) -> Decision:
    return Decision(judgment.report_id, "faculty_review", reason, min(vote.confidence, 0.7),
                    judgment.reply_pending or DEFAULT_PENDING_REPLY, judgment.edits)


def decide_route(question: Question, judgment: ReportJudgment, vote: Vote, findings: list[Finding]) -> Decision:
    if judgment.verdict != "defect":
        return Decision(judgment.report_id, "no_change", f"No fix needed ({judgment.verdict}).", vote.confidence, judgment.reply_final)

    repair = judgment.repair
    if repair == "none":
        return build_teacher_decision(judgment, vote, "A defect was found but no repair type was chosen.")
    if not TAXONOMY["repairs"][repair]["auto"]:
        return build_teacher_decision(judgment, vote, f"'{repair}' always needs a teacher.")
    if not judgment.edits:
        return build_teacher_decision(judgment, vote, "No edit was proposed.")

    problems = [problem for edit in judgment.edits for problem in find_edit_problems(question, edit, repair)]
    if problems:
        return build_teacher_decision(judgment, vote, "Guard: " + "; ".join(problems) + ".")
    if find_conflicting_fix_sets(question, [[edit] for edit in judgment.edits]):
        return build_teacher_decision(judgment, vote, "Guard: two edits in this fix change the same text.")

    edited = apply_edits_to_copy(question, judgment.edits)
    problems = find_vote_problems(repair, vote, edited, judgment.edits) + find_test_problems(question, edited, repair, findings)
    if problems:
        return build_teacher_decision(judgment, vote, "Check failed: " + "; ".join(problems) + ".")

    if repair in LOW_RISK_REPAIRS:
        return Decision(judgment.report_id, "auto_apply", "All checks pass. The fix changes only words or layout, never a number, formula or key.",
                        0.95, judgment.reply_final, judgment.edits)
    return Decision(judgment.report_id, "auto_apply", f"All checks pass. {vote.explanation}", vote.confidence, judgment.reply_final, judgment.edits)


def edit_signature(edits: list[Edit]) -> tuple:
    return tuple((edit.field, edit.find, edit.replace) for edit in edits)


def edits_overlap(first: Edit, second: Edit, question: Question) -> bool:
    if first.field != second.field:
        return False
    if first.field in ("answer", "questionType"):
        return first.replace != second.replace
    raw = raw_html_for_field(question, first.field)
    (start_a, end_a), (start_b, end_b) = find_edit_spans(raw, first.find)[0], find_edit_spans(raw, second.find)[0]
    return start_a < end_b and start_b < end_a


def fix_sets_overlap(first: list[Edit], second: list[Edit], question: Question) -> bool:
    return any(edits_overlap(a, b, question) for a in first for b in second)


def fix_covers_edits(fix: list[Edit], edits: list[Edit], question: Question) -> bool:
    return all(any(edit == kept or edits_overlap(kept, edit, question) for kept in fix) for edit in edits)


def use_one_fix_per_defect(decisions: list[Decision], judgments: list[ReportJudgment], question: Question) -> None:
    """Two reports on the same defect get one fix, so two wordings of that fix never collide.

    Fixes of the same repair type that touch different text are different defects and both stay.
    A fix with an edit that the first fix does not cover also stays, so that edit is never dropped.
    """
    kept: list[tuple[str, list[Edit]]] = []
    for decision, judgment in zip(decisions, judgments):
        if decision.route != "auto_apply":
            continue
        same_defect = next((edits for repair, edits in kept
                            if repair == judgment.repair and fix_covers_edits(edits, decision.edits, question)), None)
        if same_defect is None:
            kept.append((judgment.repair, decision.edits))
        else:
            decision.edits = same_defect


def find_conflicting_fix_sets(question: Question, fix_sets: list[list[Edit]]) -> bool:
    return any(fix_sets_overlap(first, second, question)
               for index, first in enumerate(fix_sets) for second in fix_sets[index + 1:])


def send_auto_fixes_to_teacher(decisions: list[Decision], judgments: list[ReportJudgment], vote: Vote, reason: str) -> list[Decision]:
    return [build_teacher_decision(judgment, vote, reason) if decision.route == "auto_apply" else decision
            for decision, judgment in zip(decisions, judgments)]


def decide_routes_for_question(question: Question, judgments: list[ReportJudgment], vote: Vote,
                               findings: list[Finding]) -> tuple[list[Decision], Question]:
    """Route every report, then check that all auto fixes for the question work together on one copy."""
    decisions = [decide_route(question, judgment, vote, findings) for judgment in judgments]
    use_one_fix_per_defect(decisions, judgments, question)
    fix_sets = list({edit_signature(d.edits): d.edits for d in decisions if d.route == "auto_apply"}.values())
    if not fix_sets:
        return decisions, question

    if find_conflicting_fix_sets(question, fix_sets):
        return send_auto_fixes_to_teacher(decisions, judgments, vote, "The fixes on this question change the same text."), question
    edited = apply_edits_to_copy(question, [edit for edits in fix_sets for edit in edits])
    if find_new_problems(findings, run_all_checks(edited)):
        return send_auto_fixes_to_teacher(decisions, judgments, vote, "The fixes on this question cause a new problem when applied together."), question
    return decisions, edited
