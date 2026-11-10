import copy
import re
from dataclasses import dataclass, field

from ai import TAXONOMY, Edit, ReportJudgment
from checks import Finding, run_all_checks
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


def replace_edit_text_once(raw: str, find: str, replace: str) -> str:
    return build_edit_pattern(find).sub(lambda _: replace, raw, count=1)


def apply_edits_to_copy(question: Question, edits: list[Edit]) -> Question:
    record = copy.deepcopy(question.raw_record)
    for edit in sorted(edits, key=lambda item: item.field != "questionType"):
        kind = record["questionType"]
        if edit.field == "questionType":
            record[edit.replace] = record.pop(kind)
            record["questionType"] = edit.replace
        elif edit.field == "answer":
            normalized = normalize_answer(edit.replace, kind)
            record[kind]["answer"] = normalized.split(", ") if kind == "mcq" else normalized
        else:
            record[kind][edit.field] = replace_edit_text_once(record[kind][edit.field], edit.find, edit.replace)
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

    raw = question.raw_question_html if edit.field == "question" else question.raw_solution_html
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
        target = str(question.answer)
    else:
        target = question.options.get(str(question.answer).strip(), "")
    tail = squash_spaces(question.solution_text)[-max(60, len(squash_spaces(question.solution_text)) // 3):]
    return bool(target) and squash_spaces(target) in tail


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
    before = {(finding.check, finding.detail) for finding in findings_before}
    after = run_all_checks(edited)
    problems = [f"the fixed copy has a new problem: {finding.detail}" for finding in after if (finding.check, finding.detail) not in before]
    still_present = {finding.check for finding in after} & FINDINGS_EACH_REPAIR_MUST_CLEAR.get(repair, set())
    if still_present:
        problems.append(f"the fix did not clear: {', '.join(sorted(still_present))}")
    if repair == "option_repair" and edited.stem_text != question.stem_text:
        problems.append("an option fix changed the question text")
    if repair != "answer_key" and repair != "type_mismatch" and not answers_match(
            normalize_answer(edited.answer, edited.question_type), normalize_answer(question.answer, question.question_type), question.question_type):
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

    edited = apply_edits_to_copy(question, judgment.edits)
    problems = find_vote_problems(repair, vote, edited, judgment.edits) + find_test_problems(question, edited, repair, findings)
    if problems:
        return build_teacher_decision(judgment, vote, "Check failed: " + "; ".join(problems) + ".")

    confidence = 0.95 if repair in LOW_RISK_REPAIRS else vote.confidence
    return Decision(judgment.report_id, "auto_apply", f"All checks pass. {vote.explanation}", confidence, judgment.reply_final, judgment.edits)


def edit_signature(edits: list[Edit]) -> tuple:
    return tuple((edit.field, edit.find, edit.replace) for edit in edits)


def edits_overlap(first: Edit, second: Edit, question: Question) -> bool:
    if first.field != second.field:
        return False
    if first.field in ("answer", "questionType"):
        return first.replace != second.replace
    raw = question.raw_question_html if first.field == "question" else question.raw_solution_html
    (start_a, end_a), (start_b, end_b) = find_edit_spans(raw, first.find)[0], find_edit_spans(raw, second.find)[0]
    return start_a < end_b and start_b < end_a


def use_one_fix_per_repair(decisions: list[Decision], judgments: list[ReportJudgment]) -> None:
    """Reports on the same defect get the same fix, so two wordings of one fix never collide."""
    first_fix_by_repair: dict[str, list[Edit]] = {}
    for decision, judgment in zip(decisions, judgments):
        if decision.route == "auto_apply":
            decision.edits = first_fix_by_repair.setdefault(judgment.repair, decision.edits)


def find_conflicting_fix_sets(question: Question, fix_sets: list[list[Edit]]) -> bool:
    return any(edits_overlap(a, b, question)
               for i, first_set in enumerate(fix_sets) for second_set in fix_sets[i + 1:]
               for a in first_set for b in second_set)


def decide_routes_for_question(question: Question, judgments: list[ReportJudgment], vote: Vote,
                               findings: list[Finding]) -> tuple[list[Decision], Question]:
    """Route every report, then check that all auto fixes for the question work together on one copy."""
    decisions = [decide_route(question, judgment, vote, findings) for judgment in judgments]
    use_one_fix_per_repair(decisions, judgments)
    fix_sets = list({edit_signature(d.edits): d.edits for d in decisions if d.route == "auto_apply"}.values())
    if not fix_sets:
        return decisions, question

    edited = apply_edits_to_copy(question, [edit for edits in fix_sets for edit in edits])
    before = {(finding.check, finding.detail) for finding in findings}
    new_problems = [finding for finding in run_all_checks(edited) if (finding.check, finding.detail) not in before]
    if find_conflicting_fix_sets(question, fix_sets) or new_problems:
        for index, decision in enumerate(decisions):
            if decision.route == "auto_apply":
                decisions[index] = build_teacher_decision(judgments[index], vote, "The fixes on this question conflict when applied together.")
        return decisions, question
    return decisions, edited
