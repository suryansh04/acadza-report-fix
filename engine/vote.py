import re
from dataclasses import dataclass
from typing import Any

from ai import SolverResult
from checks import extract_option_letters
from parse import Question

# Only rounding counts as the same value: 3113 and 3112.99 match, 3113 and 3100 do not.
NUMBER_TOLERANCE = 0.0001
# Numerical answers are given to two decimal places, so 0.67 and 0.6667 are the same answer.
TWO_DECIMAL_ROUNDING = 0.005
MATH_MINUS_SIGN = "−"
CONFIDENCE_BY_OUTCOME = {
    "all_agree": 0.95,
    "key_wrong": 0.93,
    "solution_wrong": 0.90,
    "key_confirmed": 0.85,
    "question_unsolvable": 0.85,
    "key_unconfirmed": 0.60,
    "key_and_solution_vs_solvers": 0.50,
    "solvers_disagree": 0.40,
}


@dataclass
class Vote:
    outcome: str
    agreed_answer: str | None
    agreed_status: str | None
    key: str | None
    solution_answer: str | None
    solver_answers: list[str]
    confidence: float
    explanation: str


def normalize_answer(value: Any, question_type: str) -> str | None:
    """Turn any stored or AI answer into one comparable form, or None if it has no usable answer."""
    if value is None:
        return None
    if question_type == "integerQuestion":
        match = re.search(r"-?\d+(\.\d+)?", str(value).replace(MATH_MINUS_SIGN, "-"))
        # Plain "g" keeps only 6 digits, which would turn a key of 1234567 into 1.23457e+06.
        return format(float(match.group(0)), ".15g") if match else None
    letters = extract_option_letters(value)
    if not letters or (question_type == "scq" and len(letters) != 1):
        return None
    return ", ".join(letters)


def answers_match(first: str | None, second: str | None, question_type: str) -> bool:
    if first is None or second is None:
        return False
    if question_type == "integerQuestion":
        a, b = float(first), float(second)
        return abs(a - b) <= max(NUMBER_TOLERANCE * max(abs(a), abs(b)), TWO_DECIMAL_ROUNDING)
    return first == second


def describe_solver_vote(result: SolverResult, question_type: str) -> tuple[str, str | None]:
    if result.status != "solved":
        return result.status, None
    # Two letters on a single-correct question is a clear finding (the question is broken), not an unusable answer.
    if question_type == "scq" and len(extract_option_letters(result.answer)) > 1:
        return "multiple_correct", None
    answer = normalize_answer(result.answer, question_type)
    return ("solved", answer) if answer else ("unusable", None)


def find_solver_consensus(solver_results: list[SolverResult], question_type: str) -> tuple[str, str | None] | None:
    """A status and answer that at least two solvers share, or None if they all differ."""
    votes = [describe_solver_vote(result, question_type) for result in solver_results]
    for status, answer in votes:
        if status == "unusable":
            continue
        agreeing = [vote for vote in votes if vote[0] == status and (status != "solved" or answers_match(vote[1], answer, question_type))]
        if len(agreeing) >= 2:
            return status, answer
    return None


def solvers_need_tiebreak(solver_results: list[SolverResult], question_type: str) -> bool:
    return len(solver_results) == 2 and find_solver_consensus(solver_results, question_type) is None


def build_vote(question: Question, solver_results: list[SolverResult], solution_answer: str, solution_fits_question: bool) -> Vote:
    kind = question.question_type
    key = normalize_answer(question.answer, kind)
    solution = normalize_answer(solution_answer, kind) if solution_fits_question else None
    solver_answers = [f"{result.status}:{result.answer}" if result.answer else result.status for result in solver_results]
    consensus = find_solver_consensus(solver_results, kind)

    def make_vote(outcome: str, explanation: str) -> Vote:
        return Vote(outcome, consensus[1] if consensus else None, consensus[0] if consensus else None,
                    key, solution, solver_answers, CONFIDENCE_BY_OUTCOME[outcome], explanation)

    if consensus is None:
        return make_vote("solvers_disagree", "The solvers do not agree on an answer.")
    status, agreed = consensus
    if status != "solved":
        return make_vote("question_unsolvable", f"The solvers agree the question cannot be answered as written ({status}).")

    key_ok = answers_match(key, agreed, kind)
    solution_ok = answers_match(solution, agreed, kind)
    if key_ok and solution_ok:
        return make_vote("all_agree", f"Key, solution and solvers all give {agreed}.")
    if key_ok and solution is None:
        return make_vote("key_confirmed", f"Key and solvers give {agreed}. The solution has no usable answer.")
    if key_ok:
        return make_vote("solution_wrong", f"Key and solvers give {agreed}, but the solution ends at {solution}.")
    if solution_ok:
        return make_vote("key_wrong", f"Solvers and solution give {agreed}, but the key says {key}.")
    if solution is not None and answers_match(key, solution, kind):
        return make_vote("key_and_solution_vs_solvers", f"Key and solution give {key}, but the solvers give {agreed}.")
    return make_vote("key_unconfirmed", f"Solvers give {agreed}, the key says {key}, and the solution does not confirm either.")
