import json

from parse import PROJECT_DIR, load_json_file


def main() -> None:
    results = {entry["reportId"]: entry for entry in load_json_file(PROJECT_DIR / "results.json")}
    expected = {entry["reportId"]: entry for entry in load_json_file(PROJECT_DIR / "engine" / "expected.json")["reports"]}

    scores = {"verdict": 0, "repair": 0, "route": 0}
    differences = []
    unsafe = []
    for report_id, want in sorted(expected.items()):
        got = results[report_id]
        for field in scores:
            scores[field] += got[field] == want[field]
        if any(got[field] != want[field] for field in scores):
            differences.append(f"{report_id}: got {got['verdict']}/{got['repair']}/{got['route']}, "
                               f"want {want['verdict']}/{want['repair']}/{want['route']}")
        # The most harmful mistake: a fix goes live that a teacher should have seen, or that was never needed.
        if got["route"] == "auto_apply" and want["route"] != "auto_apply":
            unsafe.append(report_id)

    total = len(expected)
    print(" | ".join(f"{field}: {count}/{total}" for field, count in scores.items()))
    print(f"Unsafe auto-fixes: {len(unsafe)} {unsafe}")
    for line in differences:
        print("  " + line)


if __name__ == "__main__":
    main()
