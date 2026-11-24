package ro.caiuspoputa.agendasalon;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import java.util.Collections;

/** A user-named home shortcut; the installed package, activation and stores are unchanged. */
final class LauncherShortcut {
    static final String ID = "salon-personal-home";
    static String name(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty() || value.length() > 60 || value.matches("(?s).*\\p{C}.*"))
            throw new IllegalArgumentException("Invalid shortcut name");
        return value;
    }

    static void syncExisting(Activity activity, String input) {
        try {
            String label = name(input);
            ShortcutManager manager = activity.getSystemService(ShortcutManager.class);
            if (manager == null) return;
            for (ShortcutInfo pinned : manager.getPinnedShortcuts()) {
                if (ID.equals(pinned.getId()) && !label.contentEquals(pinned.getShortLabel())) {
                    // Update the existing pin only; never create another icon during startup or HA sync.
                    manager.updateShortcuts(Collections.singletonList(new ShortcutInfo.Builder(activity, ID)
                        .setShortLabel(label).setLongLabel(label).build()));
                    return;
                }
            }
        } catch (RuntimeException ignored) { /* A launcher restriction must not interrupt the agenda. */ }
    }

    static String request(Activity activity, String input) {
        final String label;
        try { label = name(input); }
        catch (IllegalArgumentException invalid) { return "Scrie un nume de 1–60 de caractere, fără rânduri noi."; }
        try {
            ShortcutManager manager = activity.getSystemService(ShortcutManager.class);
            if (manager == null) return "Ecranul principal nu permite personalizarea scurtăturii.";
            ShortcutInfo shortcut = new ShortcutInfo.Builder(activity, ID)
                .setActivity(new ComponentName(activity, MainActivity.class))
                .setShortLabel(label).setLongLabel(label)
                .setIcon(Icon.createWithResource(activity, R.mipmap.ic_launcher))
                .setIntent(new Intent(activity, MainActivity.class).setAction(Intent.ACTION_VIEW))
                .build();
            for (ShortcutInfo pinned : manager.getPinnedShortcuts()) {
                if (ID.equals(pinned.getId())) {
                    return manager.updateShortcuts(Collections.singletonList(shortcut))
                        ? "Numele scurtăturii de pe ecranul principal a fost actualizat."
                        : "Numele nu a putut fi actualizat acum. Reîncearcă peste câteva momente.";
                }
            }
            if (!manager.isRequestPinShortcutSupported())
                return "Ecranul principal nu permite adăugarea scurtăturii din aplicație.";
            return manager.requestPinShortcut(shortcut, null)
                ? "Confirmă adăugarea scurtăturii în fereastra Android."
                : "Scurtătura nu a putut fi solicitată. Reîncearcă din ecranul principal.";
        } catch (RuntimeException unavailable) {
            return "Scurtătura nu a putut fi actualizată. Numele din aplicație și agenda sunt păstrate.";
        }
    }
}
