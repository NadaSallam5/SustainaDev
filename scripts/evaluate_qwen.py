"""
evaluate_qwen.py
────────────────────────────────────────────────────────────────────────────
Evaluation loop: runs real HumanEval + MBPP tasks through Qwen (zero-shot).

USAGE:
    python scripts/evaluate_qwen.py
    python scripts/evaluate_qwen.py --limit 10
    python scripts/evaluate_qwen.py --task HumanEval/0
"""

import json, os, re, sys, argparse, requests
from datetime import datetime

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int, default=None)
parser.add_argument("--task",  type=str, default=None)
args = parser.parse_args()

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE     = os.path.join(BASE_DIR, "evidence")
HE_PATH      = os.path.join(EVIDENCE, "humaneval_raw.json")
MBPP_PATH    = os.path.join(EVIDENCE, "mbpp_raw.json")
RESULTS_PATH = os.path.join(EVIDENCE, "results_py.json")

QWEN_URL   = os.environ.get("QWEN_URL",   "http://localhost:11434")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen2.5-coder:7b")

# ─── Zero-Shot Prompt ──────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert software engineer specializing in algorithmic optimization.

Your task is to optimize the given Python function for better time complexity (Big-O).

Rules:
1. Return ONLY the complete optimized Python function — no explanations, no markdown.
2. Preserve the EXACT function signature — same name, same parameters.
3. The optimized function must produce identical outputs for all inputs.
4. Aim for the best possible Big-O improvement using built-in data structures (set, dict).
5. Do NOT wrap output in ```python``` or any markdown code fences."""

# ─── Complexity Ordering ───────────────────────────────────────────────────
COMPLEXITY_RANK = {
    "O(1)": 0, "O(log n)": 1, "O(n)": 2, "O(n log n)": 3,
    "O(n²)": 4, "O(n³)": 5, "O(2^n)": 6, "unknown": 99,
}
ENERGY_FACTOR = {
    "O(1)": 1, "O(log n)": 10, "O(n)": 1_000,
    "O(n log n)": 10_000, "O(n²)": 1_000_000,
    "O(n³)": 1_000_000_000, "O(2^n)": 2**30, "unknown": 1_000,
}
CARBON_INTENSITY = 0.475

# ─── Selected Tasks (25 HumanEval + 25 MBPP = 50 total) ───────────────────
HUMANEVAL_SELECTED = [
    0,   # has_close_elements — O(n²)
    14,  # all_prefixes
    20,  # find_closest_elements — O(n²)
    28,  # concatenate strings
    31,  # is_prime
    32,  # poly / find_zero
    33,  # sort_third
    42,  # incr_list
    44,  # change_base
    48,  # is_palindrome
    53,  # add
    55,  # fib — O(2^n)
    60,  # sum_to_n
    62,  # derivative
    65,  # circular_shift
    69,  # search — O(n²)
    72,  # will_it_fly
    76,  # is_simple_power
    83,  # starts_one_ends
    100, # make_a_pile
    106, # f
    108, # count_nums
    111, # histogram
    112, # reverse_delete
    114, # minSubArraySum
]

MBPP_SELECTED = [
    2,   # find similar elements
    3,   # remove duplicates
    7,   # count occurrences
    11,  # remove first/last occurrence
    22,  # first duplicate
    56,  # check one less than power
    57,  # largest number from digits
    61,  # count substrings
    62,  # find smallest in list
    63,  # max difference
    96,  # divisor count
    230, # replace blank spaces
    240, # replace last element
    246, # babylonian sqrt
    280, # search element
    290, # find list with max length
    404, # minimum of two numbers
    417, # common first element
    474, # replace characters
    22,  # first duplicate (kept as reference)
    57,  # largest number
    96,  # divisor count
    280, # search element
    290, # max length list
    474, # replace characters
]

# ─── Complexity Detector ───────────────────────────────────────────────────
def detect_complexity(code: str) -> str:
    lines = code.split("\n")
    non_empty = [l for l in lines if l.strip()]
    if non_empty:
        base_indent = min(len(l) - len(l.lstrip()) for l in non_empty)
        lines = [l[base_indent:] if len(l) >= base_indent else l for l in lines]
    code_normalized = "\n".join(lines)

    has_recursion = False
    has_dict_set  = False
    has_divide    = False
    func_name     = ""

    fn_match = re.search(r"^def\s+(\w+)\s*\(", code_normalized, re.MULTILINE)
    if fn_match:
        func_name = fn_match.group(1)

    max_loop_depth = 0
    loop_stack: list = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())

        while loop_stack and indent <= loop_stack[-1]:
            loop_stack.pop()

        if re.match(r"(for|while)\s+", stripped):
            loop_stack.append(indent)
            max_loop_depth = max(max_loop_depth, len(loop_stack))

        if func_name and not stripped.startswith("def "):
            if re.search(rf"\b{re.escape(func_name)}\s*\(", stripped):
                has_recursion = True

        if re.search(
            r"\bdict\(\)|\bset\(\)|\bset\b\s*\(|"
            r"\.get\s*\(|\.add\s*\(|\.setdefault\s*\(|"
            r"\bdefaultdict\b|\bCounter\b|\bOrderedDict\b|"
            r"\{\s*\}|\{[^}:]+\}",
            stripped
        ):
            has_dict_set = True

        if re.search(r"//\s*2\b|>>\s*1\b|\bmid\s*=|\bmiddle\s*=", stripped):
            has_divide = True

    if has_recursion and not has_dict_set:
        return "O(n log n)" if has_divide else "O(2^n)"

    if max_loop_depth >= 3: return "O(n³)"
    if max_loop_depth == 2: return "O(n²)"
    if max_loop_depth == 1:
        if has_divide:   return "O(log n)"
        if has_dict_set: return "O(n)"
        return "O(n)"
    if has_dict_set: return "O(n)"
    return "O(1)"

# ─── Qwen Call ────────────────────────────────────────────────────────────
def call_qwen(code: str) -> str:
    resp = requests.post(
        f"{QWEN_URL}/api/chat",
        json={
            "model":  QWEN_MODEL,
            "stream": False,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",
                 "content": f"Optimize this Python function:\n\n{code.strip()}"},
            ],
            "options": {"temperature": 0.1, "num_predict": 1024},
        },
        timeout=120,
    )
    resp.raise_for_status()
    result = resp.json()["message"]["content"].strip()
    result = re.sub(r"^```python\s*", "", result, flags=re.IGNORECASE)
    result = re.sub(r"^```\s*",       "", result, flags=re.IGNORECASE)
    result = re.sub(r"\s*```$",       "", result)
    return result.strip()

# ─── Correctness Verification ─────────────────────────────────────────────
def verify_humaneval(optimized: str, prompt: str, test: str,
                     entry_point: str) -> bool:
    try:
        imports = "\n".join(
            l for l in prompt.split("\n")
            if l.startswith("import ") or l.startswith("from ")
        )
        full_code = imports + "\n" + optimized + "\n\n" + test + \
                    f"\ncheck({entry_point})"
        exec(full_code, {})
        return True
    except Exception:
        return False

def verify_mbpp(optimized: str, test_list: list) -> bool:
    try:
        ns: dict = {}
        exec(optimized, ns)
        for assertion in test_list:
            exec(assertion, ns)
        return True
    except Exception:
        return False

# ─── Energy/Carbon ────────────────────────────────────────────────────────
def estimate_reductions(orig: str, opt: str) -> dict:
    e_o = ENERGY_FACTOR.get(orig, 1_000)
    e_p = ENERGY_FACTOR.get(opt,  1_000)
    if e_p >= e_o:
        return {"speedImprovement": 0, "energyReduction": 0, "carbonReduction": 0}
    er = round((1 - e_p / e_o) * 100)
    return {
        "speedImprovement": min(er, 99),
        "energyReduction":  er,
        "carbonReduction":  round(er * CARBON_INTENSITY),
    }

# ─── Load & Build Tasks ───────────────────────────────────────────────────
def load_tasks():
    with open(HE_PATH,   encoding="utf-8") as f: humaneval = json.load(f)
    with open(MBPP_PATH, encoding="utf-8") as f: mbpp_data = json.load(f)

    tasks = []

    # HumanEval
    he_map = {i: row for i, row in enumerate(humaneval)}
    seen_he = set()
    for idx in HUMANEVAL_SELECTED:
        if idx not in he_map or idx in seen_he:
            continue
        seen_he.add(idx)
        row = he_map[idx]
        tasks.append({
            "taskId":      f"HumanEval/{idx}",
            "dataset":     "HumanEval",
            "description": row.get("prompt","")[:80].replace("\n"," ").strip(),
            "full_code":   row.get("prompt","") + row.get("canonical_solution",""),
            "prompt":      row.get("prompt",""),
            "test":        row.get("test",""),
            "test_list":   [],
            "entry_point": row.get("entry_point",""),
        })

    # MBPP
    mbpp_map = {int(r["task_id"]): r for r in mbpp_data if "task_id" in r}
    seen_mbpp = set()
    for idx in MBPP_SELECTED:
        if idx not in mbpp_map or idx in seen_mbpp:
            continue
        seen_mbpp.add(idx)
        row = mbpp_map[idx]
        fn_match = re.search(r"def\s+(\w+)\s*\(", row.get("code",""))
        tasks.append({
            "taskId":      f"MBPP/{idx}",
            "dataset":     "MBPP",
            "description": row.get("text","")[:80].strip(),
            "full_code":   row.get("code",""),
            "prompt":      row.get("text",""),
            "test":        "",
            "test_list":   row.get("test_list", []),
            "entry_point": fn_match.group(1) if fn_match else "",
        })

    return tasks

# ─── Evaluate One Task ────────────────────────────────────────────────────
def evaluate_task(task: dict) -> dict:
    tid = task["taskId"]
    print(f"\n[{tid}] {task['description'][:65]}")
    print(f"  → Calling Qwen (zero-shot)...")

    orig_complexity = detect_complexity(task["full_code"])
    optimized  = ""
    correct    = False
    opt_compl  = "unknown"
    error      = None

    try:
        optimized = call_qwen(task["full_code"])
        print(f"  → Verifying correctness...")

        if task["dataset"] == "HumanEval":
            correct = verify_humaneval(
                optimized, task["prompt"],
                task["test"], task["entry_point"]
            )
        else:
            correct = verify_mbpp(optimized, task["test_list"])

        opt_compl = detect_complexity(optimized)
        print(f"  → {'✅ CORRECT' if correct else '❌ INCORRECT'} "
              f"| {orig_complexity} → {opt_compl}")

    except Exception as e:
        error = str(e)
        print(f"  → ⚠️  Error: {error}")

    improved = (
        correct and
        COMPLEXITY_RANK.get(opt_compl, 99) < COMPLEXITY_RANK.get(orig_complexity, 99)
    )
    red = estimate_reductions(orig_complexity, opt_compl) if improved \
          else {"speedImprovement": 0, "energyReduction": 0, "carbonReduction": 0}

    if improved:
        print(f"  → 🟢 Improved: speed +{red['speedImprovement']}%, "
              f"energy -{red['energyReduction']}%, carbon -{red['carbonReduction']}%")
    else:
        print(f"  → 🔵 No complexity improvement")

    return {
        "taskId":              tid,
        "taskDescription":     task["description"],
        "dataset":             task["dataset"],
        "correct":             correct,
        "originalComplexity":  orig_complexity,
        "optimizedComplexity": opt_compl,
        "complexityImproved":  improved,
        "speedImprovement":    red["speedImprovement"],
        "energyReduction":     red["energyReduction"],
        "carbonReduction":     red["carbonReduction"],
        "evaluatedAt":         datetime.now().isoformat(),
        "error":               error,
    }

# ─── Main ─────────────────────────────────────────────────────────────────
def main():
    print("═" * 60)
    print("  SustainaDev × Qwen 2.5 Coder 7B — Zero-Shot Evaluation")
    print("═" * 60)
    print(f"  Model  : {QWEN_MODEL}")
    print(f"  API    : {QWEN_URL} (ollama)")
    print(f"  Mode   : ZERO-SHOT (no fine-tuning, no examples)")
    print(f"  Source : Real HumanEval + MBPP (Hugging Face)")
    print("═" * 60)

    tasks = load_tasks()

    if args.task:
        tasks = [t for t in tasks if t["taskId"] == args.task]
        if not tasks:
            print(f"Task {args.task} not found.")
            sys.exit(1)

    if args.limit:
        tasks = tasks[:args.limit]

    he_n   = sum(1 for t in tasks if t["dataset"] == "HumanEval")
    mbpp_n = sum(1 for t in tasks if t["dataset"] == "MBPP")
    print(f"\n  Tasks  : {len(tasks)} ({he_n} HumanEval + {mbpp_n} MBPP)\n")

    existing = []
    if os.path.exists(RESULTS_PATH):
        try:
            with open(RESULTS_PATH, encoding="utf-8") as f:
                existing = json.load(f)
            done = {r["taskId"] for r in existing}
            remaining = [t for t in tasks if t["taskId"] not in done]
            if len(remaining) < len(tasks):
                print(f"  ↩ Resuming: {len(existing)} done, "
                      f"{len(remaining)} remaining.\n")
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

    print("\n" + "═" * 60)
    print(f"  Done. Saved to: evidence/results_py.json")
    print(f"  Correct             : {correct_n}/{len(results)}")
    print(f"  Complexity improved : {improved_n}/{len(results)}")
    print("═" * 60)
    print("\n  Run next: python scripts/aggregate.py")

if __name__ == "__main__":
    main()