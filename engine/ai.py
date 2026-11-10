import hashlib
import html
import json
import os
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path
from typing import Literal

import anthropic
from pydantic import BaseModel

from checks import Finding
from parse import PROJECT_DIR, Question, load_taxonomy

ENGINE_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = ENGINE_DIR / "prompts"
CACHE_DIR = ENGINE_DIR / "cache"

SONNET = "claude-sonnet-5-5"
OPUS = "claude-opus-5-5"
PRICE_PER_MILLION_TOKENS = {SONNET: (2.00, 10.00), OPUS: (4.00, 20.00)}
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_OUTPUT_TOKENS = 16000

QUESTION_TYPE_LABELS = {
    "scq": "single-correct (exactly one option is right)",
    "mcq": "multiple-correct (one or more options are right)",
    "integerQuestion": "integer answer (no options)",
}

TAXONOMY = load_taxonomy()
Verdict = Literal[tuple(TAXONOMY["verdicts"])]
Repair = Literal[tuple(TAXONOMY["repairs"])]
RepairOrNone = Literal[tuple(TAXONOMY["repairs"]) + ("none",)]


class SolverResult(BaseModel):
    # Field order is the order the model writes in, so it works the problem out before it commits to a status.
    working: str
    value: str
    answer: str
    status: Literal["solved", "cannot_solve", "no_option_matches"]
    note: str


class Edit(BaseModel):
    field: Literal["question", "solution", "answer", "questionType"]
    find: str
    replace: str


class ReportJudgment(BaseModel):
    report_id: str
    student_claim: str
    claim_supported: Literal["yes", "partly", "no", "unclear"]
    verdict: Verdict
    repair: RepairOrNone
    edits: list[Edit]
    evidence: str
    reply_final: str
    reply_pending: str


class OtherDefect(BaseModel):
    repair: Repair
    evidence: str
    edits: list[Edit]


class JudgeResult(BaseModel):
    solution_answer: str
    solution_fits_question: bool
    reports: list[ReportJudgment]
    other_defects: list[OtherDefect]


@dataclass
class CallUsage:
    step: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    from_cache: bool = False


class ModelRefusedError(Exception):
    pass


def remove_matching_quotes(value: str) -> str:
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"" else value


def load_env_file(path: Path = PROJECT_DIR / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), remove_matching_quotes(value.strip()))


@cache
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def read_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def calculate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    input_price, output_price = PRICE_PER_MILLION_TOKENS[model]
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000


def build_cache_path(step: str, request: dict) -> Path:
    digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    return CACHE_DIR / f"{step}-{digest}.json"


def call_claude[T: BaseModel](step: str, model: str, system_prompt: str, user_message: str,
                              output_model: type[T], effort: str) -> tuple[T, CallUsage]:
    # The schema is part of the key, so changing a model's fields forces a fresh call.
    request = {"model": model, "system": system_prompt, "user": user_message,
               "schema": output_model.model_json_schema(), "effort": effort}
    cache_path = build_cache_path(step, request)

    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        return output_model.model_validate(cached["result"]), CallUsage(**cached["usage"], from_cache=True)

    response = get_client().beta.messages.parse(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        output_format=output_model,
        output_config={"effort": effort},
        betas=[FALLBACK_BETA],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise ModelRefusedError(f"{model} declined the {step} request.")
    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"{model} hit the output limit on the {step} request. Raise MAX_OUTPUT_TOKENS.")

    result = response.parsed_output
    if result is None:
        raise RuntimeError(f"{model} returned no parsable output for the {step} request (stop reason: {response.stop_reason}).")
    usage = CallUsage(
        step=step,
        model=model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cost_usd=calculate_cost_usd(model, response.usage.input_tokens, response.usage.output_tokens),
    )

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    usage_to_store = {key: value for key, value in asdict(usage).items() if key != "from_cache"}
    cache_path.write_text(
        json.dumps({"request": request, "result": result.model_dump(mode="json"), "usage": usage_to_store}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return result, usage


def format_question_for_solver(question: Question) -> str:
    lines = [f"Subject: {question.subject}", f"Question type: {QUESTION_TYPE_LABELS[question.question_type]}", "", question.stem_text]
    for letter, text in question.options.items():
        lines.append(f"({letter}) {text or '[blank]'}")
    return "\n".join(lines)


def solve_question(question: Question, model: str, effort: str = "high", step: str = "solver") -> tuple[SolverResult, CallUsage]:
    return call_claude(step, model, read_prompt("solver"), format_question_for_solver(question), SolverResult, effort)


def format_question_for_judge(question: Question, findings: list[Finding], solver_results: list[SolverResult]) -> str:
    options = "\n".join(f"({letter}) {text or '[blank]'}" for letter, text in question.options.items()) or "(no options: integer question)"
    finding_lines = "\n".join(
        f"- {finding.detail}" + (f" [report {finding.report_id}]" if finding.report_id else "") for finding in findings
    ) or "- No problems found."
    solver_lines = "\n".join(
        f"- Solver {index}: status={result.status}, answer={result.answer or '-'}, value={result.value or '-'}. "
        f"Working: {result.working} Note: {result.note or '-'}"
        for index, result in enumerate(solver_results, start=1)
    )
    report_blocks = "\n".join(
        f'<report id="{report.report_id}" platform="{report.source}" reported_at="{report.reported_at}">\n'
        f"<comment>{html.escape(report.comment, quote=False)}</comment>\n</report>"
        for report in question.reports
    ) or "No student reports. Look only for other defects."

    return f"""<question id="{question.question_id}" subject="{question.subject}" chapter="{question.chapter}" questionType="{question.question_type}" type_meaning="{QUESTION_TYPE_LABELS[question.question_type]}" last_edited="{question.updated_at}">
<stem>{question.stem_text}</stem>
<options>
{options}
</options>
<answer_key>{question.answer!r}</answer_key>
<solution>{question.solution_text}</solution>
<original_question_html>{question.raw_question_html}</original_question_html>
<original_solution_html>{question.raw_solution_html}</original_solution_html>
</question>

<code_checks>
{finding_lines}
</code_checks>

<solvers>
{solver_lines}
</solvers>

<reports>
{report_blocks}
</reports>

<taxonomy>
{json.dumps(TAXONOMY, indent=1, ensure_ascii=False)}
</taxonomy>"""


def judge_question(question: Question, findings: list[Finding], solver_results: list[SolverResult]) -> tuple[JudgeResult, CallUsage]:
    user_message = format_question_for_judge(question, findings, solver_results)
    return call_claude("judge", SONNET, read_prompt("judge"), user_message, JudgeResult, "high")
