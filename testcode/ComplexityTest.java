public class ComplexityTest {

    /**
     * HIGH COMPLEXITY: O(N * M)
     * Expected optimization: O(N + M) using HashSet
     */
    public static List<Integer> findCommonElements(
            List<Integer> list1, List<Integer> list2) {

        List<Integer> result = new ArrayList<>();

        for (int i = 0; i < list1.size(); i++) {
            for (int j = 0; j < list2.size(); j++) {
                if (list1.get(i).equals(list2.get(j))) {
                    result = removeDuplicateIfNotExists(result, list1.get(i));
                    break;
                }
            }
        }
        return result;
    }

    /**
     * HIGH COMPLEXITY: O(N^2)
     * Expected optimization: O(N) using HashSet
     */
    public static List<String> removeDuplicates(List<String> input) {
        List<String> unique = new ArrayList<>();

        for (int i = 0; i < input.size(); i++) {
            boolean exists = false;
            for (int j = 0; j < unique.size(); j++) {
                if (input.get(i).equals(unique.get(j))) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                unique.add(input.get(i));
            }
        }
        return unique;
    }

    /**
     * HIGH COMPLEXITY: O(N^2)
     * Expected optimization: O(N) using HashMap
     */
    public static Map<String, Integer> countWordFrequency(String[] words) {
        Map<String, Integer> freq = new HashMap<>();

        for (int i = 0; i < words.length; i++) {
            int count = 0;
            for (int j = 0; j < words.length; j++) {
                if (words[i].equals(words[j])) {
                    count++;
                }
            }
            freq.put(words[i], count);
        }
        return freq;
    }

    /**
     * HIGH COMPLEXITY: O(N^2)
     * Expected optimization: O(N) using HashSet
     */
    public static boolean hasPairWithSum(int[] nums, int target) {
        for (int i = 0; i < nums.length; i++) {
            for (int j = i + 1; j < nums.length; j++) {
                if (nums[i] + nums[j] == target) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * VERY HIGH COMPLEXITY: O(N^3)
     * Expected optimization: O(N^2) with sorting + two pointers
     */
    public static List<List<Integer>> threeSumBrute(int[] nums) {
        List<List<Integer>> result = new ArrayList<>();
        int n = nums.length;

        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                for (int k = j + 1; k < n; k++) {
                    if (nums[i] + nums[j] + nums[k] == 0) {
                        result.add(Arrays.asList(nums[i], nums[j], nums[k]));
                    }
                }
            }
        }
        return result;
    }

    private static List<Integer> removeDuplicateIfNotExists(List<Integer> result, Integer element) {
        if (!result.contains(element)) {
            result.add(element);
        }
        return result;
    }
}