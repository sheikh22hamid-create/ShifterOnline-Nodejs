package com.shifter.driver.activity;

import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.socket.NodeSocketManager;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

/**
 * Low Fare Orders (spec 2026-10-27): next-day orders open to this driver between the customer's window start and end.
 * Like Scheduled Trips there is no popup: the Home button carries an unread badge and this list is where an order is
 * accepted. Opening the list marks what it shows as seen (the badge then drops), exactly like opening a chat. The list
 * is the server's own view (open window, this vehicle, not cancelled by this driver), so what is shown can be accepted;
 * if another driver wins the race the server answers "Already Attended" and the card disappears on refresh.
 */
public class LowFareOrderListActivity extends LocaleAwareActivity implements GetResult.MyListener, NodeSocketManager.LowFareListener {

    private static final String CALL_LIST = "list";
    private static final String CALL_SEEN = "seen";
    private static final String CALL_ACCEPT = "accept";
    private static final long REFRESH_MS = 15000;

    private static final int GREEN = Color.parseColor("#1B8A5A");

    private SessionManager sessionManager;
    private RiderData riderData;
    private SwipeRefreshLayout refresh;
    private LinearLayout list;
    private TextView countText;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            fetch();
            handler.postDelayed(this, REFRESH_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        setContentView(buildRoot());
    }

    @Override
    protected void onResume() {
        super.onResume();
        NodeSocketManager.getInstance().addLowFareListener(this);
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        NodeSocketManager.getInstance().removeLowFareListener(this);
        handler.removeCallbacks(ticker);
    }

    // --- UI scaffolding ---------------------------------------------------------------------------------------------

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private View buildRoot() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#F4F6FB"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(GREEN);
        bar.setPadding(dp(16), dp(14), dp(16), dp(14));
        TextView back = text("‹", 26, Color.WHITE, true);
        back.setPadding(0, 0, dp(14), 0);
        back.setOnClickListener(v -> onBackPressed());
        bar.addView(back);
        bar.addView(text("Low Fare Order", 18, Color.WHITE, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        countText = text("", 13, Color.WHITE, true);
        bar.addView(countText);
        root.addView(bar);

        refresh = new SwipeRefreshLayout(this);
        refresh.setColorSchemeColors(GREEN);
        refresh.setOnRefreshListener(this::fetch);
        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(12), dp(12), dp(12), dp(24));
        scroll.addView(list);
        refresh.addView(scroll);
        root.addView(refresh, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private GradientDrawable box(int fill, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    // --- data -------------------------------------------------------------------------------------------------------

    private JSONObject body() {
        JSONObject o = new JSONObject();
        try {
            o.put("rider_id", riderData != null ? riderData.getId() : 0);
        } catch (JSONException ignored) {
        }
        return o;
    }

    private RequestBody json(JSONObject o) {
        return RequestBody.create(MediaType.parse("application/json"), o.toString());
    }

    private void send(Call<JsonObject> call, String callNo) {
        GetResult result = new GetResult();
        result.setMyListener(this);
        result.callForLogin(call, callNo);
    }

    private void fetch() {
        send(NodeApiClient.getInterface().lowFareList(json(body())), CALL_LIST);
    }

    @Override
    public void onLowFareEvent(String event, JSONObject data) {
        fetch();
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        refresh.setRefreshing(false);
        boolean ok = result.has("Result") && result.get("Result").getAsBoolean();
        String msg = result.has("msg") && !result.get("msg").isJsonNull() ? result.get("msg").getAsString() : "";
        if (CALL_SEEN.equals(callNo)) return;
        if (CALL_LIST.equals(callNo)) {
            render(ok, msg, ok ? result.getAsJsonArray("orders") : null);
            return;
        }
        // accept
        if (ok) {
            Toast.makeText(this, "Order accepted. It is now in your active order.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        Toast.makeText(this, !msg.isEmpty() ? msg : "Something went wrong. Please try again.", Toast.LENGTH_LONG).show();
        fetch();
    }

    private void render(boolean ok, String msg, JsonArray orders) {
        list.removeAllViews();
        if (!ok) {
            list.addView(text(msg.isEmpty() ? "Low Fare Orders are not available right now." : msg, 14, Color.DKGRAY, false));
            countText.setText("");
            return;
        }
        int available = 0;
        for (JsonElement e : orders) if (!"taken".equals(s(e.getAsJsonObject(), "state"))) available++;
        countText.setText(available + " available");
        if (orders.size() == 0) {
            TextView empty = text("No Low Fare Orders right now.\nNext-day orders appear here during their time window.", 14, Color.GRAY, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dp(80), 0, 0);
            list.addView(empty);
            return;
        }
        JSONArray unreadIds = new JSONArray();
        for (JsonElement e : orders) {
            JsonObject o = e.getAsJsonObject();
            list.addView(card(o));
            if (o.has("unread") && o.get("unread").getAsBoolean() && !"taken".equals(s(o, "state"))) unreadIds.put(o.get("id").getAsInt());
        }
        if (unreadIds.length() > 0) {
            // The cards above still carry their NEW tag; the server now counts these as seen, so the Home badge drops.
            JSONObject b = body();
            try {
                b.put("order_ids", unreadIds);
            } catch (JSONException ignored) {
            }
            send(NodeApiClient.getInterface().lowFareSeen(json(b)), CALL_SEEN);
        }
    }

    // --- one order card -----------------------------------------------------------------------------------------------

    private String s(JsonObject o, String key) {
        return o != null && o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }

    private void row(LinearLayout parent, String label, String value) {
        if (value == null || value.trim().isEmpty() || "null".equals(value)) return;
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, dp(2), 0, dp(2));
        r.addView(text(label, 12, Color.GRAY, false), new LinearLayout.LayoutParams(dp(96), ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(text(value, 13, Color.BLACK, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        parent.addView(r);
    }

    /** Server times are UTC instants; the customer's window is an IST wall clock, so show it in IST. */
    private String istTime(String iso) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = in.parse(iso.length() > 19 ? iso.substring(0, 19) : iso);
            SimpleDateFormat out = new SimpleDateFormat("hh:mm a", Locale.getDefault());
            out.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
            return out.format(d);
        } catch (Exception e) {
            return iso;
        }
    }

    private String money(String raw) {
        try {
            double v = Double.parseDouble(raw);
            return v == Math.rint(v) ? String.valueOf((long) v) : String.format(Locale.US, "%.2f", v);
        } catch (Exception e) {
            return raw;
        }
    }

    private View card(JsonObject o) {
        final String orderId = s(o, "id");
        final String fare = money(s(o, "total_dcharge"));
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(box(Color.WHITE, 14));
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(12);
        card.setLayoutParams(lp);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.addView(text("Order #" + orderId + "   ·   " + s(o, "category"), 14, Color.BLACK, true), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (o.has("unread") && o.get("unread").getAsBoolean() && !"taken".equals(s(o, "state"))) {
            TextView tag = text("NEW", 11, Color.WHITE, true);
            tag.setBackground(box(Color.parseColor("#E53935"), 8));
            tag.setPadding(dp(8), dp(2), dp(8), dp(2));
            head.addView(tag);
        }
        card.addView(head);

        // An order another driver holds arrives as a status line only (no fare, address or goods).
        if ("taken".equals(s(o, "state"))) {
            TextView taken = text("Already Attended", 14, Color.WHITE, true);
            taken.setGravity(Gravity.CENTER);
            taken.setBackground(box(Color.parseColor("#9E9E9E"), 10));
            taken.setPadding(dp(12), dp(10), dp(12), dp(10));
            LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            tp.topMargin = dp(8);
            card.addView(taken, tp);
            return card;
        }

        TextView price = text("Fare  ₹" + fare, 20, Color.WHITE, true);
        price.setBackground(box(GREEN, 10));
        price.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pp.topMargin = dp(8);
        card.addView(price, pp);
        String model1 = s(o, "next_day_model1_fare");
        if (!model1.isEmpty()) {
            card.addView(text("Model 1 ₹" + money(model1) + ", " + money(s(o, "next_day_discount_percent")) + "% customer discount", 12, Color.GRAY, false));
        }

        LinearLayout details = new LinearLayout(this);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setPadding(0, dp(8), 0, 0);
        row(details, "Date", s(o, "schedule_date_time"));
        row(details, "Pickup between", istTime(s(o, "next_day_live_at")) + " - " + istTime(s(o, "next_day_live_until")));
        row(details, "Pickup", s(o, "paddress"));
        row(details, "Drop", s(o, "daddress"));
        row(details, "Distance", s(o, "distance").isEmpty() ? "" : money(s(o, "distance")) + " km");
        row(details, "Goods", s(o, "description"));
        row(details, "Weight", s(o, "package_weight").isEmpty() ? "" : money(s(o, "package_weight")) + " kg");
        card.addView(details);
        // The server decides what can be done: upcoming = details only, open = can accept.
        boolean canAccept = o.has("can_accept") && o.get("can_accept").getAsBoolean();
        if (!canAccept) {
            card.addView(text("Opens at " + istTime(s(o, "next_day_live_at")) + ". You can accept it from then until " + istTime(s(o, "next_day_live_until")) + ".", 12, Color.parseColor("#B26A00"), true));
            return card;
        }
        card.addView(text("Open to accept until " + istTime(s(o, "next_day_live_until")), 12, Color.parseColor("#B26A00"), true));

        Button accept = new Button(this);
        accept.setAllCaps(false);
        accept.setText("Accept ₹" + fare);
        accept.setTextSize(14);
        accept.setTextColor(Color.WHITE);
        accept.setBackground(box(GREEN, 10));
        accept.setOnClickListener(v -> confirmAccept(orderId, fare));
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        ap.topMargin = dp(12);
        card.addView(accept, ap);
        return card;
    }

    // --- actions ----------------------------------------------------------------------------------------------------

    private void confirmAccept(String orderId, String fare) {
        new AlertDialog.Builder(this)
                .setTitle("Accept order #" + orderId + " at ₹" + fare + "?")
                .setMessage("You will be assigned this next-day job. If you cancel later, the usual cancellation charge applies.")
                .setPositiveButton("Accept", (d, w) -> {
                    JSONObject b = body();
                    try {
                        b.put("order_id", Integer.parseInt(orderId));
                    } catch (JSONException | NumberFormatException ignored) {
                    }
                    send(NodeApiClient.getInterface().lowFareAccept(json(b)), CALL_ACCEPT);
                })
                .setNegativeButton("Not now", null)
                .show();
    }
}
