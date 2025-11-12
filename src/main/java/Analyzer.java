import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.VariableDeclarator;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;

public class Analyzer {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.out.println("Usage: java -jar analyzer.jar <path-to-java-project>");
            return;
        }

        Path root = Paths.get(args[0]);
        if (!Files.exists(root)) {
            System.out.println("❌ Path does not exist: " + root);
            return;
        }

        List<Map<String, Object>> reports = new ArrayList<>();

        Files.walk(root)
                .filter(p -> p.toString().endsWith(".java"))
                .sorted() // ✅ ensures deterministic order
                .forEach(p -> {
                    try {
                        CompilationUnit cu = StaticJavaParser.parse(p);

                        Map<String, Object> fileReport = new HashMap<>();
                        fileReport.put("file", p.toString());

                        List<Map<String, Object>> methods = new ArrayList<>();

                        System.out.println("✅ Parsed file: " + p + " | Total methods: "
                                + cu.findAll(MethodDeclaration.class).size());

                        for (MethodDeclaration m : cu.findAll(MethodDeclaration.class)) {
                            System.out.println("Analyzing method: " + m.getNameAsString() + " in " + p);

                            Map<String, Object> methodInfo = new HashMap<>();
                            methodInfo.put("name", m.getNameAsString());

                            int start = m.getBegin().map(pos -> pos.line).orElse(0);
                            int end = m.getEnd().map(pos -> pos.line).orElse(0);
                            int lines = end - start + 1;

                            methodInfo.put("lines", lines);
                            methodInfo.put("params", m.getParameters().size());
                            methodInfo.put("ifCount", m.findAll(IfStmt.class).size());
                            methodInfo.put("forCount",
                                    m.findAll(ForStmt.class).size() + m.findAll(ForEachStmt.class).size());
                            methodInfo.put("isLongMethod", lines >= 50);

                            String methodBody = m.getBody().map(Object::toString).orElse("");
                            methodInfo.put("body", methodBody);

                            List<String> localVars = m.findAll(VariableDeclarator.class)
                                    .stream()
                                    .map(v -> v.getNameAsString())
                                    .toList();
                            methodInfo.put("locals", localVars);

                            // ✅ FIX: add method info to the list!
                            methods.add(methodInfo);
                        }

                        fileReport.put("methods", methods);
                        reports.add(fileReport);
                    } catch (Exception e) {
                        System.err.println("⚠️ Error parsing " + p + ": " + e.getMessage());
                    }
                });

        // Save JSON output
        ObjectMapper om = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        File outputFile = new File("analysis-report.json");
        om.writeValue(outputFile, reports);

        System.out.println("✅ Analysis complete! Results saved to: " + outputFile.getAbsolutePath());

    }
}
