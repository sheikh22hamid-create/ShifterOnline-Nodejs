package com.shifter.driver.activity;

import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
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
import com.shifter.driver.utility.CustomiseBeeper;
import com.shifter.driver.utility.SessionManager;

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
 * Customise Orders open to this driver: the customer's price is shown first and highlighted; the driver can accept
 * it, send their own price, or reject the order. The list is the server's own view (started, unexpired, eligible for
 * this vehicle, not rejected), so what is shown here is what can be acted on. Built in code, not XML, so the long
 * detail cards stay in one place.
 */
public class CustomiseOrderListActivity extends LocaleAwareActivity implements GetResult.MyListener, NodeSocketManager.CustomiseListener {

    private static final String CALL_LIST = "list";
    private static final String CALL_ACCEPT = "accept";
    private static final String CALL_COUNTER = "counter";
    private static final String CALL_DISMISS = "dismiss";
    private static final long REFRESH_MS = 15000;

    private static final int ORANGE = Color.parseColor("#FF6B35");

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
        NodeSocketManager.getInstance().addCustomiseListener(this);
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        NodeSocketManager.getInstance().removeCustomiseListener(this);
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
        bar.setBackgroundColor(ORANGE);
        bar.setPadding(dp(16), dp(14), dp(16), dp(14));
        TextView back = text("‹", 26, Color.WHITE, true);
        back.setPadding(0, 0, dp(14), 0);
        back.setOnClickListener(v -> onBackPressed());
        bar.addView(back);
        TextView title = text("Customise Orders", 18, Color.WHITE, true);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        countText = text("", 13, Color.WHITE, true);
        bar.addView(countText);
        root.addView(bar);

        refresh = new SwipeRefreshLayout(this);
        refresh.setColorSchemeColors(ORANGE);
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

    private void send(Call<JsonObject> call, String callNo) {
        GetResult result = new GetResult();
        result.setMyListener(this);
        result.callForLogin(call, callNo);
    }

    private RequestBody json(JSONObject o) {
        return RequestBody.create(MediaType.parse("application/json"), o.toString());
    }

    private void fetch() {
        send(NodeApiClient.getInterface().customiseList(json(body())), CALL_LIST);
    }

    @Override
    public void onCustomiseEvent(String event, JSONObject data) {
        if ("customise:new".equals(event)) CustomiseBeeper.beepOnce(this, String.valueOf(data.opt("order_id")));
        fetch();
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        refresh.setRefreshing(false);
        boolean ok = result.has("Result") && result.get("Result").getAsBoolean();
        String msg = result.has("msg") && !result.get("msg").isJsonNull() ? result.get("msg").getAsString() : "";
        if (CALL_LIST.equals(callNo)) {
            render(ok, msg, ok ? result.getAsJsonArray("orders") : null);
            return;
        }
        if (!msg.isEmpty() || !ok) {
            Toast.makeText(this, !msg.isEmpty() ? msg : "Something went wrong. Please try again.", Toast.LENGTH_LONG).show();
        }
        if (ok && CALL_ACCEPT.equals(callNo)) {
            Toast.makeText(this, "Order accepted. Opening your trip.", Toast.LENGTH_LONG).show();
        } else if (ok && CALL_COUNTER.equals(callNo)) {
            Toast.makeText(this, "Your price was sent to the customer.", Toast.LENGTH_LONG).show();
        }
        fetch();
    }

    private void render(boolean ok, String msg, JsonArray orders) {
        list.removeAllViews();
        if (!ok) {
            list.addView(text(msg.isEmpty() ? "Customise Orders are not available right now." : msg, 14, Color.DKGRAY, false));
            countText.setText("");
            return;
        }
        countText.setText(orders.size() + " open");
        if (orders.size() == 0) {
            TextView empty = text("No Customise Orders right now.\nNew ones will beep and appear here.", 14, Color.GRAY, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dp(80), 0, 0);
            list.addView(empty);
            return;
        }
        for (JsonElement e : orders) list.addView(card(e.getAsJsonObject()));
    }

    // --- one order card -----------------------------------------------------------------------------------------------

    private String s(JsonObject o, String key) {
        return o != null && o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }

    private JsonObject obj(JsonObject o, String key) {
        return o.has(key) && o.get(key).isJsonObject() ? o.getAsJsonObject(key) : new JsonObject();
    }

    private void row(LinearLayout parent, String label, String value) {
        if (value == null || value.trim().isEmpty() || "null".equals(value)) return;
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setPadding(0, dp(2), 0, dp(2));
        TextView l = text(label, 12, Color.GRAY, false);
        r.addView(l, new LinearLayout.LayoutParams(dp(112), ViewGroup.LayoutParams.WRAP_CONTENT));
        r.addView(text(value, 13, Color.BLACK, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        parent.addView(r);
    }

    private void heading(LinearLayout parent, String label) {
        TextView h = text(label, 12, ORANGE, true);
        h.setPadding(0, dp(10), 0, dp(2));
        parent.addView(h);
    }

    private String when(String iso) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = in.parse(iso.length() > 19 ? iso.substring(0, 19) : iso);
            return new SimpleDateFormat("dd MMM, hh:mm a", Locale.getDefault()).format(d);
        } catch (Exception e) {
            return iso;
        }
    }

    private String handlingLine(JsonObject h, boolean pickup) {
        return "Floor " + s(h, "floor") + ", carry " + s(h, "carry_m") + " m, " + s(h, "helpers") + " helper(s)";
    }

    private View card(JsonObject o) {
        final String orderId = s(o, "order_id");
        final String fare = s(o, "initial_fare");
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(box(Color.WHITE, 14));
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(12);
        card.setLayoutParams(lp);

        String category = s(o, "category");
        card.addView(text("Order #" + orderId + "   ·   " + (category.isEmpty() ? "Any vehicle" : category), 14, Color.BLACK, true));

        TextView price = text("Customer offers  ₹" + fare, 20, Color.WHITE, true);
        price.setBackground(box(ORANGE, 10));
        price.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pp.topMargin = dp(8);
        card.addView(price, pp);
        JsonObject mine = obj(o, "my_offer");
        if (mine.size() > 0) card.addView(text("Your offer: ₹" + s(mine, "amount") + "  (" + s(mine, "kind") + ")", 13, Color.parseColor("#2E7D32"), true));

        JsonObject pickup = obj(o, "pickup");
        heading(card, "ROUTE");
        row(card, "Pickup", s(pickup, "address"));
        if (pickup.has("exact") && !pickup.get("exact").getAsBoolean()) row(card, "", "Approximate: the exact pickup point is confirmed with the customer.");
        JsonArray stops = o.has("stops") && o.get("stops").isJsonArray() ? o.getAsJsonArray("stops") : new JsonArray();
        for (JsonElement se : stops) {
            JsonObject st = se.getAsJsonObject();
            row(card, "Stop " + s(st, "seq") + " (" + s(st, "kind") + ")", s(st, "address"));
            row(card, "", (s(st, "goods_desc").isEmpty() ? "" : s(st, "goods_desc") + " · ") + "floor " + s(st, "floor") + ", " + s(st, "helpers") + " helper(s), load " + s(st, "load_min") + " / unload " + s(st, "unload_min") + " / wait " + s(st, "wait_min") + " min");
        }
        row(card, "Drop", s(obj(o, "drop"), "address"));

        JsonObject goods = obj(o, "goods");
        heading(card, "GOODS");
        row(card, "Goods", s(goods, "description"));
        row(card, "Items", s(goods, "quantity"));
        row(card, "Weight", s(goods, "weight_kg") + " kg");
        if (!s(goods, "length_cm").isEmpty()) row(card, "Size (L×W×H)", s(goods, "length_cm") + " × " + s(goods, "width_cm") + " × " + s(goods, "height_cm") + " cm");
        row(card, "Handling", s(goods, "packing_notes"));

        JsonObject ph = obj(o, "pickup_handling");
        heading(card, "AT PICKUP");
        row(card, "Where", handlingLine(ph, true));
        row(card, "Time", "loading " + s(ph, "load_min") + " min, waiting " + s(ph, "wait_min") + " min");
        row(card, "Notes", s(ph, "notes"));

        JsonObject dh = obj(o, "drop_handling");
        heading(card, "AT DROP");
        row(card, "Where", handlingLine(dh, false));
        row(card, "Time", "unloading " + s(dh, "unload_min") + " min, waiting " + s(dh, "wait_min") + " min");
        row(card, "Notes", s(dh, "notes"));

        heading(card, "BARGAINING");
        row(card, "Started", when(s(o, "bargain_start_at")));
        row(card, "Closes", when(s(o, "expires_at")));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setPadding(0, dp(12), 0, 0);
        actions.addView(button("Reject", Color.parseColor("#B71C1C"), false, v -> confirmReject(orderId)), weight());
        actions.addView(button("Counter", ORANGE, false, v -> counterDialog(orderId, fare)), weight());
        actions.addView(button("Accept ₹" + fare, ORANGE, true, v -> confirmAccept(orderId, fare)), weight());
        card.addView(actions);
        return card;
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        p.setMargins(dp(3), 0, dp(3), 0);
        return p;
    }

    private Button button(String label, int color, boolean filled, View.OnClickListener click) {
        Button b = new Button(this);
        b.setAllCaps(false);
        b.setText(label);
        b.setTextSize(13);
        b.setTextColor(filled ? Color.WHITE : color);
        GradientDrawable d = box(filled ? color : Color.WHITE, 10);
        if (!filled) d.setStroke(dp(1), color);
        b.setBackground(d);
        b.setOnClickListener(click);
        return b;
    }

    // --- actions ----------------------------------------------------------------------------------------------------

    private void confirmAccept(String orderId, String fare) {
        new AlertDialog.Builder(this)
                .setTitle("Accept at ₹" + fare + "?")
                .setMessage("You will be assigned this job at the customer's price.")
                .setPositiveButton("Accept", (d, w) -> {
                    JSONObject b = body();
                    try {
                        b.put("order_id", Integer.parseInt(orderId));
                    } catch (JSONException | NumberFormatException ignored) {
                    }
                    send(NodeApiClient.getInterface().customiseAccept(json(b)), CALL_ACCEPT);
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    private void counterDialog(String orderId, String fare) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        input.setHint("Your price (customer offers ₹" + fare + ")");
        new AlertDialog.Builder(this)
                .setTitle("Send your price")
                .setView(input)
                .setPositiveButton("Send", (d, w) -> {
                    String raw = input.getText().toString().trim();
                    double amount;
                    try {
                        amount = Double.parseDouble(raw);
                    } catch (NumberFormatException e) {
                        Toast.makeText(this, "Enter a valid amount", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    if (amount <= 0) {
                        Toast.makeText(this, "Enter a valid amount", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    JSONObject b = body();
                    try {
                        b.put("order_id", Integer.parseInt(orderId));
                        b.put("amount", amount);
                    } catch (JSONException | NumberFormatException ignored) {
                    }
                    send(NodeApiClient.getInterface().customiseCounter(json(b)), CALL_COUNTER);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void confirmReject(String orderId) {
        new AlertDialog.Builder(this)
                .setTitle("Reject this order?")
                .setMessage("It will not be shown to you again.")
                .setPositiveButton("Reject", (d, w) -> {
                    JSONObject b = body();
                    try {
                        b.put("order_id", Integer.parseInt(orderId));
                    } catch (JSONException | NumberFormatException ignored) {
                    }
                    send(NodeApiClient.getInterface().customiseDismiss(json(b)), CALL_DISMISS);
                })
                .setNegativeButton("Keep", null)
                .show();
    }
}
