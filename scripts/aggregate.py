"""
aggregate.py
Reads evidence/results_py.json and computes all proof metrics.

USAGE:
    python scripts/aggregate.py
"""

import json
import os
from datetime import datetime

BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_PATH  = os.path.join(BASE_DIR, "evidence", "results_py.json")
SUMMARY_PATH  = os.path.join(BASE_DIR, "evidence", "summary_py.json")

def mean(values):
    return round(sum(values) / len(values), 2) if values else 0

def pct(n, total):
    return round(n / total * 100, 2) if total else 0

def main():
    if not os.path.exists(RESULTS_PATH):
        print("❌  evidence/results_py.json not found. Run evaluate_qwen.py first.")
        return

    with open(RESULTS_PATH, encoding="utf-8") as f:
        results = json.load(f)

    total     = len(results)
    correct   = [r for r in results if r["correct"]]
    improved  = [r for r in results if r["complexityImproved"]]
    success   = [r for r in results if r["correct"] and r["complexityImproved"]]
    failed    = [r for r in results if not r["correct"]]

    summary = {
        "totalTasks":                   total,
        "correctCount":                 len(correct),
        "correctnessRate":              pct(len(correct), total),
        "complexityImprovedCount":      len(improved),
        "complexityImprovementRate":    pct(len(improved), total),
        "successCount":                 len(success),
        "successRate":                  pct(len(success), total),
        "avgSpeedImprovement":          mean([r["speedImprovement"] for r in results]),
        "avgEnergyReduction":           mean([r["energyReduction"] for r in results]),
        "avgCarbonReduction":           mean([r["carbonReduction"] for r in results]),
        "avgSpeedCorrectOnly":          mean([r["speedImprovement"] for r in correct]),
        "generatedAt":                  datetime.now().isoformat(),
    }

    with open(SUMMARY_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    # Complexity transitions
    transitions: dict = {}
    for r in improved:
        key = f"{r['originalComplexity']} → {r['optimizedComplexity']}"
        transitions[key] = transitions.get(key, 0) + 1

    # By dataset
    def ds_stats(ds):
        sub = [r for r in results if r["dataset"] == ds]
        return {
            "total":    len(sub),
            "correct":  sum(1 for r in sub if r["correct"]),
            "improved": sum(1 for r in sub if r["complexityImproved"]),
        }

    he   = ds_stats("HumanEval")
    mbpp = ds_stats("MBPP")

    bar = "═" * 62
    print(f"\n{bar}")
    print(" SUSTAINADEV × QWEN 2.5 CODER 7B — AGGREGATED PROOF METRICS")
    print(f" Experiment: ZERO-SHOT | Real HumanEval + MBPP datasets")
    print(f"{bar}\n")

    print(" ┌───────────────────────────────────────────────────────┐")
    print(" │                  HEADLINE NUMBERS                    │")
    print(" ├───────────────────────────────────────────────────────┤")
    print(f" │  Total tasks evaluated        : {total:3}                  │")
    print(f" │  Correct output preserved     : {len(correct):3} / {total}              │")
    print(f" │  Correctness rate             : {summary['correctnessRate']:5}%              │")
    print(f" │  Complexity improved          : {len(improved):3} / {total}              │")
    print(f" │  Complexity improvement rate  : {summary['complexityImprovementRate']:5}%              │")
    print(f" │  Full success (correct + ↓O)  : {len(success):3} / {total}  ← KEY METRIC │")
    print(f" │  Success rate                 : {summary['successRate']:5}%              │")
    print(" └───────────────────────────────────────────────────────┘\n")

    print(" AVERAGE IMPROVEMENTS (all tasks):")
    print(f"   Speed  : +{summary['avgSpeedImprovement']}%")
    print(f"   Energy : -{summary['avgEnergyReduction']}%")
    print(f"   Carbon : -{summary['avgCarbonReduction']}%")
    print(f"\n   Speed on correct tasks only: +{summary['avgSpeedCorrectOnly']}%\n")

    print(" BY DATASET:")
    print(f"   HumanEval : {he['correct']}/{he['total']} correct, {he['improved']}/{he['total']} improved")
    print(f"   MBPP      : {mbpp['correct']}/{mbpp['total']} correct, {mbpp['improved']}/{mbpp['total']} improved\n")

    if transitions:
        print(" COMPLEXITY TRANSITIONS (zero-shot improvements):")
        for key, count in sorted(transitions.items(), key=lambda x: -x[1]):
            bar2 = "█" * count
            print(f"   {key:<28} {bar2} {count}")
        print("")

    if failed:
        print(f" FAILED TASKS ({len(failed)}):")
        for r in failed:
            err = f" — {r['error'][:50]}" if r.get("error") else ""
            print(f"   {r['taskId']}: {r['taskDescription'][:50]}{err}")
        print("")

    print(f" Saved to: evidence/summary_py.json")
    print(f" Run next: python scripts/generate_report.py")
    print(f"{bar}\n")

if __name__ == "__main__":
    main()