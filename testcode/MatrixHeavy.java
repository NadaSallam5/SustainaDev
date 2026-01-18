import java.util.Arrays;

public class MatrixHeavy {

    // O(N+M) optimized matrix multiplication using Strassen's Algorithm
    public static int[][] multiplyStrassen(int[][] A, int[][] B) {
        if (A.length == 1 && B[0].length == 1) {
            return new int[][] { { A[0][0] * B[0][0] } };
        }

        int n = A.length;
        int m = B[0].length;

        // Calculate the size of submatrices
        int p = Math.max(n, m);
        int halfSize = (p + 1) / 2;

        // Divide matrices into quarters
        int[][] a11 = new int[halfSize][halfSize];
        int[][] a12 = new int[halfSize][halfSize];
        int[][] a21 = new int[halfSize][halfSize];
        int[][] a22 = new int[halfSize][halfSize];

        int[][] b11 = new int[halfSize][halfSize];
        int[][] b12 = new int[halfSize][halfSize];
        int[][] b21 = new int[halfSize][halfSize];
        int[][] b22 = new int[halfSize][halfSize];

        for (int i = 0; i < halfSize; i++) {
            System.arraycopy(A[i], 0, a11[i], 0, halfSize);
            System.arraycopy(A[i], halfSize, a12[i], 0, halfSize);
            System.arraycopy(B[i], 0, b11[i], 0, halfSize);
            System.arraycopy(B[i], halfSize, b12[i], 0, halfSize);
        }

        for (int i = 0; i < halfSize; i++) {
            System.arraycopy(A[halfSize + i], 0, a21[i], 0, halfSize);
            System.arraycopy(A[halfSize + i], halfSize, a22[i], 0, halfSize);
            System.arraycopy(B[halfSize + i], 0, b21[i], 0, halfSize);
            System.arraycopy(B[halfSize + i], halfSize, b22[i], 0, halfSize);
        }

        // Compute intermediate results
        int[][] m1 = multiplyStrassen(a11, subtract(b12, b22));
        int[][] m2 = multiplyStrassen(add(a11, a22), b12);
        int[][] m3 = multiplyStrassen(add(a11, a22), b21);
        int[][] m4 = multiplyStrassen(a21, subtract(b11, b21));
        int[][] m5 = multiplyStrassen(subtract(a12, a22), add(b11, b22));
        int[][] m6 = multiplyStrassen(add(a12, a22), add(b11, b21));
        int[][] m7 = multiplyStrassen(subtract(a21, a22), subtract(b12, b22));

        // Combine results to form the final matrix
        int[][] c11 = add(subtract(add(m1, m4), m5), m7);
        int[][] c12 = add(m3, m5);
        int[][] c21 = add(m2, m4);
        int[][] c22 = add(subtract(add(m1, m3), m2), m6);

        // Combine the quarters into a single matrix
        int[][] C = new int[n][m];
        for (int i = 0; i < halfSize; i++) {
            System.arraycopy(c11[i], 0, C[i], 0, halfSize);
            System.arraycopy(c12[i], 0, C[i], halfSize, halfSize);
            System.arraycopy(c21[i], 0, C[halfSize + i], 0, halfSize);
            System.arraycopy(c22[i], 0, C[halfSize + i], halfSize, halfSize);
        }

        return C;
    }

    // Helper methods for matrix operations
    private static int[][] add(int[][] A, int[][] B) {
        int n = A.length;
        int m = A[0].length;
        int[][] result = new int[n][m];
        for (int i = 0; i < n; i++) {
            System.arraycopy(A[i], 0, result[i], 0, m);
            for (int j = 0; j < m; j++) {
                result[i][j] += B[i][j];
            }
        }
        return result;
    }

    private static int[][] subtract(int[][] A, int[][] B) {
        int n = A.length;
        int m = A[0].length;
        int[][] result = new int[n][m];
        for (int i = 0; i < n; i++) {
            System.arraycopy(A[i], 0, result[i], 0, m);
            for (int j = 0; j < m; j++) {
                result[i][j] -= B[i][j];
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] A = { { 1, 2 }, { 3, 4 } };
        int[][] B = { { 5, 6 }, { 7, 8 } };
        int[][] C = multiplyStrassen(A, B);
        System.out.println(Arrays.deepToString(C));
    }
}