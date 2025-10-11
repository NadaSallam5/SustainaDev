import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    console.log('🟢 SustainaDev Analyzer extension is active');

    const disposable = vscode.commands.registerCommand('sustainadev.runAnalyzer', () => {
        vscode.window.showInformationMessage('🚀 Running SustainaDev Java Analyzer...');

        // 👉 change these two paths if needed
        const jarPath = path.join("C:\\Users\\Silvia\\OneDrive\\Desktop\\SustainaDev\\target", "javatool-1.0-SNAPSHOT-jar-with-dependencies.jar");
        const projectPath = "C:\\Users\\Silvia\\OneDrive\\Desktop\\SustainaDev\\testcode";

        const command = `java -jar "${jarPath}" "${projectPath}"`;

        const terminal = vscode.window.createTerminal("SustainaDev Analyzer");
        terminal.show();
        terminal.sendText(command);

        // run the process and wait for it to finish
        exec(command, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`❌ Analyzer failed: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(stderr);
            }
            console.log(stdout);
            vscode.window.showInformationMessage('✅ Analysis complete! Check analysis-report.json');
        });
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
