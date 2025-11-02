// lizardRunner.ts — fixed version ✅
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

export type FnInfo = {
  name: string;
  ccn: number; // cyclomatic complexity
  nloc: number; // lines of code
  start: number; // 1-based line index
  end: number; // inclusive
};

/**
 * Run Lizard on a Java file path
 */
export async function runLizard(filePath: string): Promise<{ functions: FnInfo[] }> {
  try {
    const stdout = await execOut(`python -m lizard "${filePath}"`);
    const fns = parseLizard(stdout);
    if (fns.length > 0) return { functions: fns };
  } catch (e) {
    console.warn("⚠️ Lizard failed, falling back to parser:", e);
  }

  // fallback parser if Lizard fails
  const src = fs.readFileSync(filePath, "utf8");
  return { functions: extractJavaMethods(src) };
}

/**
 * Run Lizard on Java code provided as string
 * Writes temporary file inside .sustainadev and cleans up after
 */
export async function runLizardFromString(code: string): Promise<{ functions: FnInfo[] }> {
  const tmpDir = path.join(process.cwd(), ".sustainadev");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const tmpFile = path.join(tmpDir, `tmp_${Date.now()}.java`);
  fs.writeFileSync(tmpFile, code, "utf8");

  try {
    return await runLizard(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile); // clean up immediately
  }
}

/* --------------------------- helpers --------------------------- */

function execOut(cmd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    cp.exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(stderr || err) : resolve(stdout)
    )
  );
}

/**
 * Parse Lizard stdout robustly
 */
function parseLizard(stdout: string): FnInfo[] {
  const functions: FnInfo[] = [];
  if (!stdout) return functions;

  const lines = stdout.split(/\r?\n/);

  // Pattern A (NLOC CCN token PARAM length functionName file:START-END)
  const patA = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+([A-Za-z0-9_<>$]+)\s+.*:(\d+)-(\d+)/;
  // Pattern B (sometimes fewer columns)
  const patB = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+([A-Za-z0-9_<>$]+)\s+.*:(\d+)-(\d+)/;

  for (const ln of lines) {
    const m = ln.match(patA) || ln.match(patB);
    if (m) {
      functions.push({
        nloc: Number(m[1]),
        ccn: Number(m[2]),
        name: m[3],
        start: Number(m[4]),
        end: Number(m[5]),
      });
    }
  }
  return functions;
}

/**
 * Fallback: simple Java method parser + CCN estimate
 */
function extractJavaMethods(source: string): FnInfo[] {
  const lines = source.split(/\r?\n/);

  const sig =
    /(?:public|private|protected|static|\s)*\s+[A-Za-z0-9_<>\[\].?]+(?:\s+[A-Za-z0-9_<>\[\].?]+)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{/g;

  const fns: FnInfo[] = [];
  let m: RegExpExecArray | null;

  while ((m = sig.exec(source)) !== null) {
    const name = m[1];
    const startIdx = m.index;

    const startLine = source.slice(0, startIdx).split(/\r?\n/).length;

    // find matching closing brace
    let brace = 0;
    let endPos = source.length - 1;
    for (let i = startIdx; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") brace++;
      if (ch === "}") {
        brace--;
        if (brace === 0) {
          endPos = i;
          break;
        }
      }
    }

    const endLine = source.slice(0, endPos + 1).split(/\r?\n/).length;

    const body = lines.slice(startLine - 1, endLine).join("\n");

    const nloc = body
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0 && l.trim() !== "{" && l.trim() !== "}")
      .length;

    const ccn =
      1 +
      (body.match(/\bif\b|\bfor\b|\bwhile\b|\bcase\b|\?|\bcatch\b|&&|\|\|/g)?.length || 0);

    fns.push({ name, ccn, nloc, start: startLine, end: endLine });
  }

  return fns;
}
