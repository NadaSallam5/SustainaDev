// inlinemethod.ts — FINAL FIXED VERSION ✅

import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../metrics/codeCarbon";
import { appendLog } from "../metrics/logger";

/**
 * Performs Inline Method refactor + metrics & logging
 */
export async function buildInlinePatch(
  fullCode: string,
  methodName: string,
  fileName: string
): Promise<{ preview: string; inlinedMethod: string; callCount: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const project = process.env.OPENAI_PROJECT_ID;
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // ---------------- BEFORE METRICS ----------------
  const beforeMetrics = await safeRunLizard(fileName);
  const beforeFn = beforeMetrics?.functions?.find((f: any) =>
    f.name.includes(methodName)
  );
  const before = beforeFn || { ccn: 0, nloc: 0 };

  // ---------------- Inline Logic ----------------
  const localInline = () => {
    const classBodyMatch = fullCode.match(/([\s\S]*class\s+\w+[\s\S]*)/m);
    const classBody = classBodyMatch ? classBodyMatch[0] : fullCode;

    const methodHeaderRe = new RegExp(
      `(public|private|protected)?\\s*(static\\s*)?(final\\s*)?([\\w<>\\[\\]\\s]+)\\s+${methodName}\\s*\\(([^)]*)\\)`,
      "m"
    );
    const headerMatch = classBody.match(methodHeaderRe);
    if (!headerMatch || headerMatch.index === undefined)
      throw new Error(`Method ${methodName} not found.`);

    const headerIndex = headerMatch.index;
    const headerText = headerMatch[0];
    const paramsRaw = (headerMatch[5] ?? "").trim();

    const braceStart = classBody.indexOf("{", headerIndex + headerText.length);
    if (braceStart === -1) throw new Error("Could not find method body brace.");

    let pos = braceStart;
    let depth = 1;
    while (pos + 1 < classBody.length && depth > 0) {
      pos++;
      const ch = classBody[pos];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth !== 0) throw new Error("Unbalanced braces in method.");

    const methodStart = headerIndex;
    const methodEnd = pos + 1;
    const beforePart = classBody.slice(0, methodStart);
    const methodText = classBody.slice(methodStart, methodEnd);
    const afterPart = classBody.slice(methodEnd);

    const methodBodyContent = classBody.slice(braceStart + 1, pos).trim();
    const returnMatch = methodBodyContent.match(/^\s*return\s+([\s\S]*?)\s*;\s*$/m);
    if (!returnMatch) throw new Error("Method body too complex to inline.");

    const expr = returnMatch[1].trim();

    const params = paramsRaw
      ? paramsRaw.split(/,/).map((p) => p.trim()).filter(Boolean).map((p) => {
          const parts = p.split(/\s+/).filter(Boolean);
          const name = parts[parts.length - 1];
          return { raw: p, name };
        })
      : [];

    const searchArea = beforePart + afterPart;
    const callRegex = new RegExp(`\\b${methodName}\\s*\\(`, "g");

    function splitArgs(s: string): string[] {
      const res: string[] = [];
      let cur = "";
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          res.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) res.push(cur.trim());
      return res;
    }

    let out = "";
    let lastIndex = 0;
    let callCount = 0;

    while (true) {
      const mCall = callRegex.exec(searchArea);
      if (!mCall) break;
      const callStart = mCall.index;
      const parenStart = callStart + mCall[0].length - 1;
      let p = parenStart;
      let pDepth = 1;
      while (p + 1 < searchArea.length && pDepth > 0) {
        p++;
        const ch = searchArea[p];
        if (ch === "(") pDepth++;
        else if (ch === ")") pDepth--;
      }
      if (pDepth !== 0) break;

      const callEnd = p + 1;
      const argsRaw = searchArea.slice(parenStart + 1, p);
      const args = argsRaw.trim() ? splitArgs(argsRaw) : [];

      if (params.length && args.length !== params.length) continue;

      let inlinedExpr = expr;
      params.forEach((param, i) => {
        const arg = args[i] ?? "";
        const re = new RegExp(`\\b${escapeRegex(param.name)}\\b`, "g");
        inlinedExpr = inlinedExpr.replace(re, arg);
      });

      const finalReplacement = `(${inlinedExpr})`;
      out += searchArea.slice(lastIndex, callStart) + finalReplacement;
      lastIndex = callEnd;
      callCount++;
    }

    out += searchArea.slice(lastIndex);
    if (callCount === 0) throw new Error("No call sites found to inline.");

    const fullPreview = fullCode.replace(classBody, out);
    return { preview: fullPreview, inlinedMethod: methodText.trim(), callCount };
  };
  // -----------------------------------------------------

  // 🧠 Run either local or OpenAI-based inline logic
  let result;
  if (apiKey && project) {
    try {
      const client = new OpenAI({ apiKey: apiKey!, project: project! });
      const prompt = `Perform an Inline Method refactoring for Java. Inline the body of '${methodName}' into its call sites. Output sections labeled: Preview (java), Inlined Method (java), Call Count.`;
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a Java refactoring expert. Output only valid code sections." },
          { role: "user", content: prompt + "\n\nFile:\n" + fullCode },
        ],
        temperature: 0,
        max_tokens: 6000,
      });
      const text = resp.choices?.[0]?.message?.content ?? "";
      const preview = extractSection(text, "Preview");
      const inlinedMethod = extractSection(text, "Inlined Method");
      const callCount = parseInt(extractLabelValue(text, "Call Count") || "0");
      result = preview && preview.trim().length > 10
        ? { preview, inlinedMethod, callCount }
        : localInline();
    } catch {
      vscode.window.showWarningMessage("⚠️ OpenAI call failed — using local fallback.");
      result = localInline();
    }
  } else {
    result = localInline();
  }

  // ---------------- AFTER METRICS ----------------
  // write refactored code to a temp file (auto-deleted later)
  const tmpAfter = path.join(os.tmpdir(), `sustainadev_inline_after.java`);
  fs.writeFileSync(tmpAfter, result.preview, "utf8");

  const afterMetrics = await safeRunLizard(tmpAfter);
  const afterFn = afterMetrics?.functions?.find((f: any) =>
    f.name.includes(methodName)
  );
  const after = afterFn || { ccn: 0, nloc: 0 };

  // cleanup temp
  try { fs.unlinkSync(tmpAfter); } catch {}

  // compute metrics & log
  const delta = { ccn: before.ccn - after.ccn, nloc: before.nloc - after.nloc };
  const energy = await estimateEnergy(delta.ccn);

  const logPath = path.join(workspace, ".sustainadev", "log.jsonl");
  const logEntry = {
    timestamp: new Date().toISOString(),
    file: fileName,
    refactor: "Inline Method",
    before,
    after,
    delta,
    verify: { refminer: false },
    energy,
    commit: {
      message: `Inline Method in ${methodName}: ${result.callCount} call(s) replaced`,
    },
  };
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n", "utf8");

  console.log(`✅ Inline Method completed! CCN ${before.ccn} → ${after.ccn}, NLOC ${before.nloc} → ${after.nloc}`);
  return result;
}

/* ---------------- Helpers ---------------- */
async function safeRunLizard(file: string) {
  try {
    return await runLizard(file);
  } catch (e) {
    console.error("⚠️ Lizard failed on", file, e);
    return { functions: [] };
  }
}

function extractSection(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*\`\`\`[\\s\\S]*?\`\`\``, "i");
  const match = output.match(re);
  if (!match) return "";
  return match[0]
    .replace(new RegExp(`${label}:`, "i"), "")
    .replace(/```java/i, "")
    .replace(/```/g, "")
    .trim();
}

function extractLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim().split(/\s+/)[0] : "";
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
