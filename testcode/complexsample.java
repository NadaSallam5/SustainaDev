import java.util.Arrays;
import java.util.List;

public class complexsample {

    public static void main(String[] args) {
        List<User> users = Arrays.asList(
                new User("Alice", 25, true),
                new User("Bob", 17, false),
                new User("Charlie", 30, true),
                new User("Dina", 15, false),
                new User("Ethan", 40, true));

        complexsample processor = new complexsample();
        processor.processUsers(users);
    }

    public void processUsers(List<User> users) {
        int totalActive = 0;
        int totalAdults = 0;
        int totalScore = 0;

        for (User user : users) {
            if (user == null) {
                System.out.println("⚠️ Skipping null user");
                continue;
            }

            boolean isAdult = user.getAge() >= 18;
            if (isAdult) {
                totalAdults++;
            }

            if (user.isActive()) {
                totalActive++;
            }

            // 👇 Complex scoring logic – perfect for "Extract Method" refactor
            int score = 0;
            if (isAdult && user.isActive()) {
                score += 10;
            } else if (isAdult) {
                score += 5;
            } else if (user.isActive()) {
                score += 3;
            } else {
                score += 1;
            }

            if (user.getName().startsWith("A") || user.getName().startsWith("E")) {
                score += 2;
            }

            totalScore += score;
            System.out.println("User " + user.getName() + " has score: " + score);
        }

        double avgScore = users.isEmpty() ? 0 : (double) totalScore / users.size();
        System.out.println("Total users: " + users.size());
        System.out.println("Active users: " + totalActive);
        System.out.println("Adult users: " + totalAdults);
        System.out.println("Average score: " + avgScore);
    }

    // Simple data model
    static class User {
        private String name;
        private int age;
        private boolean active;

        public User(String name, int age, boolean active) {
            this.name = name;
            this.age = age;
            this.active = active;
        }

        public String getName() {
            return name;
        }

        public int getAge() {
            return age;
        }

        public boolean isActive() {
            return active;
        }
    }
}
