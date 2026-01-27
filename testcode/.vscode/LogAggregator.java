import java.util.List;

public class LogAggregator {

    public String aggregateLogs(List<String> logs) {
        StringBuilder finalLog = new StringBuilder();

        // Only one loop: Detector will return { type: "GENERAL" }
        for (String log : logs) {
            finalLog.append(log).append("\n");
        }

        return finalLog.toString();
    }
}