import argparse
from pathlib import Path

from parse import PROJECT_DIR, load_json_file

SCORED_FIELDS = ("verdict", "repair", "route")


def accepts(expected_value: str | list | None, got_value: str | None) -> bool:
    """An expected value can be a list when more than one answer is defensible."""
    return got_value in expected_value if isinstance(expected_value, list) else got_value == expected_value


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare results.json with hand-written expected verdicts.")
    parser.add_argument("--results", type=Path, default=PROJECT_DIR / "results.json")
    parser.add_argument("--expected", type=Path, default=PROJECT_DIR / "engine" / "expected.json")
    args = parser.parse_args()

    results = {entry["reportId"]: entry for entry in load_json_file(args.results)}
    expected = {entry["reportId"]: entry for entry in load_json_file(args.expected)["reports"]}

    scores = dict.fromkeys(SCORED_FIELDS, 0)
    differences = []
    unsafe = []
    for report_id, want in sorted(expected.items()):
        got = results[report_id]
        matched = {field: accepts(want[field], got[field]) for field in SCORED_FIELDS}
        for field, ok in matched.items():
            scores[field] += ok
        if not all(matched.values()):
            differences.append(f"{report_id}: got {got['verdict']}/{got['repair']}/{got['route']}, "
                               f"want {want['verdict']}/{want['repair']}/{want['route']}")
        # The most harmful mistake: a fix goes live that a teacher should have seen, or that was never needed.
        if got["route"] == "auto_apply" and not accepts(want["route"], "auto_apply"):
            unsafe.append(report_id)

    total = len(expected)
    print(" | ".join(f"{field}: {count}/{total}" for field, count in scores.items()))
    print(f"Unsafe auto-fixes: {len(unsafe)} {unsafe}")
    for line in differences:
        print("  " + line)


if __name__ == "__main__":
    main()
