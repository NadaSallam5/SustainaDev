# metrics/evaluate_marv.py
import os, json, random, time, re
from difflib import SequenceMatcher
from openai import OpenAI
import javalang

MODEL = "gpt-4o"
SAMPLES = 5
REF_TYPE = "Extract Method"

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "testdata", "MaRV.json")
REPORT_PATH = os.path.join(os.path.dirname(__file__), "marv_report.json")

def load_marv():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)[REF_TYPE]

def strip_markdown(code):
    return re.sub(r"```[a-zA-Z]*|```", "", code).strip()

def normalize_java(code):
    code = strip_markdown(code)
    code = re.sub(r"/\*[\s\S]*?\*/", " ", code)
    code = re.sub(r"//.*", " ", code)
    code = re.sub(r"\s+", " ", code)
    return code.strip()

def tokenize_java(code):
    return re.findall(r"[A-Za-z_]\w*|[{}();,\.]", code)

def token_similarity(a, b):
    ta, tb = tokenize_java(a), tokenize_java(b)
    if not ta or not tb: return 0.0
    return SequenceMatcher(None, ta, tb).ratio()

# ✅ improved structural similarity
def structural_similarity(a, b):
    try:
        tree1 = javalang.parse.parse(a)
        tree2 = javalang.parse.parse(b)
    except Exception:
        return None  # parsing failed

    def extract_methods(tree):
        methods = []
        for _, node in tree:
            if isinstance(node, javalang.tree.MethodDeclaration):
                methods.append({
                    "name": node.name,
                    "params": len(node.parameters or []),
                    "stmts": len(getattr(node.body, "statements", []) or []),
                })
        return methods

    m1, m2 = extract_methods(tree1), extract_methods(tree2)
    if not m1 or not m2:
        return 0.0

    total = 0
    matches = 0
    for m_a in m1:
        best = 0
        for m_b in m2:
            name_sim = 1.0 if m_a["name"] == m_b["name"] else 0.0
            param_sim = 1 - abs(m_a["params"] - m_b["params"]) / max(m_a["params"], m_b["params"], 1)
            stmt_sim = 1 - abs(m_a["stmts"] - m_b["stmts"]) / max(m_a["stmts"], m_b["stmts"], 1)
            sim = 0.4 * name_sim + 0.3 * param_sim + 0.3 * stmt_sim
            best = max(best, sim)
        total += best
        matches += 1
    return total / matches

def hybrid_similarity(a, b, alpha=0.6):
    a, b = normalize_java(a), normalize_java(b)
    token_sim = token_similarity(a, b)
    struct_sim = structural_similarity(a, b)
    if struct_sim is None or struct_sim == 0.0:
        struct_sim = token_sim * 0.9  # smoother fallback
    return alpha * token_sim + (1 - alpha) * struct_sim, token_sim, struct_sim

def main():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Set OPENAI_API_KEY")
    client = OpenAI(api_key=key)

    data = load_marv()
    random.shuffle(data)
    data = data[:SAMPLES]

    # ✅ FEW-SHOT EXAMPLES SECTION
    FEWSHOT = """Example 1 (Extract Method)
Before:
public class Sample {
    void compute() {
        int total = 0;
        for (int i = 0; i < 5; i++) {
            total += i;
        }
        System.out.println(total);
    }
}

After:
public class Sample {
    void compute() {
        int total = sumLoop();
        System.out.println(total);
    }

    private int sumLoop() {
        int total = 0;
        for (int i = 0; i < 5; i++) {
            total += i;
        }
        return total;
    }
}

Example 2 (Rename Method)
Before:
public class Example {
    void startProcess() {
        System.out.println("Processing...");
    }
}

After:
public class Example {
    void runProcess() {
        System.out.println("Processing...");
    }
}
"""

    scores, results = [], []
    for i, ex in enumerate(data, 1):
        before, after = ex["code_before"], ex["code_after"]
        prompt = f"""{FEWSHOT}

Now refactor this Java code using {REF_TYPE}.
Keep behavior identical and follow the same refactoring style.

Code:
{before}
"""

        print(f"[{i}/{SAMPLES}] Sending to GPT...")
        response = client.chat.completions.create(
            model=MODEL,
            temperature=0,
            top_p=1,
            messages=[{"role": "user", "content": prompt}]
        )
        gpt_code = response.choices[0].message.content

        score, token_sim, struct_sim = hybrid_similarity(gpt_code, after, alpha=0.6)
        scores.append(score)
        print(f"→ Example {i}: total={score:.2f}, token={token_sim:.2f}, struct={struct_sim:.2f}")

        results.append({
            "index": i,
            "total": round(score,3),
            "token": round(token_sim,3),
            "struct": round(struct_sim,3),
        })
        time.sleep(0.5)

    avg = sum(scores)/len(scores)
    with open(REPORT_PATH,"w",encoding="utf-8") as f:
        json.dump({"average_similarity":avg,"results":results},f,indent=2)
    print(f"\n✅ Done. Average similarity {avg:.2f}")

if __name__ == "__main__":
    main()
