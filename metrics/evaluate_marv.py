# metrics/evaluate_marv.py
import os, json, random, time
from difflib import SequenceMatcher
from openai import OpenAI

MODEL = "gpt-4o"   # same model you use for refactoring
SAMPLES = 5         # test only 5 examples to start
REF_TYPE = "Extract Method"   # choose refactor type to evaluate

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "testdata", "MaRV.json")
REPORT_PATH = os.path.join(os.path.dirname(__file__), "marv_report.json")

def load_marv():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)[REF_TYPE]

def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()

def main():
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("Please set OPENAI_API_KEY environment variable.")
    client = OpenAI(api_key=key)

    data = load_marv()
    random.shuffle(data)
    data = data[:SAMPLES]

    scores = []
    results = []

    for i, ex in enumerate(data, 1):
        code_before = ex["code_before"]
        code_after = ex["code_after"]
        prompt = f"Refactor this Java code using {REF_TYPE}. Keep behavior identical:\n{code_before}"

        print(f"[{i}/{SAMPLES}] Sending to GPT...")
        response = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
        )

        gpt_output = response.choices[0].message.content
        score = similarity(gpt_output, code_after)
        scores.append(score)

        results.append({
            "index": i,
            "similarity": round(score, 3),
            "code_before": code_before,
            "expected_after": code_after,
            "gpt_refactored": gpt_output,
        })

        print(f"→ Example {i} similarity: {score:.2f}")
        time.sleep(0.5)

    avg = sum(scores) / len(scores)
    report = {"average_similarity": avg, "results": results}

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print("\n✅ Evaluation complete!")
    print(f"Average similarity: {avg:.2f}")
    print(f"Report saved to: {REPORT_PATH}")

if __name__ == "__main__":
    main()
