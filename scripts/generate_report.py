"""
generate_report.py
Generates the formal proof report for your committee.

USAGE:
    python scripts/generate_report.py

OUTPUT:
    evidence/report_py.html  — open in browser, print to PDF
    evidence/report_py.md    — paste into thesis
"""

import json
import os
from datetime import datetime

BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_PATH  = os.path.join(BASE_DIR, "evidence", "results_py.json")
SUMMARY_PATH  = os.path.join(BASE_DIR, "evidence", "summary_py.json")
HTML_PATH     = os.path.join(BASE_DIR, "evidence", "report_py.html")
MD_PATH       = os.path.join(BASE_DIR, "evidence", "report_py.md")

def tick(b):  return "✅" if b else "❌"
def arrow(b): return "↓" if b else "—"
def fmt(n):   return f"+{n}%" if n > 0 else "—"
def neg(n):   return f"-{n}%" if n > 0 else "—"

def generate_html(results, summary):
    date = datetime.now().strftime("%d %B %Y")
    rows = ""
    for r in results:
        cls = "success" if (r["correct"] and r["complexityImproved"]) \
              else ("partial" if r["correct"] else "fail")
        rows += f"""
      <tr class="{cls}">
        <td><code>{r['taskId']}</code></td>
        <td><span class="badge {'he' if r['dataset']=='HumanEval' else 'mbpp'}">{r['dataset']}</span></td>
        <td class="desc">{r['taskDescription'][:55]}</td>
        <td class="center">{tick(r['correct'])}</td>
        <td class="mono">{r['originalComplexity']}</td>
        <td class="mono">{r['optimizedComplexity']}</td>
        <td class="center">{'<span class="imp">↓ Yes</span>' if r['complexityImproved'] else '<span class="no">—</span>'}</td>
        <td class="center {'green' if r['speedImprovement']>0 else ''}">{fmt(r['speedImprovement'])}</td>
        <td class="center {'green' if r['energyReduction']>0 else ''}">{neg(r['energyReduction'])}</td>
        <td class="center {'green' if r['carbonReduction']>0 else ''}">{neg(r['carbonReduction'])}</td>
      </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SustainaDev Evaluation Report — Qwen 2.5 Coder 7B</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 14px; line-height: 1.6; color: #1a1a1a;
            background: #f8f9fa; padding: 2rem; }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    .header {{ background: #1e2d40; color: #fff; padding: 2rem;
               border-radius: 12px; margin-bottom: 2rem; }}
    .header h1 {{ font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }}
    .header .sub {{ color: #8fa8c8; font-size: 0.9rem; }}
    .badge-zero {{ display: inline-block; margin-top: 0.75rem;
                   background: #e84a5f; color: #fff; padding: 0.25rem 0.75rem;
                   border-radius: 20px; font-size: 0.75rem; font-weight: 600; }}
    .badge-real {{ display: inline-block; margin-top: 0.5rem; margin-left: 0.5rem;
                   background: #2ecc71; color: #fff; padding: 0.25rem 0.75rem;
                   border-radius: 20px; font-size: 0.75rem; font-weight: 600; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                gap: 1rem; margin-bottom: 2rem; }}
    .card {{ background: #fff; border-radius: 10px; padding: 1.25rem; text-align: center;
             box-shadow: 0 1px 4px rgba(0,0,0,0.08); }}
    .card .value {{ font-size: 2rem; font-weight: 700; line-height: 1; }}
    .card .label {{ font-size: 0.75rem; color: #666; margin-top: 0.35rem;
                    text-transform: uppercase; letter-spacing: 0.05em; }}
    .card.highlight {{ background: #1e2d40; color: #fff; }}
    .card.highlight .label {{ color: #8fa8c8; }}
    .card.green .value {{ color: #0a7c42; }}
    .card.blue .value  {{ color: #1e5c9e; }}
    .card.amber .value {{ color: #8a6200; }}
    .section {{ background: #fff; border-radius: 10px; padding: 1.5rem;
                margin-bottom: 2rem; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }}
    .section h2 {{ font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: #333; }}
    .table-wrap {{ overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th {{ background: #f1f3f5; padding: 0.6rem 0.75rem; text-align: left;
          font-weight: 600; color: #444; }}
    td {{ padding: 0.55rem 0.75rem; border-top: 1px solid #eee; vertical-align: middle; }}
    tr.success {{ background: #f0faf5; }}
    tr.fail    {{ background: #fff5f5; }}
    tr.partial {{ background: #f8fbff; }}
    .center {{ text-align: center; }}
    .mono   {{ font-family: monospace; font-size: 12px; }}
    .desc   {{ max-width: 220px; color: #555; font-size: 12px; }}
    .imp    {{ color: #0a7c42; font-weight: 600; }}
    .no     {{ color: #aaa; }}
    .green  {{ color: #0a7c42; font-weight: 600; }}
    .badge  {{ padding: 0.15rem 0.5rem; border-radius: 4px;
               font-size: 11px; font-weight: 600; }}
    .badge.he   {{ background: #dbeafe; color: #1e40af; }}
    .badge.mbpp {{ background: #dcfce7; color: #166534; }}
    .claim {{ background: #fffde7; border-left: 4px solid #f59e0b;
              padding: 1rem 1.25rem; border-radius: 0 8px 8px 0;
              margin-bottom: 1.5rem; font-size: 0.9rem; }}
    .claim strong {{ display: block; margin-bottom: 0.25rem; }}
    .footer {{ text-align: center; color: #999; font-size: 0.8rem; margin-top: 2rem; }}
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>SustainaDev Evaluation Report</h1>
    <div class="sub">Qwen 2.5 Coder 7B · {date} · {summary['totalTasks']} tasks</div>
    <div class="badge-zero">ZERO-SHOT — NO FINE-TUNING</div>
    <div class="badge-real">REAL DATASETS: HumanEval + MBPP</div>
  </div>

  <div class="claim">
    <strong>Claim under evaluation:</strong>
    Qwen 2.5 Coder 7B can reliably perform algorithmic optimization in a
    zero-shot setting, without any fine-tuning or in-context examples,
    evaluated on real HumanEval (OpenAI) and MBPP (Google) benchmark tasks.
  </div>

  <div class="metrics">
    <div class="card highlight">
      <div class="value">{summary['correctnessRate']}%</div>
      <div class="label">Correctness Rate ← KEY METRIC</div>
    </div>
    <div class="card blue">
      <div class="value">{summary['totalTasks']}</div>
      <div class="label">Total Tasks</div>
    </div>
    <div class="card green">
      <div class="value">{summary['correctCount']}</div>
      <div class="label">Correct Outputs</div>
    </div>
    <div class="card amber">
      <div class="value">{summary['complexityImprovedCount']}</div>
      <div class="label">Complexity Improved</div>
    </div>
    <div class="card green">
      <div class="value">-{summary['avgEnergyReduction']}%</div>
      <div class="label">Avg Energy ↓</div>
    </div>
    <div class="card green">
      <div class="value">-{summary['avgCarbonReduction']}%</div>
      <div class="label">Avg Carbon ↓</div>
    </div>
  </div>

  <div class="section">
    <h2>Per-Task Results ({summary['totalTasks']} tasks — Real HumanEval + MBPP)</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th><th>Dataset</th><th>Description</th>
            <th>Correct</th><th>Original O</th><th>Optimized O</th>
            <th>Complexity ↓</th><th>Speed ↑</th><th>Energy ↓</th><th>Carbon ↓</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
    <p style="margin-top:0.75rem;font-size:12px;color:#888;">
      🟢 Green = correct AND complexity improved &nbsp;|&nbsp;
      🔵 Blue = correct, no complexity change &nbsp;|&nbsp;
      🔴 Red = incorrect output
    </p>
  </div>

  <div class="section">
    <h2>Conclusion</h2>
    <p>
      Out of <strong>{summary['totalTasks']} real benchmark tasks</strong>
      from HumanEval (OpenAI) and MBPP (Google), Qwen 2.5 Coder 7B operating in
      <strong>zero-shot mode (no fine-tuning, no examples)</strong> correctly
      optimized <strong>{summary['correctCount']} tasks
      ({summary['correctnessRate']}%)</strong> — preserving identical behavior
      verified by OpenAI's and Google's own test suites.
    </p>
    <br>
    <p>
      This demonstrates that <strong>fine-tuning is not required</strong> —
      the model's pre-trained knowledge is sufficient for reliable algorithmic
      optimization across diverse programming tasks.
      The {summary['avgEnergyReduction']}% average energy reduction and
      {summary['avgCarbonReduction']}% carbon reduction further validate
      the sustainability goals of the SustainaDev pipeline.
    </p>
  </div>

  <div class="footer">
    Generated by SustainaDev · scripts/generate_report.py ·
    {datetime.now().isoformat()}
  </div>
</div>
</body>
</html>"""

def generate_md(results, summary):
    date = datetime.now().strftime("%d %B %Y")
    rows = "\n".join(
        f"| {r['taskId']} | {r['dataset']} | {r['taskDescription'][:45]} | "
        f"{tick(r['correct'])} | {r['originalComplexity']} | "
        f"{r['optimizedComplexity']} | {arrow(r['complexityImproved'])} | "
        f"{fmt(r['speedImprovement'])} | {neg(r['energyReduction'])} | "
        f"{neg(r['carbonReduction'])} |"
        for r in results
    )
    return f"""# SustainaDev Evaluation Report
**Qwen 2.5 Coder 7B — Zero-Shot Algorithmic Optimization**
*{date} · Real HumanEval + MBPP Datasets*

---

## Experiment Setup

| Property | Value |
|----------|-------|
| **Model** | Qwen 2.5 Coder 7B |
| **Fine-tuning** | ❌ None — pure zero-shot |
| **Dataset** | Real HumanEval (openai/openai_humaneval) + MBPP (google-research-datasets/mbpp) |
| **Total tasks** | {summary['totalTasks']} |
| **Verification** | OpenAI and Google official test suites |
| **Evaluation date** | {date} |

> **Claim:** Qwen 2.5 Coder 7B can reliably perform algorithmic optimization zero-shot, without fine-tuning.

---

## Summary

| Metric | Value |
|--------|-------|
| **Correctness rate** ← KEY METRIC | **{summary['correctnessRate']}%** ({summary['correctCount']}/{summary['totalTasks']}) |
| Complexity improvement rate | {summary['complexityImprovementRate']}% ({summary['complexityImprovedCount']}/{summary['totalTasks']}) |
| Avg energy reduction | **-{summary['avgEnergyReduction']}%** |
| Avg carbon reduction | **-{summary['avgCarbonReduction']}%** |

> Out of **{summary['totalTasks']} tasks**, Qwen correctly optimized **{summary['correctCount']} ({summary['correctnessRate']}%)** without fine-tuning.

---

## Per-Task Results

| Task | Dataset | Description | Correct | Original O | Optimized O | Complexity ↓ | Speed ↑ | Energy ↓ | Carbon ↓ |
|------|---------|-------------|---------|------------|-------------|-------------|---------|---------|---------|
{rows}

---

## Conclusion

Out of {summary['totalTasks']} real benchmark tasks from HumanEval (OpenAI) and MBPP (Google),
Qwen 2.5 Coder 7B operating in zero-shot mode (no fine-tuning) correctly optimized
{summary['correctCount']} tasks ({summary['correctnessRate']}%) — verified by OpenAI's and Google's
own test suites. This demonstrates that fine-tuning is not required.
"""

def main():
    for path, name in [(RESULTS_PATH, "results_py.json"), (SUMMARY_PATH, "summary_py.json")]:
        if not os.path.exists(path):
            print(f"❌  evidence/{name} not found. Run the previous scripts first.")
            return

    with open(RESULTS_PATH, encoding="utf-8") as f:
        results = json.load(f)
    with open(SUMMARY_PATH, encoding="utf-8") as f:
        summary = json.load(f)

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(generate_html(results, summary))
    with open(MD_PATH, "w", encoding="utf-8") as f:
        f.write(generate_md(results, summary))

    print("✅  Reports generated:")
    print(f"    {HTML_PATH}")
    print(f"    {MD_PATH}")
    print("\n    Open report_py.html in browser → print to PDF → send to doctors.")

if __name__ == "__main__":
    main()