package com.shifter.driver.activity;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.gms.maps.*;
import com.google.android.gms.maps.model.*;
import com.google.gson.*;
import com.shifter.driver.R;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.utility.FavoriteRouteClient;
import com.shifter.driver.utility.ProfileScreenInsets;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Server-owned saved routes; drafts never change active matching until saved.
 * Elevated with modern, polished UI/UX matching Shifter design system standards.
 */
public class FavoriteRoutesActivity extends AppCompatActivity {
    private static final int TEXT_DARK = Color.rgb(15, 23, 42);
    private static final int TEXT_SECONDARY = Color.rgb(71, 85, 105);
    private static final int TEXT_MUTED = Color.rgb(100, 116, 139);
    private static final int BRAND_ORANGE = Color.parseColor("#FF5E1E");
    private static final int BRAND_ORANGE_DARK = Color.parseColor("#C2410C");
    private static final int STATUS_ACTIVE_GREEN = Color.parseColor("#059669");

    private ScrollView scroll;
    private LinearLayout root, content, pointList;
    private TextView message, previewText, headerTitle, headerSubtitle;
    private ImageView headerBack, headerRefresh;
    private EditText name;
    private Spinner mode, expiry;
    private CheckBox forward;
    private SeekBar radius;
    private MapView mapView;
    private GoogleMap map;
    private JsonObject config, selected, preview;
    private JsonArray routes = new JsonArray();
    private final ArrayList<JsonObject> points = new ArrayList<>();
    private int activeId, draftVersion;
    private boolean busy, editing;
    private final ExecutorService searchWorker = Executors.newSingleThreadExecutor();

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_LONG).show();
    }

    private boolean alive() {
        return !isFinishing() && !isDestroyed();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);
        setContentView(root);

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            androidx.core.graphics.Insets safe = insets.getInsets(
                    androidx.core.view.WindowInsetsCompat.Type.systemBars()
                            | androidx.core.view.WindowInsetsCompat.Type.displayCutout());
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return androidx.core.view.WindowInsetsCompat.CONSUMED;
        });

        // Modern Top App Bar
        RelativeLayout header = new RelativeLayout(this);
        header.setBackgroundColor(Color.WHITE);
        header.setElevation(dp(2));
        header.setPadding(dp(8), dp(6), dp(12), dp(6));
        header.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        headerBack = new ImageView(this);
        headerBack.setId(View.generateViewId());
        headerBack.setImageResource(R.drawable.ic_arrow_back);
        headerBack.setColorFilter(TEXT_DARK);
        headerBack.setBackgroundResource(R.drawable.bg_circle_light);
        headerBack.setPadding(dp(10), dp(10), dp(10), dp(10));
        RelativeLayout.LayoutParams backLp = new RelativeLayout.LayoutParams(dp(44), dp(44));
        backLp.addRule(RelativeLayout.ALIGN_PARENT_START);
        backLp.addRule(RelativeLayout.CENTER_VERTICAL);
        headerBack.setLayoutParams(backLp);
        headerBack.setOnClickListener(v -> {
            if (editing) confirmLeave();
            else finish();
        });
        header.addView(headerBack);

        LinearLayout titleCol = new LinearLayout(this);
        titleCol.setOrientation(LinearLayout.VERTICAL);
        RelativeLayout.LayoutParams titleLp = new RelativeLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleLp.addRule(RelativeLayout.RIGHT_OF, headerBack.getId());
        titleLp.addRule(RelativeLayout.CENTER_VERTICAL);
        titleLp.leftMargin = dp(8);
        titleCol.setLayoutParams(titleLp);

        headerTitle = new TextView(this);
        headerTitle.setText("Favorite Routes");
        headerTitle.setTextSize(17.5f);
        headerTitle.setTextColor(TEXT_DARK);
        headerTitle.setTypeface(null, Typeface.BOLD);
        titleCol.addView(headerTitle);

        headerSubtitle = new TextView(this);
        headerSubtitle.setText("Smart Corridor Dispatch");
        headerSubtitle.setTextSize(11.5f);
        headerSubtitle.setTextColor(TEXT_MUTED);
        titleCol.addView(headerSubtitle);
        header.addView(titleCol);

        headerRefresh = new ImageView(this);
        headerRefresh.setImageResource(R.drawable.ic_refresh);
        headerRefresh.setColorFilter(TEXT_DARK);
        headerRefresh.setBackgroundResource(R.drawable.bg_circle_light);
        headerRefresh.setPadding(dp(10), dp(10), dp(10), dp(10));
        RelativeLayout.LayoutParams refreshLp = new RelativeLayout.LayoutParams(dp(42), dp(42));
        refreshLp.addRule(RelativeLayout.ALIGN_PARENT_END);
        refreshLp.addRule(RelativeLayout.CENTER_VERTICAL);
        headerRefresh.setLayoutParams(refreshLp);
        headerRefresh.setOnClickListener(v -> {
            if (!busy) load(null);
        });
        header.addView(headerRefresh);

        root.addView(header);

        // Dynamic status/message banner
        message = banner("Loading saved routes…", R.drawable.bg_badge_schedule_time, BRAND_ORANGE_DARK);
        message.setVisibility(View.VISIBLE);
        LinearLayout.LayoutParams msgLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        msgLp.setMargins(dp(14), dp(8), dp(14), dp(4));
        message.setLayoutParams(msgLp);
        root.addView(message);

        scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.parseColor("#F8F9FA"));

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), dp(6), dp(14), dp(24));
        scroll.addView(content);

        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        load(state == null ? null : state.getString("draft"));
    }

    private TextView text(String value, int size) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(TEXT_DARK);
        t.setPadding(0, dp(4), 0, dp(2));
        return t;
    }

    private TextView subtext(String value) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(12.5f);
        t.setTextColor(TEXT_MUTED);
        t.setPadding(0, 0, 0, dp(2));
        return t;
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private Button styledButton(String label, int background, int textColor, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(textColor);
        b.setTextSize(13.5f);
        b.setTypeface(null, Typeface.BOLD);
        b.setBackgroundResource(background);
        b.setPadding(dp(16), dp(9), dp(16), dp(9));
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(dp(40));
        b.setMinimumHeight(dp(40));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(8));
        lp.topMargin = dp(4);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> {
            if (!busy) action.run();
        });
        return b;
    }

    private Button button(String label, Runnable action) {
        return styledButton(label, R.drawable.bg_btn_cancel_light, TEXT_DARK, action);
    }

    private Button primaryButton(String label, Runnable action) {
        return styledButton(label, R.drawable.bg_btn_shifter_orange, Color.WHITE, action);
    }

    private Button dangerButton(String label, Runnable action) {
        return styledButton(label, R.drawable.bg_btn_reject_themed, Color.parseColor("#B91C1C"), action);
    }

    private TextView banner(String value, int background, int textColor) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(textColor);
        t.setTextSize(12.5f);
        t.setTypeface(null, Typeface.NORMAL);
        t.setBackgroundResource(background);
        t.setPadding(dp(14), dp(10), dp(14), dp(10));
        t.setLineSpacing(dp(2), 1f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(4);
        lp.bottomMargin = dp(4);
        t.setLayoutParams(lp);
        return t;
    }

    private TextView badge(String value, int background, int textColor) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextColor(textColor);
        t.setTextSize(11.5f);
        t.setTypeface(null, Typeface.BOLD);
        t.setBackgroundResource(background);
        t.setPadding(dp(10), dp(3), dp(10), dp(3));
        return t;
    }

    private View createChip(String text, int iconRes) {
        LinearLayout chip = new LinearLayout(this);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setBackgroundResource(R.drawable.bg_route_chip);
        chip.setPadding(dp(8), dp(4), dp(8), dp(4));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(6));
        lp.bottomMargin = dp(4);
        chip.setLayoutParams(lp);

        if (iconRes != 0) {
            ImageView icon = new ImageView(this);
            icon.setImageResource(iconRes);
            icon.setColorFilter(TEXT_MUTED);
            LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(12), dp(12));
            iconLp.setMarginEnd(dp(4));
            chip.addView(icon, iconLp);
        }

        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextSize(11.5f);
        tv.setTextColor(TEXT_SECONDARY);
        tv.setTypeface(null, Typeface.BOLD);
        chip.addView(tv);
        return chip;
    }

    private void request(String action, JsonObject body, FavoriteRouteClient.Listener next) {
        if (busy) return;
        busy = true;
        message.setText("Please wait…");
        message.setBackgroundResource(R.drawable.bg_badge_schedule_time);
        message.setTextColor(BRAND_ORANGE_DARK);
        message.setVisibility(View.VISIBLE);

        FavoriteRouteClient.request(this, action, body, (data, error) -> {
            if (!alive()) return;
            busy = false;
            if (error != null) {
                message.setText(error);
                message.setBackgroundResource(R.drawable.bg_badge_rejected);
                message.setTextColor(Color.parseColor("#B91C1C"));
                message.setVisibility(View.VISIBLE);
                return;
            }
            message.setVisibility(View.GONE);
            next.done(data, null);
        });
    }

    private void load(String draft) {
        request("list", null, (data, error) -> {
            config = data.getAsJsonObject("config");
            routes = data.getAsJsonArray("routes");
            activeId = data.get("active_route_id").isJsonNull() ? 0 : data.get("active_route_id").getAsInt();
            if (draft != null) {
                try {
                    edit(new Gson().fromJson(draft, JsonObject.class));
                    return;
                } catch (Exception ignored) {}
            }
            showList();
        });
    }

    public static long parseDate(String value) throws java.text.ParseException {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.parse(value).getTime();
    }

    private String formatDate(long value) {
        java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(value));
    }

    private boolean expired(JsonObject r) {
        try {
            return r.has("expires_at") && !r.get("expires_at").isJsonNull()
                    && parseDate(r.get("expires_at").getAsString()) <= System.currentTimeMillis();
        } catch (Exception e) {
            return true;
        }
    }

    private void destroyMap() {
        if (mapView != null) {
            mapView.onPause();
            mapView.onStop();
            mapView.onDestroy();
            mapView = null;
            map = null;
        }
    }

    private void showList() {
        editing = false;
        destroyMap();
        content.removeAllViews();
        headerTitle.setText("Favorite Routes");
        headerSubtitle.setText("Smart Corridor Dispatch");
        headerRefresh.setVisibility(View.VISIBLE);

        boolean enabled = config != null && config.get("enabled").getAsBoolean();
        if (!enabled) {
            TextView disabledBanner = banner(
                    "Favorite Routes is currently turned off for your city. Ask support/admin to enable it. Normal order requests continue as usual.",
                    R.drawable.bg_badge_pending, Color.parseColor("#92400E"));
            content.addView(disabledBanner);
        } else {
            // Informational Hero Card
            LinearLayout infoCard = new LinearLayout(this);
            infoCard.setOrientation(LinearLayout.HORIZONTAL);
            infoCard.setGravity(Gravity.CENTER_VERTICAL);
            infoCard.setBackgroundResource(R.drawable.bg_info_banner_soft);
            infoCard.setPadding(dp(12), dp(10), dp(12), dp(10));
            LinearLayout.LayoutParams icp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            icp.bottomMargin = dp(10);
            infoCard.setLayoutParams(icp);

            ImageView infoIcon = new ImageView(this);
            infoIcon.setImageResource(R.drawable.ic_route);
            infoIcon.setColorFilter(BRAND_ORANGE);
            infoIcon.setBackgroundResource(R.drawable.bg_badge_schedule_time);
            infoIcon.setPadding(dp(6), dp(6), dp(6), dp(6));
            infoCard.addView(infoIcon, new LinearLayout.LayoutParams(dp(30), dp(30)));

            LinearLayout infoTextCol = new LinearLayout(this);
            infoTextCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams itLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            itLp.leftMargin = dp(10);
            itLp.setMarginStart(dp(10));
            infoTextCol.setLayoutParams(itLp);

            TextView infoHead = new TextView(this);
            infoHead.setText("Preferred Corridor Dispatch");
            infoHead.setTextColor(BRAND_ORANGE_DARK);
            infoHead.setTextSize(12.5f);
            infoHead.setTypeface(null, Typeface.BOLD);
            infoTextCol.addView(infoHead);

            TextView infoDesc = new TextView(this);
            infoDesc.setText("Orders along your saved road corridor are prioritized to you. Ideal for return trips home.");
            infoDesc.setTextColor(TEXT_MUTED);
            infoDesc.setTextSize(11.5f);
            infoDesc.setLineSpacing(dp(1), 1f);
            infoTextCol.addView(infoDesc);
            infoCard.addView(infoTextCol);

            content.addView(infoCard);
        }

        // Top Action Bar
        LinearLayout actionsRow = row();
        actionsRow.setPadding(0, 0, 0, dp(6));
        Button add = primaryButton("+ Create New Route", () -> edit(null));
        add.setEnabled(enabled);
        add.setAlpha(enabled ? 1f : 0.45f);
        actionsRow.addView(add);

        Button refreshBtn = button("Refresh", () -> load(null));
        actionsRow.addView(refreshBtn);
        content.addView(actionsRow);

        // Empty state
        if (routes.size() == 0) {
            LinearLayout empty = new LinearLayout(this);
            empty.setOrientation(LinearLayout.VERTICAL);
            empty.setGravity(Gravity.CENTER_HORIZONTAL);
            empty.setBackgroundResource(R.drawable.bg_card_white);
            empty.setElevation(dp(1));
            empty.setPadding(dp(20), dp(32), dp(20), dp(32));
            LinearLayout.LayoutParams ep = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            ep.topMargin = dp(14);
            content.addView(empty, ep);

            ImageView emptyIcon = new ImageView(this);
            emptyIcon.setImageResource(R.drawable.ic_route);
            emptyIcon.setColorFilter(BRAND_ORANGE);
            emptyIcon.setBackgroundResource(R.drawable.bg_badge_schedule_time);
            emptyIcon.setPadding(dp(16), dp(16), dp(16), dp(16));
            empty.addView(emptyIcon, new LinearLayout.LayoutParams(dp(72), dp(72)));

            TextView emptyText = text("No Saved Routes Yet", 17);
            emptyText.setTypeface(null, Typeface.BOLD);
            emptyText.setPadding(0, dp(14), 0, dp(4));
            emptyText.setGravity(Gravity.CENTER);
            empty.addView(emptyText);

            TextView emptySub = subtext("Save regular routes like your journey towards home, warehouse return, or daily highway commute to receive orders along the way.");
            emptySub.setGravity(Gravity.CENTER);
            emptySub.setLineSpacing(dp(2), 1f);
            emptySub.setPadding(dp(10), 0, dp(10), dp(16));
            empty.addView(emptySub);

            Button emptyCreate = primaryButton("+ Create Route", () -> edit(null));
            emptyCreate.setEnabled(enabled);
            empty.addView(emptyCreate);
        }

        // List of routes
        for (JsonElement element : routes) {
            JsonObject route = element.getAsJsonObject();
            boolean disabled = route.get("disabled").getAsBoolean();
            boolean active = route.get("id").getAsInt() == activeId && !disabled && !expired(route);

            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setPadding(dp(14), dp(14), dp(14), dp(14));
            card.setBackgroundResource(active ? R.drawable.bg_card_selectable : R.drawable.bg_card_white);
            card.setElevation(dp(1));
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            cp.topMargin = dp(12);
            content.addView(card, cp);

            // Active indicator pill if currently running
            if (active) {
                LinearLayout activeStrip = new LinearLayout(this);
                activeStrip.setOrientation(LinearLayout.HORIZONTAL);
                activeStrip.setGravity(Gravity.CENTER_VERTICAL);
                activeStrip.setBackgroundResource(R.drawable.bg_badge_emerald);
                activeStrip.setPadding(dp(8), dp(3), dp(8), dp(3));
                LinearLayout.LayoutParams asLp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                asLp.bottomMargin = dp(8);
                activeStrip.setLayoutParams(asLp);

                TextView asTv = new TextView(this);
                asTv.setText("⚡ LIVE CORRIDOR MATCHING ACTIVE");
                asTv.setTextColor(STATUS_ACTIVE_GREEN);
                asTv.setTextSize(11f);
                asTv.setTypeface(null, Typeface.BOLD);
                activeStrip.addView(asTv);
                card.addView(activeStrip);
            }

            // Card Header
            LinearLayout headRow = row();
            ImageView iconBadge = new ImageView(this);
            iconBadge.setImageResource(R.drawable.ic_route);
            iconBadge.setColorFilter(active ? BRAND_ORANGE : TEXT_MUTED);
            iconBadge.setBackgroundResource(active ? R.drawable.bg_badge_schedule_time : R.drawable.bg_route_chip);
            iconBadge.setPadding(dp(6), dp(6), dp(6), dp(6));
            headRow.addView(iconBadge, new LinearLayout.LayoutParams(dp(28), dp(28)));

            TextView heading = text(route.get("name").getAsString(), 17);
            heading.setTypeface(null, Typeface.BOLD);
            heading.setPadding(dp(8), 0, dp(4), 0);
            headRow.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            String statusLabel = disabled ? "Disabled" : expired(route) ? "Expired" : active ? "● Active" : "Paused";
            int statusBg = disabled ? R.drawable.bg_badge_rejected : expired(route) ? R.drawable.bg_badge_expired : active ? R.drawable.bg_badge_emerald : R.drawable.bg_badge_pending;
            int statusColor = disabled ? Color.parseColor("#B91C1C") : expired(route) ? Color.parseColor("#475569") : active ? STATUS_ACTIVE_GREEN : Color.parseColor("#92400E");
            headRow.addView(badge(statusLabel, statusBg, statusColor));
            card.addView(headRow);

            // Metric Chips Row
            LinearLayout chips = row();
            chips.setPadding(0, dp(8), 0, dp(2));

            double distKm = route.get("distance_km").getAsDouble();
            int durMin = route.get("duration_seconds").getAsInt() / 60;
            chips.addView(createChip(String.format(Locale.getDefault(), "%.1f km · %d min", distKm, durMin), 0));

            double radKm = route.get("radius_km").getAsDouble();
            chips.addView(createChip(String.format(Locale.getDefault(), "±%.1f km corridor", radKm), 0));

            boolean isOnly = route.get("mode").getAsString().equals("only");
            chips.addView(createChip(isOnly ? "🎯 Route Only" : "⚡ Prefer Route", 0));

            if (route.has("forward_only") && route.get("forward_only").getAsBoolean()) {
                chips.addView(createChip("→ Forward", 0));
            }
            card.addView(chips);

            if (disabled && !route.get("disabled_reason").isJsonNull()) {
                TextView reason = subtext("Notice: " + route.get("disabled_reason").getAsString());
                reason.setTextColor(Color.parseColor("#B91C1C"));
                reason.setTypeface(null, Typeface.BOLD);
                reason.setPadding(0, dp(4), 0, dp(2));
                card.addView(reason);
            }

            View div = new View(this);
            div.setBackgroundColor(Color.parseColor("#F1F5F9"));
            LinearLayout.LayoutParams divLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
            divLp.topMargin = dp(8);
            divLp.bottomMargin = dp(8);
            card.addView(div, divLp);

            // Card Actions
            LinearLayout actions = row();
            Button toggle = active ? dangerButton("Pause", () -> request("pause", route, (d, e) -> load(null)))
                    : primaryButton("⚡ Activate", () -> request("activate", route, (d, e) -> load(null)));
            toggle.setEnabled(active || (enabled && !disabled && !expired(route)));
            toggle.setAlpha(toggle.isEnabled() ? 1f : 0.45f);
            actions.addView(toggle);

            actions.addView(button("View / Edit", () -> edit(route)));
            actions.addView(dangerButton("Delete", () -> new androidx.appcompat.app.AlertDialog.Builder(this)
                    .setTitle("Delete route?")
                    .setMessage("Deleting an active route restores normal order requests.")
                    .setNegativeButton("Keep", null)
                    .setPositiveButton("Delete", (d, w) -> request("delete", route, (result, e) -> load(null)))
                    .show()));
            card.addView(actions);
        }
    }

    private Spinner spinner(String[] values) {
        Spinner s = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, values);
        s.setAdapter(a);
        s.setPadding(dp(12), dp(10), dp(12), dp(10));
        s.setBackgroundResource(R.drawable.bg_input_field_rounded);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(6);
        lp.bottomMargin = dp(8);
        s.setLayoutParams(lp);
        return s;
    }

    private void styleInput(EditText e) {
        e.setBackgroundResource(R.drawable.bg_input_field_rounded);
        e.setPadding(dp(14), dp(11), dp(14), dp(11));
        e.setTextColor(TEXT_DARK);
        e.setTextSize(13.5f);
    }

    private void edit(JsonObject route) {
        editing = true;
        selected = route == null ? null : route.deepCopy();
        preview = null;
        points.clear();
        if (route != null) {
            for (JsonElement p : route.getAsJsonArray("points")) {
                points.add(p.getAsJsonObject().deepCopy());
            }
        }
        destroyMap();
        content.removeAllViews();
        headerTitle.setText(route == null ? "Create Route" : "Edit Route");
        headerSubtitle.setText("Set Waypoints & Preferences");
        headerRefresh.setVisibility(View.GONE);

        message.setText("Tap the map to add points • Drag pins to adjust • Preview road route before saving");
        message.setBackgroundResource(R.drawable.bg_badge_schedule_time);
        message.setTextColor(BRAND_ORANGE_DARK);
        message.setVisibility(View.VISIBLE);

        // Section 1: Route Basics Card
        LinearLayout formCard = new LinearLayout(this);
        formCard.setOrientation(LinearLayout.VERTICAL);
        formCard.setBackgroundResource(R.drawable.bg_card_white);
        formCard.setElevation(dp(1));
        formCard.setPadding(dp(14), dp(14), dp(14), dp(14));
        content.addView(formCard, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView sec1 = text("1. ROUTE INFORMATION", 11);
        sec1.setTypeface(null, Typeface.BOLD);
        sec1.setTextColor(TEXT_MUTED);
        formCard.addView(sec1);

        TextView nameLbl = text("Route Name", 13);
        nameLbl.setTypeface(null, Typeface.BOLD);
        formCard.addView(nameLbl);

        name = new EditText(this);
        name.setSingleLine(true);
        name.setHint("e.g. Home Journey, NH-8 Corridor");
        styleInput(name);
        name.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(80)});
        if (route != null) name.setText(route.get("name").getAsString());
        formCard.addView(name);

        TextView searchLbl = text("Search & Add Landmark / Area", 13);
        searchLbl.setTypeface(null, Typeface.BOLD);
        searchLbl.setPadding(0, dp(10), 0, dp(2));
        formCard.addView(searchLbl);

        LinearLayout searchRow = row();
        EditText search = new EditText(this);
        search.setSingleLine(true);
        search.setHint("Search area, chowk or landmark");
        styleInput(search);
        searchRow.addView(search, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button searchBtn = primaryButton("Search", () -> search(search.getText().toString()));
        LinearLayout.LayoutParams sbLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sbLp.leftMargin = dp(8);
        searchBtn.setLayoutParams(sbLp);
        searchRow.addView(searchBtn);
        formCard.addView(searchRow);

        Button gpsBtn = button("📍 Add Current Location", () -> {
            Location fix = LocationUpdateService.getLocation();
            if (!fix.hasAccuracy()) {
                toast("Waiting for a fresh GPS location. You can select a point directly on the map.");
                return;
            }
            addPoint(fix.getLatitude(), fix.getLongitude(), "Current location");
        });
        formCard.addView(gpsBtn);

        // Section 2: Interactive Map Card
        LinearLayout mapCard = new LinearLayout(this);
        mapCard.setOrientation(LinearLayout.VERTICAL);
        mapCard.setBackgroundResource(R.drawable.bg_card_white);
        mapCard.setElevation(dp(1));
        mapCard.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams mcp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mcp.topMargin = dp(12);
        content.addView(mapCard, mcp);

        TextView sec2 = text("2. ROUTE MAP & CORRIDOR", 11);
        sec2.setTypeface(null, Typeface.BOLD);
        sec2.setTextColor(TEXT_MUTED);
        mapCard.addView(sec2);

        TextView mapHint = subtext("Tap anywhere on the map to add a point. Drag pins to reposition.");
        mapCard.addView(mapHint);

        mapView = new MapView(this);
        mapView.onCreate(null);
        mapCard.addView(mapView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(280)));
        mapView.onStart();
        mapView.onResume();

        final MapView created = mapView;
        mapView.getMapAsync(googleMap -> {
            if (!alive() || mapView != created) return;
            map = googleMap;
            map.getUiSettings().setZoomControlsEnabled(true);
            map.setOnMapClickListener(p -> {
                if (!busy) addPoint(p.latitude, p.longitude, "");
            });
            map.setOnMarkerDragListener(new GoogleMap.OnMarkerDragListener() {
                public void onMarkerDragStart(Marker m) {}
                public void onMarkerDrag(Marker m) {}
                public void onMarkerDragEnd(Marker m) {
                    Object tag = m.getTag();
                    if (tag instanceof Integer) {
                        int i = (Integer) tag;
                        if (i < points.size()) {
                            points.get(i).addProperty("lat", m.getPosition().latitude);
                            points.get(i).addProperty("lng", m.getPosition().longitude);
                            points.get(i).addProperty("label", "");
                            changed();
                        }
                    }
                }
            });
            mapView.setOnTouchListener((v, event) -> {
                v.getParent().requestDisallowInterceptTouchEvent(true);
                return false;
            });
            if (points.size() > 0) {
                map.moveCamera(CameraUpdateFactory.newLatLngZoom(latLng(points.get(0)), 12));
            } else {
                Location fix = LocationUpdateService.getLocation();
                map.moveCamera(CameraUpdateFactory.newLatLngZoom(
                        fix.hasAccuracy() ? new LatLng(fix.getLatitude(), fix.getLongitude()) : new LatLng(24.65, 76.04), 12));
            }
            draw();
        });

        // Section 3: Waypoint Points List Card
        LinearLayout pointsCard = new LinearLayout(this);
        pointsCard.setOrientation(LinearLayout.VERTICAL);
        pointsCard.setBackgroundResource(R.drawable.bg_card_white);
        pointsCard.setElevation(dp(1));
        pointsCard.setPadding(dp(14), dp(12), dp(14), dp(12));
        LinearLayout.LayoutParams pcp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pcp.topMargin = dp(12);
        content.addView(pointsCard, pcp);

        TextView sec3 = text("3. ROUTE WAYPOINTS", 11);
        sec3.setTypeface(null, Typeface.BOLD);
        sec3.setTextColor(TEXT_MUTED);
        pointsCard.addView(sec3);

        pointList = new LinearLayout(this);
        pointList.setOrientation(LinearLayout.VERTICAL);
        pointsCard.addView(pointList);
        renderPoints();

        LinearLayout controls = row();
        controls.setPadding(0, dp(8), 0, 0);
        controls.addView(button("↔ Reverse Route", () -> {
            Collections.reverse(points);
            changed();
        }));
        controls.addView(button("✕ Clear All", () -> {
            points.clear();
            changed();
        }));
        pointsCard.addView(controls);

        // Section 4: Dispatch Preferences Card
        LinearLayout settingsCard = new LinearLayout(this);
        settingsCard.setOrientation(LinearLayout.VERTICAL);
        settingsCard.setBackgroundResource(R.drawable.bg_card_white);
        settingsCard.setElevation(dp(1));
        settingsCard.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams scp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        scp.topMargin = dp(12);
        content.addView(settingsCard, scp);

        TextView sec4 = text("4. DISPATCH PREFERENCES", 11);
        sec4.setTypeface(null, Typeface.BOLD);
        sec4.setTextColor(TEXT_MUTED);
        settingsCard.addView(sec4);

        int min = config.get("min_radius").getAsInt();
        int max = config.get("max_radius").getAsInt();
        TextView radiusLabel = text("Corridor Coverage", 14);
        radiusLabel.setTypeface(null, Typeface.BOLD);
        settingsCard.addView(radiusLabel);

        radius = new SeekBar(this);
        radius.setMax(max - min);
        int initial = route == null ? config.get("default_radius").getAsInt() : route.get("radius_km").getAsInt();
        radius.setProgress(Math.max(0, initial - min));
        radiusLabel.setText("Coverage Corridor: " + (radius.getProgress() + min) + " km on each side");
        settingsCard.addView(radius);

        radius.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) {
                radiusLabel.setText("Coverage Corridor: " + (p + min) + " km on each side");
                if (user) draw();
            }
            public void onStartTrackingTouch(SeekBar s) {}
            public void onStopTrackingTouch(SeekBar s) {}
        });

        TextView modeLbl = text("Matching Mode", 13);
        modeLbl.setTypeface(null, Typeface.BOLD);
        modeLbl.setPadding(0, dp(8), 0, dp(2));
        settingsCard.addView(modeLbl);

        mode = spinner(config.get("allow_only").getAsBoolean()
                ? new String[]{"Prefer my route (Normal orders also allowed)", "Only my route (Fewer requests, strict corridor)"}
                : new String[]{"Prefer my route (Normal orders also allowed)"});
        if (route != null && route.get("mode").getAsString().equals("only") && mode.getCount() > 1) {
            mode.setSelection(1);
        }
        settingsCard.addView(mode);

        forward = new CheckBox(this);
        forward.setText("Forward direction only (Accept trips heading same way)");
        forward.setTextColor(TEXT_DARK);
        forward.setTextSize(13f);
        forward.setEnabled(config.get("allow_forward").getAsBoolean());
        forward.setChecked(route != null && route.get("forward_only").getAsBoolean());
        settingsCard.addView(forward);

        TextView expLbl = text("Route Active Duration / Expiry", 13);
        expLbl.setTypeface(null, Typeface.BOLD);
        expLbl.setPadding(0, dp(8), 0, dp(2));
        settingsCard.addView(expLbl);

        expiry = spinner(new String[]{
                "Keep existing expiry / until paused",
                "For 2 hours from save",
                "For 8 hours from save",
                "Until end of today",
                "Until paused (no automatic expiry)"
        });
        settingsCard.addView(expiry);

        TextView hint = subtext("Pausing or expiring automatically restores normal broadcast orders. Saving changes keeps the route in its current status.");
        hint.setPadding(0, dp(4), 0, dp(2));
        settingsCard.addView(hint);

        // Section 5: Preview & Save Sticky Bar
        previewText = banner("⚠️ Road route preview required before saving", R.drawable.bg_badge_pending, Color.parseColor("#92400E"));
        content.addView(previewText);

        Button previewBtn = button("🛣 Preview Road Route", () -> {
            JsonObject draft = draft();
            int version = draftVersion;
            request("preview", draft, (data, e) -> {
                if (!editing || version != draftVersion) return;
                preview = data;
                previewText.setBackgroundResource(R.drawable.bg_badge_emerald);
                previewText.setTextColor(STATUS_ACTIVE_GREEN);
                previewText.setText(String.format(Locale.getDefault(),
                        "✓ Road Route: %.1f km • %d min · Complete corridor geometry calculated.",
                        data.get("distance_km").getAsDouble(), data.get("duration_seconds").getAsInt() / 60));
                draw();
                if (map != null) {
                    LatLngBounds.Builder bounds = new LatLngBounds.Builder();
                    for (JsonElement p : data.getAsJsonArray("geometry")) {
                        bounds.include(latLng(p.getAsJsonObject()));
                    }
                    map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), dp(40)));
                }
            });
        });
        LinearLayout.LayoutParams pbLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pbLp.topMargin = dp(6);
        previewBtn.setLayoutParams(pbLp);
        content.addView(previewBtn);

        Button save = primaryButton("✓ Save Route", () -> {
            if (preview == null) {
                toast("Please preview the road route first.");
                return;
            }
            request("save", draft(), (data, e) -> {
                toast("Route saved successfully! Activate it whenever you want.");
                load(null);
            });
        });
        save.setEnabled(config.get("enabled").getAsBoolean() && (route == null || !route.has("disabled") || !route.get("disabled").getAsBoolean()));
        save.setAlpha(save.isEnabled() ? 1f : 0.45f);
        LinearLayout.LayoutParams savelp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        savelp.topMargin = dp(10);
        save.setLayoutParams(savelp);
        content.addView(save);
    }

    private JsonObject draft() {
        JsonObject d = new JsonObject();
        if (selected != null && selected.has("id")) {
            d.add("id", selected.get("id"));
            d.add("version", selected.get("version"));
        }
        d.addProperty("name", name.getText().toString().trim());
        JsonArray ps = new JsonArray();
        for (JsonObject p : points) ps.add(p.deepCopy());
        d.add("points", ps);
        d.addProperty("radius_km", radius.getProgress() + config.get("min_radius").getAsInt());
        d.addProperty("mode", mode.getSelectedItemPosition() == 1 ? "only" : "prefer");
        d.addProperty("forward_only", forward.isChecked());

        int choice = expiry.getSelectedItemPosition();
        if (choice == 0 && selected != null && selected.has("expires_at")) {
            d.add("expires_at", selected.get("expires_at"));
        } else if (choice > 0 && choice < 4) {
            long end = System.currentTimeMillis() + (choice == 1 ? 2 : 8) * 3600000L;
            if (choice == 3) {
                Calendar c = Calendar.getInstance();
                c.add(Calendar.DATE, 1);
                c.set(Calendar.HOUR_OF_DAY, 0);
                c.set(Calendar.MINUTE, 0);
                c.set(Calendar.SECOND, 0);
                c.set(Calendar.MILLISECOND, 0);
                end = c.getTimeInMillis();
            }
            d.addProperty("expires_at", formatDate(end));
        }
        return d;
    }

    private void addPoint(double lat, double lng, String label) {
        if (points.size() >= config.get("max_points").getAsInt()) {
            toast("Maximum route points reached (" + config.get("max_points").getAsInt() + ")");
            return;
        }
        JsonObject p = new JsonObject();
        p.addProperty("lat", lat);
        p.addProperty("lng", lng);
        p.addProperty("label", label);
        points.add(p);
        changed();
        if (map != null) map.animateCamera(CameraUpdateFactory.newLatLng(new LatLng(lat, lng)));
    }

    private LatLng latLng(JsonObject p) {
        return new LatLng(p.get("lat").getAsDouble(), p.get("lng").getAsDouble());
    }

    private void changed() {
        draftVersion++;
        preview = null;
        if (previewText != null) {
            previewText.setBackgroundResource(R.drawable.bg_badge_pending);
            previewText.setTextColor(Color.parseColor("#92400E"));
            previewText.setText("⚠️ Route points modified. Please preview the updated road route.");
        }
        renderPoints();
        draw();
    }

    private void renderPoints() {
        if (pointList == null) return;
        pointList.removeAllViews();
        if (points.isEmpty()) {
            TextView none = subtext("No waypoints added yet. Tap on the map or search to add.");
            none.setPadding(0, dp(6), 0, dp(6));
            pointList.addView(none);
            return;
        }

        for (int i = 0; i < points.size(); i++) {
            final int index = i;
            JsonObject p = points.get(i);
            LinearLayout r = row();
            r.setPadding(0, dp(4), 0, dp(4));

            // Numbered badge
            TextView numBadge = new TextView(this);
            numBadge.setText(String.valueOf(i + 1));
            numBadge.setTextColor(Color.WHITE);
            numBadge.setTextSize(11f);
            numBadge.setTypeface(null, Typeface.BOLD);
            numBadge.setGravity(Gravity.CENTER);
            numBadge.setBackgroundResource(i == 0 ? R.drawable.dot_timeline_pickup : (i == points.size() - 1 ? R.drawable.dot_timeline_drop : R.drawable.bg_btn_shifter_orange));
            LinearLayout.LayoutParams nbLp = new LinearLayout.LayoutParams(dp(22), dp(22));
            nbLp.rightMargin = dp(8);
            numBadge.setLayoutParams(nbLp);
            r.addView(numBadge);

            String label = p.has("label") ? p.get("label").getAsString() : "";
            if (label.isEmpty()) {
                label = String.format(Locale.getDefault(), "Lat: %.4f, Lng: %.4f", p.get("lat").getAsDouble(), p.get("lng").getAsDouble());
            }
            TextView pointText = text(label, 13);
            pointText.setPadding(0, 0, 0, 0);
            pointText.setTextColor(TEXT_DARK);
            r.addView(pointText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            if (i > 0) {
                r.addView(iconMiniButton("↑", () -> {
                    Collections.swap(points, index, index - 1);
                    changed();
                }));
            }
            if (i < points.size() - 1) {
                r.addView(iconMiniButton("↓", () -> {
                    Collections.swap(points, index, index + 1);
                    changed();
                }));
            }
            r.addView(iconMiniButton("✕", () -> {
                points.remove(index);
                changed();
            }));
            pointList.addView(r);
        }
    }

    private Button iconMiniButton(String label, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(TEXT_SECONDARY);
        b.setTextSize(14);
        b.setTypeface(null, Typeface.BOLD);
        b.setBackgroundResource(R.drawable.bg_btn_cancel_light);
        b.setMinWidth(dp(32));
        b.setMinimumWidth(dp(32));
        b.setPadding(0, 0, 0, 0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(32), dp(32));
        lp.setMarginStart(dp(6));
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> {
            if (!busy) action.run();
        });
        return b;
    }

    private void draw() {
        if (map == null) return;
        map.clear();
        for (int i = 0; i < points.size(); i++) {
            Marker marker = map.addMarker(new MarkerOptions()
                    .position(latLng(points.get(i)))
                    .title("Stop " + (i + 1))
                    .draggable(true)
                    .icon(BitmapDescriptorFactory.defaultMarker(i == 0 ? BitmapDescriptorFactory.HUE_GREEN : BitmapDescriptorFactory.HUE_RED)));
            if (marker != null) marker.setTag(i);
        }
        if (preview != null) {
            JsonArray geometry = preview.getAsJsonArray("geometry");
            PolylineOptions line = new PolylineOptions().color(BRAND_ORANGE).width(dp(5));
            int stride = Math.max(1, (int) Math.ceil(geometry.size() / 120.0));
            double km = radius.getProgress() + config.get("min_radius").getAsInt();
            for (int i = 0; i < geometry.size(); i++) {
                LatLng p = latLng(geometry.get(i).getAsJsonObject());
                line.add(p);
                if (i % stride == 0 || i == geometry.size() - 1) {
                    map.addCircle(new CircleOptions()
                            .center(p)
                            .radius(km * 1000)
                            .strokeWidth(0)
                            .fillColor(0x18FF5E1E));
                }
            }
            map.addPolyline(line);
        }
    }

    private void search(String query) {
        if (query.trim().isEmpty()) return;
        message.setText("Searching location…");
        message.setVisibility(View.VISIBLE);
        final int version = draftVersion;
        searchWorker.execute(() -> {
            try {
                List<Address> results = new Geocoder(this, Locale.getDefault()).getFromLocationName(query, 5);
                runOnUiThread(() -> {
                    if (!alive() || !editing || version != draftVersion) return;
                    message.setVisibility(View.GONE);
                    if (results == null || results.isEmpty()) {
                        toast("No location found. Try a nearby landmark or tap directly on the map.");
                        return;
                    }
                    String[] labels = new String[results.size()];
                    for (int i = 0; i < results.size(); i++) {
                        labels[i] = results.get(i).getAddressLine(0);
                    }
                    new androidx.appcompat.app.AlertDialog.Builder(this)
                            .setTitle("Select Route Point")
                            .setItems(labels, (d, index) -> {
                                if (!busy) {
                                    Address a = results.get(index);
                                    addPoint(a.getLatitude(), a.getLongitude(), labels[index]);
                                }
                            }).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (alive()) {
                        message.setText("Search unavailable offline. Select a point on the map.");
                        message.setVisibility(View.VISIBLE);
                    }
                });
            }
        });
    }

    private void confirmLeave() {
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Discard unsaved changes?")
                .setMessage("Your current route edits will be lost.")
                .setNegativeButton("Keep Editing", null)
                .setPositiveButton("Discard", (d, w) -> {
                    if (!busy) showList();
                }).show();
    }

    @Override
    public void onBackPressed() {
        if (busy) return;
        if (editing) confirmLeave();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        if (editing && name != null && expiry != null) {
            out.putString("draft", draft().toString());
        }
        super.onSaveInstanceState(out);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (mapView != null) mapView.onStart();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (mapView != null) mapView.onResume();
    }

    @Override
    protected void onPause() {
        if (mapView != null) mapView.onPause();
        super.onPause();
    }

    @Override
    protected void onStop() {
        if (mapView != null) mapView.onStop();
        super.onStop();
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        if (mapView != null) mapView.onLowMemory();
    }

    @Override
    protected void onDestroy() {
        destroyMap();
        searchWorker.shutdownNow();
        super.onDestroy();
    }
}
