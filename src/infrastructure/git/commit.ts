import * as cp from "child_process";

export async function gitCommit(repoPath: string, message: string) {
  await exec(`git -C "${repoPath}" add -A`);
  await exec(
    `git -C "${repoPath}" commit -m "${message.replace(/"/g, '\\"')}"`,
  );
}

function exec(cmd: string) {
  return new Promise<void>((res, rej) =>
    cp.exec(cmd, (e) => (e ? rej(e) : res())),
  );
}
