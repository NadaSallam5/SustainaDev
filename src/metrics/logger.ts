import * as fs from 'fs';
import * as path from 'path';

export function appendLog(workspace: string, entry: any) {
  const dir = path.join(workspace, '.sustainadev');
  const file = path.join(dir, 'log.jsonl');
  if (!fs.existsSync(dir)) {fs.mkdirSync(dir);}
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}
