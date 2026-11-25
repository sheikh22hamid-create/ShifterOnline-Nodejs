package com.shifter.driver.utility;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.net.Uri;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import com.google.gson.JsonObject;
import com.shifter.driver.retrofit.NodeApiClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Loading/Unloading ("saaman uthana") — driver-side helper (spec 2026-11-24, Phase 1 Model A).
 *
 * All labour logic is isolated here so the big OrderDetailsActivity only needs a few call-sites:
 *   - {@link #labourSummary(JsonObject)} to show the declared inputs + amount BEFORE accept,
 *   - {@link #submitExtra} at the unload stage (corrected inputs + a photo the host picked),
 *   - {@link #showDisputeDialog} for the "customer refused / issue" button,
 *   - {@link #showLabourModeDialog} for the driver's drive_only/light_only/full_loader opt-in.
 *
 * The photo is uploaded via the existing /upload-photo endpoint (returns a path), then that PATH is
 * sent as `photo` to /labour/extra — the same two-step the backend + admin expect.
 */
public final class LabourFeature {

    private LabourFeature() {}

    private static final String[] MODES = {"drive_only", "light_only", "full_loader"};
    private static final String[] MODE_LABELS = {
            "Sirf gaadi chalana (labour nahi)",
            "Halka saaman (ground/kam)",
            "Full loader (bhaari bhi)"
    };

    private static String str(JsonObject o, String key) {
        return o != null && o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }

    private static boolean bool(JsonObject o, String key) {
        try {
            return o != null && o.has(key) && !o.get(key).isJsonNull()
                    && (o.get(key).getAsBoolean() || "1".equals(o.get(key).getAsString()));
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Human summary of an order's labour declaration, or null when the order has no labour. Shown to
     * the driver BEFORE accepting so there is no surprise lifting. Reads the order JSON straight from
     * the dispatch/detail payload (labour_opted, labour_charge_amount, labour_declared_json).
     */
    public static String labourSummary(JsonObject order) {
        if (order == null) return null;
        return labourSummary(bool(order, "labour_opted"), str(order, "labour_charge_amount"), str(order, "labour_declared_json"));
    }

    /** Same, from a typed PDOrderItem's fields (what OrderDetailsActivity has). Null when no labour. */
    public static String labourSummary(boolean opted, String amount, String declaredJson) {
        if (!opted) return null;
        StringBuilder sb = new StringBuilder();
        sb.append("Saaman uthana: ₹").append(amount == null || amount.isEmpty() ? "0" : amount).append(" (lock)");
        if (declaredJson != null && !declaredJson.isEmpty()) {
            try {
                com.google.gson.JsonObject decl = com.google.gson.JsonParser.parseString(declaredJson).getAsJsonObject();
                String mode = decl.has("mode") ? decl.get("mode").getAsString() : "home";
                sb.append(mode.equals("shop") ? " · Dukaan/Godown" : " · Ghar/Flat");
                if (decl.has("heavyItem") && decl.get("heavyItem").getAsBoolean()) sb.append(" · bhaari");
                if (decl.has("legs") && decl.get("legs").isJsonArray()) {
                    com.google.gson.JsonArray legs = decl.getAsJsonArray("legs");
                    sb.append(" · ").append(legs.size()).append(" jagah");
                }
            } catch (Exception ignored) {
                // declaration is advisory in the summary; the locked amount is what matters.
            }
        }
        return sb.toString();
    }

    /** Driver raises a dispute ("customer refused / issue") — freezes the escrow until an executive resolves. */
    public static void showDisputeDialog(final Activity act, final String orderId, final String riderId, final Runnable onDone) {
        final EditText input = new EditText(act);
        input.setHint("Kya dikkat hui? (optional)");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setMinLines(2);
        new AlertDialog.Builder(act)
                .setTitle("Labour dispute uthayein")
                .setMessage("Agar customer ne mana kiya ya kuch gadbad hui, yahan bataiye. Paisa tab tak ruk jayega jab tak executive faisla na kare.")
                .setView(input)
                .setPositiveButton("Bhejein", (d, w) -> {
                    Map<String, Object> body = new HashMap<>();
                    body.put("order_id", orderId);
                    body.put("raised_by", "driver");
                    body.put("raiser_id", riderId);
                    body.put("reason", input.getText().toString().trim());
                    NodeApiClient.getInterface().labourRaiseDispute(body).enqueue(new Callback<JsonObject>() {
                        @Override public void onResponse(Call<JsonObject> c, Response<JsonObject> r) {
                            boolean ok = r.isSuccessful() && r.body() != null && bool(r.body(), "Result");
                            toast(act, ok ? "Dispute bhej diya — executive dekhega." : "Dispute nahi bhej paye.");
                            if (ok && onDone != null) onDone.run();
                        }
                        @Override public void onFailure(Call<JsonObject> c, Throwable t) { toast(act, "Network error."); }
                    });
                })
                .setNegativeButton("Rehne do", null)
                .show();
    }

    /**
     * On-site mismatch: upload the photo the host already picked, then propose the corrected labour.
     * The customer must approve before any extra is charged (handled server-side).
     *
     * @param legs corrected per-leg inputs, same shape the customer declared
     *             (home: {role,size,floor,lift}; shop: {role,qty,access}).
     * @param photo a real image file (required) — the host picks it via its existing ImagePicker.
     */
    public static void submitExtra(final Activity act, final String orderId, final String riderId,
                                   final String mode, final boolean heavyItem,
                                   final List<Map<String, Object>> legs, final File photo,
                                   final Runnable onDone) {
        if (photo == null || !photo.exists()) {
            toast(act, "Pehle asli haalat ka photo lein.");
            return;
        }
        RequestBody fileBody = RequestBody.create(MediaType.parse("image/*"), photo);
        MultipartBody.Part part = MultipartBody.Part.createFormData("photo", photo.getName(), fileBody);
        NodeApiClient.getInterface().uploadOrderPhoto(part).enqueue(new Callback<JsonObject>() {
            @Override public void onResponse(Call<JsonObject> c, Response<JsonObject> r) {
                if (!r.isSuccessful() || r.body() == null || !bool(r.body(), "Result")) {
                    toast(act, "Photo upload nahi hua.");
                    return;
                }
                String path = str(r.body(), "path");
                if (path.isEmpty()) { toast(act, "Photo path nahi mila."); return; }
                Map<String, Object> body = new HashMap<>();
                body.put("order_id", orderId);
                body.put("rider_id", riderId);
                body.put("mode", mode);
                body.put("heavyItem", heavyItem);
                body.put("legs", legs);
                body.put("photo", path);
                NodeApiClient.getInterface().labourProposeExtra(body).enqueue(new Callback<JsonObject>() {
                    @Override public void onResponse(Call<JsonObject> c2, Response<JsonObject> r2) {
                        boolean ok = r2.isSuccessful() && r2.body() != null && bool(r2.body(), "Result");
                        toast(act, ok ? "Customer ko approval ke liye bhej diya." : "Extra nahi bhej paye.");
                        if (ok && onDone != null) onDone.run();
                    }
                    @Override public void onFailure(Call<JsonObject> c2, Throwable t) { toast(act, "Network error."); }
                });
            }
            @Override public void onFailure(Call<JsonObject> c, Throwable t) { toast(act, "Photo upload fail."); }
        });
    }

    /** Driver sets how much labour they are willing to do. Mirrors the body-type opt-in. */
    public static void showLabourModeDialog(final Activity act, final String riderId, final String current, final Runnable onDone) {
        int sel = 0;
        for (int i = 0; i < MODES.length; i++) if (MODES[i].equals(current)) sel = i;
        final int[] picked = {sel};
        new AlertDialog.Builder(act)
                .setTitle("Loading/Unloading kaam")
                .setSingleChoiceItems(MODE_LABELS, sel, (d, which) -> picked[0] = which)
                .setPositiveButton("Save", (d, w) -> {
                    Map<String, Object> body = new HashMap<>();
                    body.put("rider_id", riderId);
                    body.put("labour_mode", MODES[picked[0]]);
                    NodeApiClient.getInterface().setLabourMode(body).enqueue(new Callback<JsonObject>() {
                        @Override public void onResponse(Call<JsonObject> c, Response<JsonObject> r) {
                            boolean ok = r.isSuccessful() && r.body() != null && bool(r.body(), "Result");
                            toast(act, ok ? "Save ho gaya." : "Save nahi hua.");
                            if (ok && onDone != null) onDone.run();
                        }
                        @Override public void onFailure(Call<JsonObject> c, Throwable t) { toast(act, "Network error."); }
                    });
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /** The host collects corrected inputs here, then picks a photo and calls {@link #submitExtra}. */
    public interface ExtraInputListener {
        void onInputs(String mode, boolean heavyItem, List<Map<String, Object>> legs);
    }

    private static final String[] SIZE_V = {"small", "medium", "large"};
    private static final String[] SIZE_L = {"Chhota", "Medium", "Bada"};
    private static final String[] FLOOR_V = {"ground", "f1_2", "f3plus"};
    private static final String[] FLOOR_L = {"Ground", "1-2 floor", "3+ floor"};
    private static final String[] QTY_V = {"q15", "q15_40", "q40plus"};
    private static final String[] QTY_L = {"≤15", "15-40", "40+"};
    private static final String[] ACCESS_V = {"shutter", "stack_inside", "loft_basement"};
    private static final String[] ACCESS_L = {"Shutter tak", "Andar rakhna", "Loft/Basement"};

    private static Spinner spinner(Context c, String[] labels) {
        Spinner s = new Spinner(c);
        s.setAdapter(new ArrayAdapter<>(c, android.R.layout.simple_spinner_dropdown_item, labels));
        return s;
    }

    private static TextView label(Context c, String t) {
        TextView tv = new TextView(c);
        tv.setText(t);
        tv.setPadding(0, 16, 0, 4);
        return tv;
    }

    /**
     * Collect the CORRECTED on-site declaration (same vocab the customer used). Pickup + drop get the
     * same corrected values (Phase 1). On "Next: photo" the host picks an image and calls submitExtra.
     */
    public static void showAddExtraInputDialog(final Activity act, final ExtraInputListener listener) {
        final LinearLayout root = new LinearLayout(act);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * act.getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, 0);

        final RadioGroup modeGroup = new RadioGroup(act);
        modeGroup.setOrientation(RadioGroup.HORIZONTAL);
        final RadioButton rbHome = new RadioButton(act); rbHome.setText("Ghar/Flat"); rbHome.setId(1);
        final RadioButton rbShop = new RadioButton(act); rbShop.setText("Dukaan"); rbShop.setId(2);
        modeGroup.addView(rbHome); modeGroup.addView(rbShop); modeGroup.check(1);
        root.addView(modeGroup);

        final TextView lblSize = label(act, "Saaman ka size"); final Spinner spSize = spinner(act, SIZE_L);
        final TextView lblFloor = label(act, "Manzil (floor)"); final Spinner spFloor = spinner(act, FLOOR_L);
        final CheckBox cbLift = new CheckBox(act); cbLift.setText("Lift chaalu hai?");
        final TextView lblQty = label(act, "Kitne saaman / box"); final Spinner spQty = spinner(act, QTY_L);
        final TextView lblAccess = label(act, "Pahunch (access)"); final Spinner spAccess = spinner(act, ACCESS_L);
        final CheckBox cbHeavy = new CheckBox(act); cbHeavy.setText("Bhaari saaman?");

        root.addView(lblSize); root.addView(spSize);
        root.addView(lblFloor); root.addView(spFloor); root.addView(cbLift);
        root.addView(lblQty); root.addView(spQty);
        root.addView(lblAccess); root.addView(spAccess);
        root.addView(cbHeavy);

        final Runnable applyMode = () -> {
            boolean home = modeGroup.getCheckedRadioButtonId() == 1;
            int homeVis = home ? android.view.View.VISIBLE : android.view.View.GONE;
            int shopVis = home ? android.view.View.GONE : android.view.View.VISIBLE;
            lblSize.setVisibility(homeVis); spSize.setVisibility(homeVis);
            lblFloor.setVisibility(homeVis); spFloor.setVisibility(homeVis); cbLift.setVisibility(homeVis);
            lblQty.setVisibility(shopVis); spQty.setVisibility(shopVis);
            lblAccess.setVisibility(shopVis); spAccess.setVisibility(shopVis);
        };
        modeGroup.setOnCheckedChangeListener((g, id) -> applyMode.run());
        applyMode.run();

        final android.widget.ScrollView scroll = new android.widget.ScrollView(act);
        scroll.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        new AlertDialog.Builder(act)
                .setTitle("Asli saaman (extra labour)")
                .setView(scroll)
                .setPositiveButton("Aage: photo", (d, w) -> {
                    boolean home = modeGroup.getCheckedRadioButtonId() == 1;
                    String mode = home ? "home" : "shop";
                    List<Map<String, Object>> legs = new ArrayList<>();
                    for (String role : new String[]{"pickup", "drop"}) {
                        Map<String, Object> leg = new HashMap<>();
                        leg.put("role", role);
                        if (home) {
                            leg.put("size", SIZE_V[spSize.getSelectedItemPosition()]);
                            leg.put("floor", FLOOR_V[spFloor.getSelectedItemPosition()]);
                            leg.put("lift", cbLift.isChecked());
                        } else {
                            leg.put("qty", QTY_V[spQty.getSelectedItemPosition()]);
                            leg.put("access", ACCESS_V[spAccess.getSelectedItemPosition()]);
                        }
                        legs.add(leg);
                    }
                    if (listener != null) listener.onInputs(mode, cbHeavy.isChecked(), legs);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /** Copy a picked content:// image into a cache file submitExtra can upload. Null on failure. */
    public static File uriToCacheFile(Context ctx, Uri uri) {
        if (uri == null) return null;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            File out = new File(ctx.getCacheDir(), "labour_extra_" + System.currentTimeMillis() + ".jpg");
            try (FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private static void toast(Activity act, String msg) {
        if (act != null && !act.isFinishing()) act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_SHORT).show());
    }
}
