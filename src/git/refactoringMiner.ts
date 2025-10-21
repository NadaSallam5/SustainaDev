import * as cp from 'child_process';
import * as fs from 'fs';

export async function verifyLastRefactor(repoPath: string): Promise<string[]> {
  const log = await out(`git -C "${repoPath}" log --pretty=%H -n 2`);
  const [newSHA, oldSHA] = log.trim().split(/\r?\n/);
  const outPath = `${repoPath}/.sustainadev/refminer.json`;
  await out(`RefactoringMiner -bc "${repoPath}" ${oldSHA} ${newSHA} -json "${outPath}"`);
  const json = JSON.parse(fs.readFileSync(outPath,'utf8'));
  const types = (json?.commits?.[0]?.refactorings ?? []).map((r: any) => r.type);
  return types;
}
function out(cmd: string): Promise<string> {
  return new Promise((res, rej) => cp.exec(cmd, (e, stdout, stderr) => e ? rej(stderr || e) : res(stdout)));
}
