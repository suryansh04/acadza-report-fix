import html
import json
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from html.entities import name2codepoint
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OPTION_LETTERS = ("A", "B", "C", "D")
OPTION_MARKER = re.compile(r"\(\s*([A-D])\s*\)")
MATH_BLOCK = re.compile(r"<math\b.*?</math>", re.DOTALL)
XML_SAFE_ENTITIES = {"lt", "gt", "amp", "quot", "apos"}


@dataclass
class Report:
    report_id: str
    question_id: str
    student_id: str
    source: str
    reported_at: str
    comment: str


@dataclass
class Question:
    question_id: str
    question_type: str
    subject: str
    chapter: str
    updated_at: str
    error_history: list
    raw_question_html: str
    raw_solution_html: str
    answer: str | list
    stem_text: str
    options: dict[str, str]
    solution_text: str
    options_parsed_cleanly: bool
    image_count: int = 0
    reports: list[Report] = field(default_factory=list)


def load_json_file(path: Path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def replace_named_entities_with_numeric(markup: str) -> str:
    def to_numeric(match: re.Match) -> str:
        name = match.group(1)
        if name in XML_SAFE_ENTITIES or name not in name2codepoint:
            return match.group(0)
        return f"&#{name2codepoint[name]};"

    return re.sub(r"&([a-zA-Z]+);", to_numeric, markup)


def local_tag_name(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def wrap_if_compound(text: str) -> str:
    return text if re.fullmatch(r"[\w.]+", text) else f"({text})"


def convert_mathml_element_to_text(element: ElementTree.Element) -> str:
    tag = local_tag_name(element)
    children = [convert_mathml_element_to_text(child) for child in element]

    if tag in ("mi", "mn", "mo", "mtext"):
        return (element.text or "").strip()
    if tag == "mspace":
        return " "
    if tag == "mfrac" and len(children) == 2:
        return f"{wrap_if_compound(children[0])}/{wrap_if_compound(children[1])}"
    if tag == "msup" and len(children) == 2:
        return f"{children[0]}^{wrap_if_compound(children[1])}"
    if tag == "msub" and len(children) == 2:
        return f"{children[0]}_{wrap_if_compound(children[1])}"
    if tag == "msubsup" and len(children) == 3:
        return f"{children[0]}_{wrap_if_compound(children[1])}^{wrap_if_compound(children[2])}"
    if tag == "msqrt":
        return f"sqrt({' '.join(children)})"
    if tag == "mover" and len(children) == 2:
        return f"{children[0]}{children[1]}"
    if tag == "mtable":
        return "; ".join(children)
    return " ".join(part for part in children if part.strip())


def convert_math_block_to_text(math_markup: str) -> str:
    try:
        root = ElementTree.fromstring(replace_named_entities_with_numeric(math_markup))
    except ElementTree.ParseError:
        # Broken MathML still carries readable tokens, so fall back to its bare text.
        return html.unescape(re.sub(r"<[^>]+>", " ", math_markup))
    return convert_mathml_element_to_text(root)


def convert_html_to_plain_text(markup: str) -> str:
    if not markup:
        return ""
    text = MATH_BLOCK.sub(lambda match: " " + convert_math_block_to_text(match.group(0)) + " ", markup)
    text = re.sub(r"<sup>(.*?)</sup>", r"^\1", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<sub>(.*?)</sub>", r"_\1", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<br\s*/?>|</(h\d|p|li|div)>", "\n", text, flags=re.IGNORECASE)
    text = html.unescape(re.sub(r"<[^>]+>", "", text)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def find_option_marker_positions(text: str) -> list[re.Match]:
    """Pick the last run of (A), (B), (C), (D) markers.

    Assertion-reason stems use "(A)" for the assertion itself, so the real
    options are the latest, longest chain of markers in order.
    """
    markers = list(OPTION_MARKER.finditer(text))
    best_chain: list[re.Match] = []
    for start_index, marker in enumerate(markers):
        if marker.group(1) != "A":
            continue
        chain = [marker]
        for candidate in markers[start_index + 1:]:
            expected_letter = OPTION_LETTERS[len(chain)] if len(chain) < len(OPTION_LETTERS) else None
            if candidate.group(1) == expected_letter:
                chain.append(candidate)
        if len(chain) >= len(best_chain):
            best_chain = chain
    return best_chain


def split_stem_and_options(question_text: str) -> tuple[str, dict[str, str]]:
    chain = find_option_marker_positions(question_text)
    if not chain:
        return question_text.strip(), {}

    stem = question_text[: chain[0].start()].strip()
    options = {}
    for index, marker in enumerate(chain):
        end = chain[index + 1].start() if index + 1 < len(chain) else len(question_text)
        options[marker.group(1)] = question_text[marker.end(): end].strip()
    return stem, options


def build_question(raw: dict) -> Question:
    question_type = raw["questionType"]
    content = raw[question_type]
    question_text = convert_html_to_plain_text(content.get("question", ""))

    if question_type == "integerQuestion":
        stem, options = question_text, {}
        options_parsed_cleanly = True
    else:
        stem, options = split_stem_and_options(question_text)
        options_parsed_cleanly = list(options) == list(OPTION_LETTERS)

    return Question(
        question_id=raw["_id"],
        question_type=question_type,
        subject=raw.get("subject") or "",
        chapter=raw.get("chapter") or "",
        updated_at=raw.get("updatedAt") or "",
        error_history=raw.get("errorHistory") or [],
        raw_question_html=content.get("question") or "",
        raw_solution_html=content.get("solution") or "",
        answer=content.get("answer"),
        stem_text=stem,
        options=options,
        solution_text=convert_html_to_plain_text(content.get("solution", "")),
        options_parsed_cleanly=options_parsed_cleanly,
        image_count=len(content.get("quesImages") or []) + len(content.get("solutionImages") or []),
    )


def build_report(raw: dict) -> Report:
    return Report(
        report_id=raw["reportId"],
        question_id=raw["questionId"],
        student_id=raw.get("studentId") or "",
        source=raw.get("source") or "",
        reported_at=raw.get("reportedAt") or "",
        comment=raw.get("comment") or "",
    )


def load_questions_with_reports(data_dir: Path = DATA_DIR) -> dict[str, Question]:
    questions = {raw["_id"]: build_question(raw) for raw in load_json_file(data_dir / "questions.json")}
    for raw_report in load_json_file(data_dir / "reports.json"):
        report = build_report(raw_report)
        if report.question_id not in questions:
            raise ValueError(f"Report {report.report_id} points to unknown question {report.question_id}.")
        questions[report.question_id].reports.append(report)
    return questions


def load_taxonomy(data_dir: Path = DATA_DIR) -> dict:
    return load_json_file(data_dir / "taxonomy.json")
