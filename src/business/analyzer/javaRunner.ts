import { execFile } from "child_process";
import { MethodFacts } from "../types";
import * as path from "path";
import * as vscode from "vscode";

export function runJavaAnalyzer(
  context: vscode.ExtensionContext
): Promise<MethodFacts[]> {
  return new Promise((resolve, reject) => {

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return reject("No active editor");
    }

    const javaFilePath = editor.document.uri.fsPath;
    if (!javaFilePath.endsWith(".java")) {
      return reject("Active file is not a Java file");
    }

    const jarPath = path.join(
      context.extensionPath,
      "target",
      "javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
    );

    execFile(
      "java",
      ["-jar", jarPath, javaFilePath],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(stderr || error.message);
        }

        try {
          const facts: MethodFacts[] = stdout
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("{"))
            .map(line => JSON.parse(line));

          resolve(facts);
        } catch {
          reject("Failed to parse Java analyzer output");
        }
      }
    );
  });
}
