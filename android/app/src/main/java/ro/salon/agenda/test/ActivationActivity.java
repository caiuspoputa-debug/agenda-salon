package ro.salon.agenda.test;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** A valid installation receipt survives app updates and HA configuration changes. */
public final class ActivationActivity extends Activity {
    private static final int BG = Color.rgb(238, 241, 243), INK = Color.rgb(23, 36, 42);
    private static final int ACCENT = Color.rgb(53, 99, 116), MUTED = Color.rgb(91, 106, 114);
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(0, 1, 30L, TimeUnit.SECONDS,
        new SynchronousQueue<Runnable>(), task -> {
            Thread thread = new Thread(task, "salon-activation"); thread.setDaemon(true); return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Future<?> pendingWork;
    private Runnable deadline;
    private ActivationStore.Request request;
    private boolean sending, destroyed, opened;

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + .5f); }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setPadding(0, dp(8), 0, dp(8));
        return view;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (getActionBar() != null) getActionBar().hide();
        if (ActivationStore.ready(this)) { open(); return; }
        render();
    }

    private void open() {
        if (destroyed || opened || !ActivationStore.ready(this)) return;
        opened = true;
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        finish();
    }

    private void render() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setBackgroundColor(BG);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL); body.setGravity(Gravity.CENTER_VERTICAL);
        body.setPadding(dp(28), dp(24), dp(28), dp(24));
        body.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        scroll.addView(body);
        setContentView(scroll);
        body.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(dp(28) + safe.left, dp(24) + safe.top, dp(28) + safe.right, dp(24) + safe.bottom);
            }
            return insets;
        });
        body.requestApplyInsets();
        TextView title = text("Activare Salon", 28, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        body.addView(title);
        body.addView(text("Introdu PIN-ul de activare primit. Îl introduci o singură dată pe acest dispozitiv; activarea se păstrează la actualizări.", 16, MUTED));
        body.addView(text("PIN de activare", 14, INK));
        EditText pin = new EditText(this);
        pin.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin.setFilters(new InputFilter[]{new InputFilter.LengthFilter(12)});
        pin.setSaveEnabled(false);
        pin.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        pin.setTextColor(INK); pin.setHintTextColor(MUTED); pin.setHint("••••••");
        pin.setContentDescription("PIN de activare");
        body.addView(pin, new LinearLayout.LayoutParams(-1, dp(56)));
        Button activate = new Button(this);
        activate.setText("Activează aplicația"); activate.setAllCaps(false); activate.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable();
        background.setColor(ACCENT); background.setCornerRadius(dp(10));
        activate.setBackground(background);
        LinearLayout.LayoutParams actionSize = new LinearLayout.LayoutParams(-1, dp(54));
        actionSize.topMargin = dp(18);
        body.addView(activate, actionSize);
        ProgressBar progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressSize = new LinearLayout.LayoutParams(dp(44), dp(44));
        progressSize.gravity = Gravity.CENTER_HORIZONTAL; progressSize.topMargin = dp(12);
        body.addView(progress, progressSize);
        TextView status = text("Prima activare necesită internet. După activare, agenda poate fi folosită și offline.", 14, MUTED);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(status);
        activate.setOnClickListener(view -> {
            if (sending || destroyed) return;
            final String value = pin.getText().toString();
            pin.setText("");
            if (!value.matches("[0-9]{6,12}")) { status.setText("PIN incorect."); return; }
            sending = true; activate.setEnabled(false); pin.setEnabled(false); progress.setVisibility(View.VISIBLE);
            status.setText("Se verifică PIN-ul…");
            final ActivationStore.Request attempt = new ActivationStore.Request();
            request = attempt;
            deadline = () -> {
                if (destroyed || request != attempt) return;
                request = null; sending = false; attempt.cancel();
                Future<?> pending = pendingWork; pendingWork = null;
                if (pending != null) pending.cancel(true);
                activate.setEnabled(true); pin.setEnabled(true); progress.setVisibility(View.GONE);
                status.setText("Activarea a durat prea mult. Verifică internetul și reîncearcă.");
            };
            handler.postDelayed(deadline, ActivationStore.REQUEST_TIMEOUT_MILLIS);
            try {
                pendingWork = WORKER.submit(() -> {
                    String error = "";
                    try { ActivationStore.activate(getApplicationContext(), value, attempt); }
                    catch (ActivationStore.ActivationException rejected) { error = rejected.getMessage(); }
                    catch (Exception failure) { error = "Activarea nu a reușit. Verifică internetul și reîncearcă."; }
                    final String result = error;
                    runOnUiThread(() -> {
                        if (destroyed || request != attempt) return;
                        if (deadline != null) handler.removeCallbacks(deadline);
                        deadline = null; pendingWork = null;
                        request = null; sending = false; activate.setEnabled(true); pin.setEnabled(true); progress.setVisibility(View.GONE);
                        if (result.isEmpty()) open(); else status.setText(result);
                    });
                });
            } catch (RejectedExecutionException closed) {
                if (deadline != null) handler.removeCallbacks(deadline);
                deadline = null;
                request = null; sending = false; activate.setEnabled(true); pin.setEnabled(true); progress.setVisibility(View.GONE);
                status.setText("Încercarea anterioară se închide. Reîncearcă în câteva secunde.");
            }
        });
    }

    @Override protected void onDestroy() {
        destroyed = true;
        ActivationStore.Request pending = request; request = null;
        if (deadline != null) handler.removeCallbacks(deadline);
        deadline = null;
        if (pending != null) pending.cancel();
        Future<?> work = pendingWork; pendingWork = null;
        if (work != null) work.cancel(true);
        super.onDestroy();
    }
}
