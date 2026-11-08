package ro.caiuspoputa.agendasalon;

/** Run with javac/java, without an Android device or network access. */
public final class NativeUpdatePolicyTest {
    interface Attempt { void run() throws Exception; }
    private static int checks;
    private static void allowed(Attempt attempt) throws Exception { attempt.run(); checks++; }
    private static void rejected(Attempt attempt) throws Exception {
        try { attempt.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Invalid update input accepted");
    }
    public static void main(String[] args) throws Exception {
        String apk = UpdatePolicy.REPOSITORY + "/releases/download/v1.0.16/Agenda-Salon-1.0.16.apk";
        allowed(() -> UpdatePolicy.apkUrl(apk, "1.0.16"));
        allowed(() -> UpdatePolicy.networkUrl(UpdatePolicy.METADATA_URL));
        if (!"https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json".equals(UpdatePolicy.METADATA_URL))
            throw new AssertionError("Metadata must use the exact Salon Pages URL");
        checks++;
        rejected(() -> UpdatePolicy.networkUrl("https://release-assets.githubusercontent.com/github-production-release-asset/123/a?sp=r&sig=x"));
        rejected(() -> UpdatePolicy.networkUrl("https://objects.githubusercontent.com/github-production-release-asset/123/a"));
        for (String url : new String[]{
                "http://github.com/caiuspoputa-debug/agenda-salon/releases/latest/download/update.json",
                "https://evil.example/a", "file:///android_asset/index.html", "https://github.com.evil.example/a",
                "https://user:pass@github.com/caiuspoputa-debug/agenda-salon/releases/a",
                "https://github.com:444/caiuspoputa-debug/agenda-salon/releases/a",
                "https://github.com/caiuspoputa-debug/other/releases/a", "https://github.com/other/agenda-salon/releases/a",
                "https://github.com/caiuspoputa-debug/agenda-salon/releases/a#fragment",
                "https://github.com/caiuspoputa-debug/agenda-salon/releases/a?q=x",
                "https://github.com/caiuspoputa-debug/agenda-salon/releases/../a",
                "https://github.com/caiuspoputa-debug/agenda-salon/releases/%2f/a",
                "https://github.com/caiuspoputa-debug/agenda-salon/releases//a",
                "https://objects.githubusercontent.com.evil.example/a", "https://192.168.0.20/a", "", "//github.com/a"})
            rejected(() -> UpdatePolicy.networkUrl(url));
        for (String url : new String[]{UpdatePolicy.METADATA_URL + "?x=1", UpdatePolicy.METADATA_URL + "#x",
                "https://caiuspoputa-debug.github.io/agenda-salon/other.json",
                "https://caiuspoputa-debug.github.io/agenda-salon/%75pdate.json",
                "https://caiuspoputa-debug.github.io/other/update.json",
                "https://caiuspoputa-debug.github.io/tool-upload-iphone/android-update.json",
                "http://caiuspoputa-debug.github.io/agenda-salon/update.json",
                "https://user@caiuspoputa-debug.github.io/agenda-salon/update.json",
                "https://caiuspoputa-debug.github.io:444/agenda-salon/update.json"})
            rejected(() -> UpdatePolicy.networkUrl(url));
        for (String url : new String[]{apk.replace("1.0.16.apk", "1.0.15.apk"), apk + "?a=1", apk.replace("/v1.0.16/", "/v1.0.15/"), apk.replace("agenda-salon", "atelier-sync-ha")})
            rejected(() -> UpdatePolicy.apkUrl(url, "1.0.16"));
        allowed(() -> UpdatePolicy.integer(27, 1, Integer.MAX_VALUE));
        allowed(() -> UpdatePolicy.integer(100L * 1024 * 1024, 1, UpdatePolicy.MAX_APK_BYTES));
        for (Object value : new Object[]{null, "27", 27.0, -1, 0, Long.MAX_VALUE, true})
            rejected(() -> UpdatePolicy.integer(value, 1, Integer.MAX_VALUE));
        rejected(() -> UpdatePolicy.integer(UpdatePolicy.MAX_APK_BYTES + 1, 1, UpdatePolicy.MAX_APK_BYTES));
        for (String version : new String[]{"", "v1.0.16", "1.0", "1.0.16-beta", "1.0.16/../", "1.0.16?x=y", "1000000.0.0"})
            rejected(() -> UpdatePolicy.version(version));
        allowed(() -> UpdatePolicy.version("1.0.16"));
        String digest = new String(new char[64]).replace('\0', 'A');
        if (!digest.toLowerCase(java.util.Locale.ROOT).equals(UpdatePolicy.digest(digest))) throw new AssertionError("Digest case");
        checks++;
        for (String invalid : new String[]{"", digest + "a", digest.substring(1), digest.substring(1) + "g"})
            rejected(() -> UpdatePolicy.digest(invalid));
        // Opening the browser requires a successful recent check and a strictly newer release.
        String handoff = UpdatePolicy.REPOSITORY + "/releases/download/v1.0.19/Agenda-Salon-1.0.19.apk";
        allowed(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 29, 1000, 1000));
        allowed(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 29, 1000, 1000 + 24L * 60 * 60 * 1000));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 29, 1000, 1001 + 24L * 60 * 60 * 1000));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 29, 29, 1000, 1001));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 28, 29, 1000, 1001));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 0, 1000, 1001));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 29, -1, 1001));
        rejected(() -> UpdatePolicy.browserUrl(handoff, "1.0.19", 30, 29, 1000, 999));
        for (String invalid : new String[]{handoff.replace("https:", "http:"), handoff.replace("agenda-salon", "other"),
                handoff + "?redirect=https://example.com", handoff + "#fragment", "content://ro.caiuspoputa.agendasalon.updates/apk/x.apk",
                "file:///sdcard/Download/update.apk", "intent://github.com/#Intent;end", handoff.replace("1.0.19.apk", "1.0.18.apk")})
            rejected(() -> UpdatePolicy.browserUrl(invalid, "1.0.19", 30, 29, 1000, 1001));
        System.out.println("Native update policy: " + checks + " checks passed.");
    }
}
