import argparse
import json
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

from ai import OPUS, SONNET, TAXONOMY, CallUsage, JudgeResult, ReportJudgment, SolverResult, judge_question, load_env_file, solve_question
from checks import Finding, run_all_checks
from guards import Decision, decide_routes_for_question
from parse import DATA_DIR, PROJECT_DIR, Question, load_questions_with_reports
from vote import Vote, build_vote, solvers_need_tiebreak

PARALLEL_QUESTIONS = 6
# How much harm a defect does to every student who meets it. Drives the faculty queue order.
HARM_BY_REPAIR = {
    "answer_key": 10, "unsound": 9, "type_mismatch": 8, "stem_data": 8, "option_repair": 7, "wrong_question": 7,
    "solution_fix": 6, "solution_missing": 6, "diagram": 6, "identical_options": 5, "notation": 4,
    "answer_form": 3, "markup_leak": 3, "wrong_chapter": 2, "syllabus": 2, "spelling": 1, "noise": 1, "exam_reference": 1,
}


def process_question(question: Question) -> tuple[dict, list[dict], list[CallUsage]]:
    findings = run_all_checks(question)
    solved = [solve_question(question, model) for model in (SONNET, OPUS)]
    if solvers_need_tiebreak([result for result, _ in solved], question.question_type):
        solved.append(solve_question(question, OPUS, effort="xhigh", step="tiebreak"))
    solver_results = [result for result, _ in solved]

    judgment, judge_usage = judge_question(question, findings, solver_results)
    vote = build_vote(question, solver_results, judgment.solution_answer, judgment.solution_fits_question)
    judged = {item.report_id: item for item in judgment.reports}
    missing = [report.report_id for report in question.reports if report.report_id not in judged]
    if missing:
        raise RuntimeError(f"The judge skipped reports {missing} on question {question.question_id}.")

    judgments = [judged[report.report_id] for report in question.reports]
    decisions, edited = decide_routes_for_question(question, judgments, vote, findings)
    results = [build_result_entry(question, judged[decision.report_id], decision) for decision in decisions]
    case = build_case(question, findings, solver_results, vote, judgment, decisions, edited)
    return case, results, [usage for _, usage in solved] + [judge_usage]


def format_edits_for_results(decision: Decision) -> dict | list[dict] | None:
    edits = [edit.model_dump() for edit in decision.edits]
    if not edits:
        return None
    return edits[0] if len(edits) == 1 else edits


def build_result_entry(question: Question, judgment: ReportJudgment, decision: Decision) -> dict:
    return {
        "reportId": decision.report_id,
        "questionId": question.question_id,
        "verdict": judgment.verdict,
        "repair": None if judgment.repair == "none" else judgment.repair,
        "edit": format_edits_for_results(decision),
        "route": decision.route,
        "confidence": round(decision.confidence, 2),
        "evidence": judgment.evidence,
        "student_reply": decision.reply,
    }


def calculate_urgency(decisions: list[Decision], judgments: list[ReportJudgment], report_count: int) -> float:
    harm = max((HARM_BY_REPAIR.get(judgment.repair, 0) for judgment in judgments if judgment.verdict == "defect"), default=0)
    lowest_confidence = min((decision.confidence for decision in decisions), default=1.0)
    return round(harm * (1 + report_count) + 10 * (1 - lowest_confidence), 1)


def build_case(question: Question, findings: list[Finding], solver_results: list[SolverResult], vote: Vote,
               judgment: JudgeResult, decisions: list[Decision], edited: Question) -> dict:
    judged = {item.report_id: item for item in judgment.reports}
    reports = []
    for report, decision in zip(question.reports, decisions):
        item = judged[report.report_id]
        reports.append({
            **asdict(report),
            "student_claim": item.student_claim,
            "claim_supported": item.claim_supported,
            "verdict": item.verdict,
            "repair": None if item.repair == "none" else item.repair,
            "evidence": item.evidence,
            "edits": [edit.model_dump() for edit in item.edits],
            "route": decision.route,
            "route_reason": decision.reason,
            "confidence": round(decision.confidence, 2),
            "reply": decision.reply,
            "reply_final": item.reply_final,
            "reply_pending": item.reply_pending,
        })
    return {
        "questionId": question.question_id,
        "subject": question.subject,
        "chapter": question.chapter,
        "questionType": question.question_type,
        "before": {"question_html": question.raw_question_html, "solution_html": question.raw_solution_html,
                   "answer": question.answer, "questionType": question.question_type},
        "after": {"question_html": edited.raw_question_html, "solution_html": edited.raw_solution_html,
                  "answer": edited.answer, "questionType": edited.question_type},
        "findings": [asdict(finding) for finding in findings],
        "solvers": [result.model_dump() for result in solver_results],
        "vote": asdict(vote),
        "solution_answer": judgment.solution_answer,
        "solution_fits_question": judgment.solution_fits_question,
        "reports": reports,
        "other_defects": [defect.model_dump() for defect in judgment.other_defects],
        "urgency": calculate_urgency(decisions, [judged[r.report_id] for r in question.reports], len(question.reports)),
    }


def check_results_before_saving(results: list[dict], questions: dict[str, Question]) -> None:
    expected_ids = sorted(report.report_id for question in questions.values() for report in question.reports)
    found_ids = sorted(entry["reportId"] for entry in results)
    if found_ids != expected_ids:
        raise RuntimeError(f"results.json must have each report exactly once. Missing or extra: {set(expected_ids) ^ set(found_ids)}")
    for entry in results:
        if entry["verdict"] not in TAXONOMY["verdicts"] or entry["route"] not in ("auto_apply", "faculty_review", "no_change"):
            raise RuntimeError(f"Invalid verdict or route in {entry['reportId']}.")
        if entry["repair"] is not None and entry["repair"] not in TAXONOMY["repairs"]:
            raise RuntimeError(f"Invalid repair in {entry['reportId']}.")


def summarize_cost(usages: list[CallUsage]) -> dict:
    by_step: dict[str, dict] = defaultdict(lambda: {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0})
    by_model: dict[str, dict] = defaultdict(lambda: {"calls": 0, "cost_usd": 0.0})
    for usage in usages:
        step = by_step[usage.step]
        step["calls"] += 1
        step["input_tokens"] += usage.input_tokens
        step["output_tokens"] += usage.output_tokens
        step["cost_usd"] += usage.cost_usd
        by_model[usage.model]["calls"] += 1
        by_model[usage.model]["cost_usd"] += usage.cost_usd
    for group in (*by_step.values(), *by_model.values()):
        group["cost_usd"] = round(group["cost_usd"], 4)
    return {
        "total_calls": len(usages),
        "calls_served_from_cache": sum(usage.from_cache for usage in usages),
        "full_run_cost_usd": round(sum(usage.cost_usd for usage in usages), 4),
        "this_run_cost_usd": round(sum(usage.cost_usd for usage in usages if not usage.from_cache), 4),
        "by_step": dict(by_step),
        "by_model": dict(by_model),
    }


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Triage student error reports into safe fixes.")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR, help="folder with questions.json and reports.json")
    parser.add_argument("--out-dir", type=Path, default=PROJECT_DIR, help="folder for results.json, cases.json and cost.json")
    args = parser.parse_args()

    load_env_file()
    started = time.perf_counter()
    questions = load_questions_with_reports(args.data_dir)
    with ThreadPoolExecutor(PARALLEL_QUESTIONS) as pool:
        processed = list(pool.map(process_question, questions.values()))

    cases = sorted((case for case, _, _ in processed), key=lambda case: -case["urgency"])
    results = sorted((entry for _, entries, _ in processed for entry in entries), key=lambda entry: entry["reportId"])
    usages = [usage for _, _, question_usages in processed for usage in question_usages]
    check_results_before_saving(results, questions)

    cost = summarize_cost(usages)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.out_dir / "results.json", results)
    write_json(args.out_dir / "cases.json", cases)
    write_json(args.out_dir / "cost.json", cost)

    routes = defaultdict(int)
    for entry in results:
        routes[entry["route"]] += 1
    print(f"Wrote {len(results)} results and {len(cases)} cases. Routes: {dict(routes)}")
    print(f"Cost of a full run: ${cost['full_run_cost_usd']}. This run: ${cost['this_run_cost_usd']} "
          f"({cost['calls_served_from_cache']} of {cost['total_calls']} calls from cache). Took {time.perf_counter() - started:.1f}s.")


if __name__ == "__main__":
    main()
