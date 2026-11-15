package com.shifter.driver.activity;

import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.widget.SwitchCompat;
import androidx.core.app.NotificationManagerCompat;

import com.shifter.driver.R;
import com.shifter.driver.utility.OfflineAlerts;

/**
 * Offline Alerts settings: the ON/OFF switch and how many minutes apart the "You are offline" reminders come.
 * Nothing is applied until Save (the switch on My Account applies at once); both end up in {@link OfflineAlerts}.
 */
public class OfflineAlertsActivity extends LocaleAwareActivity {
    private static final int TEXT_DARK = Color.rgb(15, 23, 42);
    private static final int TEXT_MUTED = Color.rgb(100, 116, 139);
    private static final int ORANGE = Color.parseColor("#FF5E1E");

    private SwitchCompat toggle;
    private EditText minutes;

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(null, Typeface.BOLD);
        return t;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setFitsSystemWindows(true);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(20), dp(20), dp(28));
        scroll.addView(content);
        setContentView(scroll);

        content.addView(text(getString(R.string.offline_alerts_title), 22, TEXT_DARK, true));
        content.addView(text(getString(R.string.offline_alerts_subtitle), 13, TEXT_MUTED, false));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(20), 0, dp(8));
        row.addView(text(getString(R.string.offline_alerts_title), 16, TEXT_DARK, true),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        toggle = new SwitchCompat(this);
        row.addView(toggle);
        content.addView(row);

        TextView label = text(getString(R.string.offline_alerts_interval_label), 14, TEXT_DARK, true);
        label.setPadding(0, dp(14), 0, dp(6));
        content.addView(label);
        minutes = new EditText(this);
        minutes.setInputType(InputType.TYPE_CLASS_NUMBER);
        minutes.setFilters(new InputFilter[]{new InputFilter.LengthFilter(4)});
        minutes.setHint(R.string.offline_alerts_interval_hint);
        minutes.setSingleLine(true);
        content.addView(minutes);

        TextView info = text(getString(R.string.offline_alerts_info), 12, TEXT_MUTED, false);
        info.setPadding(0, dp(12), 0, dp(20));
        content.addView(info);

        Button save = new Button(this);
        save.setText(R.string.offline_alerts_save);
        save.setAllCaps(false);
        save.setTextColor(Color.WHITE);
        save.setBackgroundColor(ORANGE);
        save.setOnClickListener(v -> save());
        content.addView(save, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

        load();
    }

    private void load() {
        toggle.setChecked(OfflineAlerts.isEnabled(this));
        minutes.setText(String.valueOf(OfflineAlerts.intervalMinutes(this)));
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The switch on My Account may have changed while this page was in the background.
        if (toggle != null && toggle.isChecked() != OfflineAlerts.isEnabled(this) && !minutes.hasFocus()) load();
    }

    private void save() {
        int value;
        try {
            value = Integer.parseInt(minutes.getText().toString().trim());
        } catch (NumberFormatException e) {
            value = -1;
        }
        if (!OfflineAlerts.isValidInterval(value)) {
            minutes.setError(getString(R.string.offline_alerts_invalid));
            return;
        }
        boolean on = toggle.isChecked();
        OfflineAlerts.save(this, on, value);
        if (on && Build.VERSION.SDK_INT >= 33 && !NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 5301);
            Toast.makeText(this, R.string.offline_alerts_notifications_off, Toast.LENGTH_LONG).show();
        } else if (on && !NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            Toast.makeText(this, R.string.offline_alerts_notifications_off, Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, R.string.offline_alerts_saved, Toast.LENGTH_SHORT).show();
        }
        View v = getCurrentFocus();
        if (v != null) v.clearFocus();
    }
}
