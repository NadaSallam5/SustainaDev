import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";

export function parseCode(code: string, filePath: string) {
    const parser = new Parser();

    const ext = filePath.split(".").pop()?.toLowerCase();

    if (ext === "java") {
        parser.setLanguage(Java);
    } else if (ext === "js") {
        parser.setLanguage(JavaScript);
    } else if (ext === "py") {
        parser.setLanguage(Python);
    } else if (ext === "ts") {
        parser.setLanguage(TypeScript.typescript); // 👈 مهم جدًا
    } else {
        throw new Error(`Unsupported file extension: ${ext}`);
    }

    return parser.parse(code);
}