import java.nio.file.Path;
import java.nio.file.Paths;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.Node;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.expr.BinaryExpr;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.ast.stmt.DoStmt;
import com.github.javaparser.ast.stmt.ForEachStmt;
import com.github.javaparser.ast.stmt.ForStmt;
import com.github.javaparser.ast.stmt.IfStmt;
import com.github.javaparser.ast.stmt.ReturnStmt;
import com.github.javaparser.ast.stmt.WhileStmt;
import com.github.javaparser.ast.visitor.VoidVisitorAdapter;

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
        long recursiveCalls =
            m.findAll(MethodCallExpr.class).stream()
             .filter(c -> c.getNameAsString().equals(m.getNameAsString()))
             .count();

        // Fibonacci-style: more than one self-call
        return recursiveCalls > 1;
    }

private static boolean hasStringConcatInLoop(MethodDeclaration m) {

    // اجمع كل المتغيرات اللي نوعها String داخل الميثود
    var stringVars = m.findAll(com.github.javaparser.ast.body.VariableDeclarator.class)
        .stream()
        .filter(v -> v.getType().asString().equals("String") || v.getType().asString().equals("java.lang.String"))
        .map(v -> v.getNameAsString())
        .collect(java.util.stream.Collectors.toSet());

    return m.findAll(BinaryExpr.class).stream().anyMatch(b -> {
        if (b.getOperator() != BinaryExpr.Operator.PLUS) return false;


        if (!isInsideLoop(b)) return false;

        
        if (b.getLeft().isStringLiteralExpr() || b.getRight().isStringLiteralExpr()) return true;

        if (b.getLeft().isNameExpr() && stringVars.contains(b.getLeft().asNameExpr().getNameAsString())) return true;
        if (b.getRight().isNameExpr() && stringVars.contains(b.getRight().asNameExpr().getNameAsString())) return true;

        return false;
    });
}

private static boolean isInsideLoop(Node node) {
    Node parent = node;
    while (parent.getParentNode().isPresent()) {
        parent = parent.getParentNode().get();
        if (parent instanceof ForStmt
            || parent instanceof ForEachStmt
            || parent instanceof WhileStmt
            || parent instanceof DoStmt) {
            return true;
        }
    }
    return false;
}

 // ✅ NEW: Sorting detector
    private static boolean isSortingCall(MethodCallExpr call) {
        if (!call.getNameAsString().equals("sort")) return false;

        // Arrays.sort(...)
        if (call.getScope().isPresent() && call.getScope().get().toString().equals("Arrays")) {
            return true;
        }

        // Collections.sort(...)
        if (call.getScope().isPresent() && call.getScope().get().toString().equals("Collections")) {
            return true;
        }

        // list.sort(...)
        return call.getScope().isPresent();
    }

    // ✅ FIXED: Proper loop-depth computation using a visitor
    private static int computeMaxLoopDepth(MethodDeclaration m) {

        class LoopDepthVisitor extends VoidVisitorAdapter<Void> {
            int current = 0;
            int max = 0;

            private void enterLoop(Runnable visitChildren) {
                current++;
                max = Math.max(max, current);
                visitChildren.run();
                current--;
            }

            @Override
            public void visit(ForStmt n, Void arg) {
                enterLoop(() -> super.visit(n, arg));
            }

            @Override
            public void visit(ForEachStmt n, Void arg) {
                enterLoop(() -> super.visit(n, arg));
            }

            @Override
            public void visit(WhileStmt n, Void arg) {
                enterLoop(() -> super.visit(n, arg));
            }

            @Override
            public void visit(DoStmt n, Void arg) {
                enterLoop(() -> super.visit(n, arg));
            }
        }

        LoopDepthVisitor v = new LoopDepthVisitor();
        v.visit(m, null);
        return v.max;
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

                 // ✅ NEW: sorting facts
            var sortCalls = m.findAll(MethodCallExpr.class).stream()
                .filter(Analyzer::isSortingCall)
                .toList();

            facts.hasSortingCall = !sortCalls.isEmpty();
            facts.sortInsideLoop = sortCalls.stream().anyMatch(Analyzer::isInsideLoop);

            facts.callsSelf =
                m.findAll(MethodCallExpr.class)
                 .stream()
                 .anyMatch(c -> c.getNameAsString().equals(facts.methodName));

            // ✅ NEW fixed loop depth
            facts.maxLoopDepth = computeMaxLoopDepth(m);

            facts.cyclomaticComplexity =
                  1
                + m.findAll(IfStmt.class).size()
                + m.findAll(ForStmt.class).size()
                + m.findAll(ForEachStmt.class).size()
                + m.findAll(WhileStmt.class).size()
                + m.findAll(DoStmt.class).size();

            System.out.println(om.writeValueAsString(facts));
        }
    }
}
