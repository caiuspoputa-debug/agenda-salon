package ro.caiuspoputa.agendasalon;

import java.net.URL;

/** No Android dependency: rules shared by metadata parsing, network and native tests. */
final class UpdatePolicy {
    static final String REPOSITORY = "https://github.com/caiuspoputa-debug/agenda-salon";
    static final String METADATA_URL = "https://caiuspoputa-debug.github.io/agenda-salon/update-personal.json";
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    static final int MAX_METADATA_BYTES = 32 * 1024;

    private UpdatePolicy() {}

    static String version(String value) {
        if (value == null || !value.matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}"))
            throw new IllegalArgumentException("Invalid update version");
        return value;
    }

    static long integer(Object value, long minimum, long maximum) {
        if (!(value instanceof Integer) && !(value instanceof Long))
            throw new IllegalArgumentException("Update field must be an integer");
        long number = ((Number)value).longValue();
        if (number < minimum || number > maximum) throw new IllegalArgumentException("Update value out of range");
        return number;
    }

    static String digest(String value) {
        if (value == null || !value.matches("[a-fA-F0-9]{64}"))
            throw new IllegalArgumentException("Invalid update checksum");
        return value.toLowerCase(java.util.Locale.ROOT);
    }

    static URL apkUrl(String value, String version) throws Exception {
        String expected = REPOSITORY + "/releases/download/v" + version(version)
            + "/Agenda-Salon-" + version + ".apk";
        if (!expected.equals(value)) throw new IllegalArgumentException("Unexpected APK source");
        return new URL(expected);
    }

    static URL browserUrl(String value, String version, long metadataCode, long installedCode,
                          long checkedAt, long now) throws Exception {
        if (metadataCode <= installedCode || installedCode <= 0 || checkedAt < 0 || now < checkedAt
                || now - checkedAt > 24L * 60 * 60 * 1000)
            throw new IllegalArgumentException("A fresh newer release is required before opening the browser");
        return apkUrl(value, version);
    }

    static URL networkUrl(String value) throws Exception {
        // Only the small metadata document is fetched by this app. APK redirects belong to the browser.
        if (!METADATA_URL.equals(value)) throw new IllegalArgumentException("Unexpected metadata endpoint");
        return new URL(METADATA_URL);
    }
}
