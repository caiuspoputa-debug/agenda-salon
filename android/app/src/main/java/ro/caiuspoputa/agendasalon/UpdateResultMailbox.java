package ro.caiuspoputa.agendasalon;

import org.json.JSONObject;
import java.util.LinkedHashMap;

/**
 * Bounded, process-local snapshots of public updater results. The JavaScript
 * bridge can read these immutable strings without WebView calls, disk or network
 * access. Update actions still require the activity's trusted-page check.
 * Terminal results cannot be replaced by late progress or duplicate completion.
 */
final class UpdateResultMailbox {
    private static final int MAX_REQUESTS = 8;
    private static final int MAX_RESULT_CHARS = 16000;
    private final LinkedHashMap<String, Entry> entries = new LinkedHashMap<>();
    private long revision;
    private boolean closed;

    private static final class Entry {
        final String stage, snapshot;
        Entry(String stage, String snapshot) { this.stage = stage; this.snapshot = snapshot; }
    }

    static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{1,100}"); }

    synchronized void queued(String id) { stage(id, "queued"); }
    synchronized void started(String id) { stage(id, "started"); }

    private void stage(String id, String stage) {
        if (closed || !validId(id)) return;
        Entry previous = entries.get(id);
        if (previous != null && ("terminal".equals(previous.stage)
                || "started".equals(previous.stage) && "queued".equals(stage))) return;
        save(id, stage, null);
    }

    synchronized boolean publish(String id, JSONObject result) {
        if (closed || !validId(id) || result == null) return false;
        Entry previous = entries.get(id);
        if (previous != null && "terminal".equals(previous.stage)) return false;
        String status = result.optString("status", "");
        if (!("available".equals(status) || "current".equals(status)
                || "error".equals(status) || "browser".equals(status))) return false;
        String encoded = result.toString();
        if (encoded == null || encoded.length() > MAX_RESULT_CHARS) {
            encoded = "{\"status\":\"error\",\"message\":\"Răspunsul actualizării nu este valid. Reîncearcă.\"}";
            status = "error";
        }
        save(id, "terminal", encoded);
        return true;
    }

    private void save(String id, String stage, String encoded) {
        String snapshot = "{\"requestId\":" + JSONObject.quote(id) + ",\"stage\":" + JSONObject.quote(stage)
            + ",\"revision\":" + (++revision) + (encoded == null ? "" : ",\"result\":" + encoded) + "}";
        entries.put(id, new Entry(stage, snapshot));
        while (entries.size() > MAX_REQUESTS) {
            String oldest = entries.keySet().iterator().next();
            entries.remove(oldest);
        }
    }

    synchronized boolean isTerminal(String id) {
        Entry entry = entries.get(id);
        return entry != null && "terminal".equals(entry.stage);
    }

    synchronized String read(String id) {
        if (closed || !validId(id)) return "";
        Entry entry = entries.get(id);
        return entry == null ? "" : entry.snapshot;
    }

    synchronized void close() { closed = true; entries.clear(); }
}
