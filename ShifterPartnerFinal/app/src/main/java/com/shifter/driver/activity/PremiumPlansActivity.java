package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.model.DriverPremiumPlan;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.model.RiderData;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

/**
 * Plans List screen — shows all available driver premium plans as cards.
 * Tapping "View Details" opens PlanDetailActivity for full details + payment.
 */
public class PremiumPlansActivity extends AppCompatActivity implements GetResult.MyListener {

    private static final String TAG              = "PremiumPlansActivity";
    private static final String CALL_FETCH_PLANS = "FETCH_PLANS";
    private static final int    REQ_PLAN_DETAIL  = 101;

    private LinearLayout       layoutPlansContainer;
    private TextView           txtEmpty;
    private SwipeRefreshLayout swipeContainer;

    private SessionManager  sessionManager;
    private RiderData       riderData;
    private CustPrograssbar custPrograssbar;

    private List<DriverPremiumPlan> planList = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_premium_plans);

        sessionManager  = new SessionManager(this);
        riderData       = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();

        if (riderData == null) {
            Toast.makeText(this, "Session expired. Please login again.", Toast.LENGTH_SHORT).show();
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        ImageView imgBack    = findViewById(R.id.img_back);
        layoutPlansContainer = findViewById(R.id.layout_plans_container);
        txtEmpty             = findViewById(R.id.txt_empty);
        swipeContainer       = findViewById(R.id.swipe_container);

        // Hide old active plan banner — no longer in API response
        View activePlanBanner = findViewById(R.id.layout_active_plan);
        if (activePlanBanner != null) activePlanBanner.setVisibility(View.GONE);

        imgBack.setOnClickListener(v -> finish());

        swipeContainer.setOnRefreshListener(() -> {
            fetchPlans();
            swipeContainer.setRefreshing(false);
        });

        fetchPlans();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // Refresh plan list after returning from PlanDetailActivity (e.g. purchase done)
        if (requestCode == REQ_PLAN_DETAIL && resultCode == RESULT_OK) {
            fetchPlans();
        }
    }

    // ─────────────────────────── FETCH PLANS ───────────────────────────
    private void fetchPlans() {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("driver_id", riderData.getId());

            RequestBody body = RequestBody.create(
                    MediaType.parse("application/json"), json.toString());

            Call<JsonObject> call = APIClient.getInterface().getDriverPremiumPlans(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, CALL_FETCH_PLANS);

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            Log.e(TAG, "fetchPlans error: " + e.getMessage());
        }
    }

    // ─────────────────────────── API CALLBACK ───────────────────────────
    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        if (!CALL_FETCH_PLANS.equals(callNo)) return;

        try {
            if (result.has("Result") &&
                    "true".equalsIgnoreCase(result.get("Result").getAsString())) {

                JsonArray plansArray = result.getAsJsonArray("Plans");
                planList.clear();
                Gson gson = new Gson();
                for (int i = 0; i < plansArray.size(); i++) {
                    planList.add(gson.fromJson(plansArray.get(i), DriverPremiumPlan.class));
                }
                renderPlanCards();

            } else {
                String msg = result.has("ResponseMsg")
                        ? result.get("ResponseMsg").getAsString()
                        : "No plans available";
                txtEmpty.setVisibility(View.VISIBLE);
                txtEmpty.setText(msg);
            }
        } catch (Exception e) {
            Log.e(TAG, "callback error: " + e.getMessage());
            Toast.makeText(this, "Something went wrong.", Toast.LENGTH_SHORT).show();
        }
    }

    // ─────────────────────────── RENDER PLAN CARDS ───────────────────────────
    private void renderPlanCards() {
        layoutPlansContainer.removeAllViews();

        if (planList.isEmpty()) {
            txtEmpty.setVisibility(View.VISIBLE);
            return;
        }
        txtEmpty.setVisibility(View.GONE);

        Gson gson = new Gson();

        for (DriverPremiumPlan plan : planList) {
            View card = LayoutInflater.from(this)
                    .inflate(R.layout.item_driver_plan, layoutPlansContainer, false);

            TextView     txtPopularBadge = card.findViewById(R.id.txt_popular_badge);
            TextView     txtPlanName     = card.findViewById(R.id.txt_plan_name);
            TextView     txtValidity     = card.findViewById(R.id.txt_validity_label);
            TextView     txtOrigPrice    = card.findViewById(R.id.txt_original_price);
            TextView     txtFinalPrice   = card.findViewById(R.id.txt_final_price);
            TextView     txtDescription  = card.findViewById(R.id.txt_description);
            LinearLayout layoutTags      = card.findViewById(R.id.layout_tags);
            TextView     btnViewDetails  = card.findViewById(R.id.btn_purchase_plan);

            // Popular badge
            txtPopularBadge.setVisibility(plan.isPopular() ? View.VISIBLE : View.GONE);

            // Name
            txtPlanName.setText(plan.getPlanName());

            // Validity
            String vl = plan.getValidityLabel();
            if (vl != null && !vl.isEmpty()) {
                txtValidity.setVisibility(View.VISIBLE);
                txtValidity.setText(vl);
            } else {
                txtValidity.setVisibility(View.GONE);
            }

            // Price
            DriverPremiumPlan.PriceInfo pi = plan.getPriceInfo();
            if (pi != null) {
                txtFinalPrice.setText(pi.getCurrencySymbol() + (int) pi.getPrice()
                        + "/" + plan.getValidityLabel());
            }
            txtOrigPrice.setVisibility(View.GONE);

            // Description
            String desc = plan.getDescription();
            if (desc != null && !desc.isEmpty()) {
                txtDescription.setVisibility(View.VISIBLE);
                txtDescription.setText(desc);
            } else {
                txtDescription.setVisibility(View.GONE);
            }

            // UI Tags — summary benefits (show first 3 max for list view)
            layoutTags.removeAllViews();
            List<String> tags = plan.getUiTags();
            if (tags != null) {
                int limit = Math.min(tags.size(), 3);
                for (int i = 0; i < limit; i++) {
                    TextView tv = new TextView(this);
                    tv.setText("✅  " + tags.get(i));
                    tv.setTextColor(0xFF444444);
                    tv.setTextSize(12.5f);
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT);
                    lp.topMargin = 6;
                    tv.setLayoutParams(lp);
                    layoutTags.addView(tv);
                }
                if (tags.size() > 3) {
                    TextView more = new TextView(this);
                    more.setText("  +" + (tags.size() - 3) + " more benefits →");
                    more.setTextColor(0xFF7C4DFF);
                    more.setTextSize(12f);
                    more.setTypeface(null, android.graphics.Typeface.ITALIC);
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT);
                    lp.topMargin = 6;
                    more.setLayoutParams(lp);
                    layoutTags.addView(more);
                }
            }

            // Active vs Buy button
            if (plan.isActive()) {
                btnViewDetails.setText("✓  Active Plan");
                btnViewDetails.setAlpha(0.6f);
                btnViewDetails.setEnabled(false);

                // Show expiry inline
                if (plan.getExpireDate() != null && !plan.getExpireDate().isEmpty()) {
                    TextView exp = new TextView(this);
                    exp.setText("Valid till: " + plan.getExpireDate()
                            + "  (" + plan.getDaysLeft() + " days left)");
                    exp.setTextColor(0xFF2E7D32);
                    exp.setTextSize(12f);
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT);
                    lp.topMargin = 8;
                    exp.setLayoutParams(lp);
                    layoutTags.addView(exp);
                }
            } else {
                btnViewDetails.setText("View Details");
                btnViewDetails.setAlpha(1f);
                btnViewDetails.setEnabled(true);
                btnViewDetails.setOnClickListener(v -> {
                    // Pass plan as JSON to PlanDetailActivity
                    Intent intent = new Intent(this, PlanDetailActivity.class);
                    intent.putExtra(PlanDetailActivity.EXTRA_PLAN_JSON, gson.toJson(plan));
                    startActivityForResult(intent, REQ_PLAN_DETAIL);
                });
            }

            layoutPlansContainer.addView(card);
        }
    }
}
