import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";

// FIX 1: Singleton parsers per language — avoids expensive re-initialization
// on every method parse call, which was causing UI lag and frame drops.
const parsers: Record<string, Parser> = {};

export function parseCode(code: string, filePath: string) {
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (!ext) {
    throw new Error("Could not determine file extension.");
  }

  // Reuse existing parser if already initialized for this language
  if (!parsers[ext]) {
    const parser = new Parser();

    if (ext === "java") {
      parser.setLanguage(Java);
    } else if (ext === "js") {
      parser.setLanguage(JavaScript);
    } else if (ext === "py") {
      parser.setLanguage(Python);
    } else if (ext === "ts") {
      parser.setLanguage(TypeScript.typescript);
    } else if (ext === "tsx") {
      // FIX 4: TSX needs its own grammar, not the TypeScript one
      parser.setLanguage(TypeScript.tsx);
    } else {
      throw new Error(`Unsupported file extension: ${ext}`);
    }

    parsers[ext] = parser;
  }

  return parsers[ext].parse(code);
}