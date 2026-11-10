import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

import anthropic

from parse import Question

ENGINE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ENGINE_DIR.parent
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

SOLVER_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["solved", "cannot_solve", "no_option_matches"]},
        "answer": {"type": "string"},
        "value": {"type": "string"},
        "working": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["status", "answer", "value", "working", "note"],
    "additionalProperties": False,
}


@dataclass
class CallUsage:
    step: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    from_cache: bool


class ModelRefusedError(Exception):
    pass


def load_env_file(path: Path = PROJECT_DIR / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


def read_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def calculate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    input_price, output_price = PRICE_PER_MILLION_TOKENS[model]
    return (input_tokens * input_price + output_tokens * output_price) / 1_000_000


def build_cache_path(step: str, request: dict) -> Path:
    digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    return CACHE_DIR / f"{step}-{digest}.json"


def call_claude_for_json(step: str, model: str, system_prompt: str, user_message: str,
                         schema: dict, effort: str, client: anthropic.Anthropic | None = None) -> tuple[dict, CallUsage]:
    request = {"model": model, "system": system_prompt, "user": user_message, "schema": schema, "effort": effort}
    cache_path = build_cache_path(step, request)

    if cache_path.exists():
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        usage = CallUsage(**{**cached["usage"], "from_cache": True})
        return cached["result"], usage

    client = client or anthropic.Anthropic()
    response = client.beta.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        betas=[FALLBACK_BETA],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise ModelRefusedError(f"{model} declined the {step} request.")
    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"{model} hit the output limit on the {step} request. Raise MAX_OUTPUT_TOKENS.")

    text = next(block.text for block in response.content if block.type == "text")
    result = json.loads(text)
    usage = CallUsage(
        step=step,
        model=model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        cost_usd=calculate_cost_usd(model, response.usage.input_tokens, response.usage.output_tokens),
        from_cache=False,
    )

    CACHE_DIR.mkdir(exist_ok=True)
    cached_usage = {key: value for key, value in usage.__dict__.items() if key != "from_cache"}
    cache_path.write_text(json.dumps({"request": request, "result": result, "usage": cached_usage}, indent=2, ensure_ascii=False), encoding="utf-8")
    return result, usage


def format_question_for_solver(question: Question) -> str:
    lines = [f"Subject: {question.subject}", f"Question type: {QUESTION_TYPE_LABELS[question.question_type]}", "", question.stem_text]
    for letter, text in question.options.items():
        lines.append(f"({letter}) {text or '[blank]'}")
    return "\n".join(lines)


def solve_question(question: Question, model: str, effort: str = "high", step: str = "solver") -> tuple[dict, CallUsage]:
    return call_claude_for_json(step, model, read_prompt("solver"), format_question_for_solver(question), SOLVER_SCHEMA, effort)
