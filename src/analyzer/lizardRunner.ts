import * as cp from 'child_process';
import * as fs from 'fs';

export type FnInfo = {
  name: string;
  ccn: number;   // cyclomatic (from lizard if possible; else estimated)
  nloc: number;  // lines of code
  start: number; // 1-based line index
  end: number;   // inclusive
};

export async function runLizard(filePath: string): Promise<{ functions: FnInfo[] }> {
  // 1) Try Lizard (no special flags; supports all versions)
  let stdout = '';
  try {
    stdout = await execOut(`python -m lizard "${filePath}"`);
  } catch (e) {
    // ignore; we'll fallback
  }

  const fnsFromLizard = parseLizard(stdout);
  if (fnsFromLizard.length > 0) {
    return { functions: fnsFromLizard };
  }

  // 2) Fallback: parse Java methods directly and estimate CCN
  const src = fs.readFileSync(filePath, 'utf8');
  const fnsFallback = extractJavaMethods(src);
  return { functions: fnsFallback };
}

/* --------------------------- helpers --------------------------- */

function execOut(cmd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    cp.exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(stderr || err) : resolve(stdout)
    )
  );
}

/** Parse various Lizard text table formats robustly */
function parseLizard(stdout: string): FnInfo[] {
  const functions: FnInfo[] = [];
  if (!stdout) return functions;

  const lines = stdout.split(/\r?\n/);

  // Pattern A (common):
  // NLOC CCN token PARAM length  functionName   file:START-END
  const patA = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+([A-Za-z0-9_<>$]+)\s+.*:(\d+)-(\d+)/;

  // Pattern B (sometimes columns differ by one fewer token col):
  // NLOC CCN PARAM length  functionName   file:START-END
  const patB = /^\s*(\d+)\s+(\d+)\s+\S+\s+\S+\s+([A-Za-z0-9_<>$]+)\s+.*:(\d+)-(\d+)/;

  for (const ln of lines) {
    let m = ln.match(patA) || ln.match(patB);
    if (m) {
      const nloc = Number(m[1]);
      const ccn = Number(m[2]);
      const name = m[3];
      const start = Number(m[4]);
      const end = Number(m[5]);
      functions.push({ name, ccn, nloc, start, end });
    }
  }
  return functions;
}

/** Fallback: very simple Java method block parser + CCN estimate */
function extractJavaMethods(source: string): FnInfo[] {
  const lines = source.split(/\r?\n/);

  // Rough method signature regex (public/protected/private/static/…)
  const sig = /(?:public|private|protected|static|\s)*\s+[A-Za-z0-9_<>\[\].?]+(?:\s+[A-Za-z0-9_<>\[\].?]+)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{/g;

  const text = source;
  const fns: FnInfo[] = [];
  let m: RegExpExecArray | null;

  while ((m = sig.exec(text)) !== null) {
    const name = m[1];
    const startIdx = m.index;
    // find start line
    const startLine = text.slice(0, startIdx).split(/\r?\n/).length;

    // scan forward to find matching closing brace
    let brace = 0;
    let i = startIdx;
    let endPos = text.length - 1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') brace++;
      if (ch === '}') {
        brace--;
        if (brace === 0) { endPos = i; break; }
      }
    }
    const endLine = text.slice(0, endPos + 1).split(/\r?\n/).length;

    const body = lines.slice(startLine - 1, endLine).join('\n');

    // NLOC = non-empty, non-brace lines
    const nloc = body.split(/\r?\n/)
      .filter(l => l.trim().length > 0 && l.trim() !== '{' && l.trim() !== '}')
      .length;

    // CCN estimate: count common decision points
    const ccn = 1 + (body.match(/\bif\b|\bfor\b|\bwhile\b|\bcase\b|\?|\bcatch\b|&&|\|\|/g)?.length || 0);

    fns.push({ name, ccn, nloc, start: startLine, end: endLine });
  }

  return fns;
}
