import java.nio.file.Path;
import java.nio.file.Paths;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.stmt.*;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.expr.BinaryExpr;
public class Analyzer {
private static boolean isLinearRecursion(MethodDeclaration m) {
    long recursiveCalls =
        m.findAll(MethodCallExpr.class)
         .stream()
         .filter(c -> c.getNameAsString().equals(m.getNameAsString()))
         .count();

    return recursiveCalls == 1;
}
private static boolean isPureAccumulation(MethodDeclaration m) {
    return m.findAll(ReturnStmt.class).stream().anyMatch(ret ->
        ret.getExpression().isPresent() &&
        ret.getExpression().get().toString().contains(m.getNameAsString() + "(")
    );
}

private static boolean hasOverlappingSubproblems(MethodDeclaration m) {
    var recursiveCalls =
        m.findAll(MethodCallExpr.class).stream()
         .filter(c -> c.getNameAsString().equals(m.getNameAsString()))
         .map(c -> c.getArguments().toString())
         .toList();

    return recursiveCalls.stream().distinct().count()
           < recursiveCalls.size();
}
private static boolean hasStringConcatInLoop(MethodDeclaration m) {
    return m.findAll(BinaryExpr.class).stream().anyMatch(b -> {
        if (b.getOperator() != BinaryExpr.Operator.PLUS) return false;

        // لازم يكون جوّه loop
        Node parent = b;
        while (parent.getParentNode().isPresent()) {
            parent = parent.getParentNode().get();
            if (parent instanceof ForStmt || parent instanceof WhileStmt) {
                return true;
            }
        }
        return false;
    });
}


   public static void main(String[] args) throws Exception {
    if (args.length == 0) {
        System.err.println("Usage: java Analyzer <java-file>");
        return;
    }

    Path file = Paths.get(args[0]);
    ObjectMapper om = new ObjectMapper();

    CompilationUnit cu = StaticJavaParser.parse(file);

    for (MethodDeclaration m : cu.findAll(MethodDeclaration.class)) {
    MethodFacts facts = new MethodFacts();
    facts.methodName = m.getNameAsString();

    facts.isLinearRecursion = isLinearRecursion(m);
    facts.isPureAccumulation = isPureAccumulation(m);
    facts.hasOverlappingSubproblems = hasOverlappingSubproblems(m);
    facts.hasStringConcatInLoop = hasStringConcatInLoop(m);

    facts.callsSelf =
        m.findAll(MethodCallExpr.class)
         .stream()
         .anyMatch(c -> c.getNameAsString().equals(facts.methodName));

    int maxDepth = 0;
    for (Statement s : m.findAll(Statement.class)) {
        int depth = 0;
        Node n = s;
        while (n.getParentNode().isPresent()) {
            n = n.getParentNode().get();
            if (n instanceof ForStmt || n instanceof ForEachStmt) {
                depth++;
            }
        }
        maxDepth = Math.max(maxDepth, depth);
    }
    facts.maxLoopDepth = maxDepth;

    facts.cyclomaticComplexity =
          1
        + m.findAll(IfStmt.class).size()
        + m.findAll(ForStmt.class).size()
        + m.findAll(ForEachStmt.class).size();

    // ✅ JSON مرة واحدة فقط
    System.out.println(om.writeValueAsString(facts));
}

}
}