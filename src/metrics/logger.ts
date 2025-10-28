import * as fs from 'fs';
import * as path from 'path';

export function appendLog(workspaceRoot: string, entry: any) {
  const dir = path.join(workspaceRoot, '.sustainadev');
  const file = path.join(dir, 'log.jsonl');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}
