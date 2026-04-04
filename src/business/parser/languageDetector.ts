export function detectLanguage(fileName:string){

 if(fileName.endsWith(".java")) return "java"

 if(fileName.endsWith(".py")) return "python"

 if(fileName.endsWith(".js")) return "javascript"

 if(fileName.endsWith(".cpp")) return "cpp"

 return "unknown"
}