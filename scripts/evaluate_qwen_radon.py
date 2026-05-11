"""
evaluate_qwen_radon.py
────────────────────────────────────────────────────────────────────────────
Evaluation using BambusControl dataset + radon for real complexity measurement.

USAGE:
    python scripts/evaluate_qwen_radon.py
    python scripts/evaluate_qwen_radon.py --limit 50
"""

import json, os, re, sys, argparse, requests
from datetime import datetime
from radon.complexity import cc_visit

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=50)
parser.add_argument("--task",  type=str, default=None)
args = parser.parse_args()

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE     = os.path.join(BASE_DIR, "evidence")
RESULTS_PATH = os.path.join(EVIDENCE, "results_radon.json")

QWEN_URL   = os.environ.get("QWEN_URL",   "http://localhost:11434")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen2.5-coder:7b")

SYSTEM_PROMPT = """You are an expert software engineer specializing in algorithmic optimization.

Your task is to optimize the given Python function for better time complexity (Big-O).

Rules:
1. Return ONLY the complete optimized Python function — no explanations, no markdown.
2. Preserve the EXACT function signature — same name, same parameters, same return type.
3. The optimized function must produce identical outputs for all inputs.
4. Aim for the best possible Big-O improvement using built-in data structures (set, dict).
5. Do NOT wrap output in ```python``` or any markdown code fences.
6. Include necessary imports at the top if needed."""


def measure_complexity(code):
    try:
        code = code.replace("\\n", "\n").replace("\\t", "\t")
        results = cc_visit(code)
        if not results:
            return 1
        return sum(r.complexity for r in results)
    except Exception:
        return 1


def complexity_to_bigo(score):
    if score <= 1:  return "O(1)"
    if score <= 2:  return "O(log n)"
    if score <= 5:  return "O(n)"
    if score <= 10: return "O(n log n)"
    if score <= 20: return "O(n^2)"
    if score <= 50: return "O(n^3)"
    return "O(2^n)"


def call_qwen(code):
    code = code.replace("\\n", "\n").replace("\\t", "\t")
    resp = requests.post(
        f"{QWEN_URL}/api/chat",
        json={
            "model": QWEN_MODEL,
            "stream": False,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Optimize this Python function:\n\n{code.strip()}"},
            ],
            "options": {"temperature": 0.1, "num_predict": 1024},
        },
        timeout=120,
    )
    resp.raise_for_status()
    result = resp.json()["message"]["content"].strip()
    result = re.sub(r"^```python\s*", "", result, flags=re.IGNORECASE)
    result = re.sub(r"^```\s*", "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s*```$", "", result)
    return result.strip()


def verify_correctness(optimized_code, assertions, entry_point):
    try:
        code = optimized_code.replace("\\n", "\n").replace("\\t", "\t")
        ns = {}
        exec(code, ns)
        if entry_point not in ns:
            return False
        ns["candidate"] = ns[entry_point]
        for assertion in assertions:
            exec(assertion, ns)
        return True
    except Exception:
        return False


def load_tasks(limit):
    print("  Loading BambusControl dataset...")
    from datasets import load_dataset
    ds = load_dataset(
        "BambusControl/AI-Code-Optimization-for-Sustainability-Dataset",
        split="train"
    )

    good = [
        r for r in ds
        if r["input.origin"] in ["humaneval", "mbpp"]
        and r["analysis_before.runtime.test.status"] == "passed"
        and r["analysis_before.static.radon.complexity.total"] is not None
        and r["analysis_before.runtime.energy.profiling.total_uj"] is not None
        and r["input.code"]
        and r["input.test.assertions"]
        and r["analysis_before.static.radon.complexity.total"] > 3
        and r["analysis_before.static.radon.complexity.total"] <= 8
    ]

    print(f"  Found {len(good)} tasks with complexity > 2 — using first {limit}")

    seen = set()
    unique = []
    for r in good:
        key = f"{r['input.origin']}/{r['input.name']}"
        if key not in seen:
            seen.add(key)
            unique.append(r)
        if len(unique) >= limit:
            break

    tasks = []
    for r in unique:
        code = r["input.code"].replace("\\n", "\n").replace("\\t", "\t")
        fn_match = re.search(r"def\s+(\w+)\s*\(", code)
        entry_point = fn_match.group(1) if fn_match else ""

        raw = r["input.test.assertions"]
        if isinstance(raw, str):
            try:
                assertions = json.loads(raw)
            except Exception:
                assertions = [raw]
        else:
            assertions = list(raw)

        tasks.append({
            "taskId":        f"{r['input.origin']}/{r['input.name']}",
            "dataset":       r["input.origin"],
            "entryPoint":    entry_point,
            "code":          code,
            "assertions":    assertions,
            "radonBefore":   r["analysis_before.static.radon.complexity.total"],
            "energyBeforeUj": r["analysis_before.runtime.energy.profiling.total_uj"],
        })

    return tasks


def evaluate_task(task):
    tid          = task["taskId"]
    ep           = task["entryPoint"]
    radon_before = task["radonBefore"]
    bigo_before  = complexity_to_bigo(radon_before)

    print(f"\n[{tid}] {ep}()  radon={radon_before} ({bigo_before})")
    print(f"  -> Calling Qwen (zero-shot)...")

    optimized   = ""
    correct     = False
    radon_after = radon_before
    bigo_after  = bigo_before
    error       = None

    try:
        optimized = call_qwen(task["code"])
        print(f"  -> Verifying correctness...")
        correct = verify_correctness(optimized, task["assertions"], ep)
        radon_after = measure_complexity(optimized)
        bigo_after  = complexity_to_bigo(radon_after)
        print(f"  -> {'CORRECT' if correct else 'INCORRECT'} "
              f"| radon {radon_before}->{radon_after} | {bigo_before}->{bigo_after}")
    except Exception as e:
        error = str(e)
        print(f"  -> Error: {error}")

    complexity_improved = correct and (radon_after < radon_before)

    if complexity_improved and radon_before > 0:
        reduction_ratio = (radon_before - radon_after) / radon_before
        energy_reduction_pct = round(min(reduction_ratio * 100, 99), 1)
    else:
        energy_reduction_pct = 0.0

    energy_before = task["energyBeforeUj"]
    energy_after  = energy_before * (1 - energy_reduction_pct / 100)

    if complexity_improved:
        print(f"  -> Improved! radon {radon_before}->{radon_after}, energy -{energy_reduction_pct}%")
    elif correct:
        print(f"  -> Correct, complexity unchanged")
    else:
        print(f"  -> Incorrect")

    return {
        "taskId":             tid,
        "dataset":            task["dataset"],
        "entryPoint":         ep,
        "correct":            correct,
        "radonBefore":        radon_before,
        "radonAfter":         radon_after,
        "bigoBefore":         bigo_before,
        "bigoAfter":          bigo_after,
        "complexityImproved": complexity_improved,
        "radonReduction":     radon_before - radon_after,
        "energyBeforeUj":     energy_before,
        "energyAfterUj":      energy_after,
        "energyReductionPct": energy_reduction_pct,
        "evaluatedAt":        datetime.now().isoformat(),
        "error":              error,
    }


def main():
    print("=" * 62)
    print("  SustainaDev x Qwen 2.5 Coder 7B — Zero-Shot Evaluation")
    print("  Complexity: measured by Radon (same tool as dataset)")
    print("=" * 62)
    print(f"  Model  : {QWEN_MODEL}")
    print(f"  Mode   : ZERO-SHOT (no fine-tuning, no examples)")
    print(f"  Dataset: BambusControl (HumanEval + MBPP)")
    print(f"  Limit  : {args.limit} tasks")
    print("=" * 62)

    tasks = load_tasks(args.limit)

    if args.task:
        tasks = [t for t in tasks if t["taskId"] == args.task]

    he_n   = sum(1 for t in tasks if t["dataset"] == "humaneval")
    mbpp_n = sum(1 for t in tasks if t["dataset"] == "mbpp")
    print(f"\n  Tasks  : {len(tasks)} ({he_n} HumanEval + {mbpp_n} MBPP)\n")

    existing = []
    if os.path.exists(RESULTS_PATH):
        try:
            with open(RESULTS_PATH, encoding="utf-8") as f:
                existing = json.load(f)
            done = {r["taskId"] for r in existing}
            remaining = [t for t in tasks if t["taskId"] not in done]
            if len(remaining) < len(tasks):
                print(f"  Resuming: {len(existing)} done, {len(remaining)} remaining.\n")
            tasks = remaining
        except Exception:
            existing = []

    results = list(existing)

    for task in tasks:
        result = evaluate_task(task)
        results.append(result)
        os.makedirs(EVIDENCE, exist_ok=True)
        with open(RESULTS_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

    correct_n  = sum(1 for r in results if r["correct"])
    improved_n = sum(1 for r in results if r["complexityImproved"])
    total      = len(results)

    print("\n" + "=" * 62)
    print(f"  Done. Saved to: evidence/results_radon.json")
    print(f"  Correct             : {correct_n}/{total} ({round(correct_n/total*100,1)}%)")
    print(f"  Complexity improved : {improved_n}/{total} ({round(improved_n/total*100,1)}%)")
    print("=" * 62)
    print("\n  Run next: python scripts/aggregate_radon.py")


if __name__ == "__main__":
    main()