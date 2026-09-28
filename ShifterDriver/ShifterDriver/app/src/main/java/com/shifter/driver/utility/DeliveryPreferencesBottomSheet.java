package com.shifter.driver.utility;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.widget.SwitchCompat;

import com.google.android.material.bottomsheet.BottomSheetBehavior;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.model.PackageData;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.NodeApiClient;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class DeliveryPreferencesBottomSheet {

    public interface OnPreferencesChangedListener {
        void onPreferencesChanged();
    }

    /**
     * Shows the Delivery Preferences bottom sheet with native 60fps animations,
     * smooth spring physics, and instant optimistic toggle updates.
     */
    public static void show(Context context, List<PackageData> packageDataList, RiderData riderData, OnPreferencesChangedListener listener) {
        if (context == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(context, R.style.CustomBottomSheetDialogTheme);
        View view = LayoutInflater.from(context).inflate(R.layout.bottom_sheet_delivery_preferences, null);
        dialog.setContentView(view);

        // Configure BottomSheetBehavior for native 60fps gesture dragging
        dialog.setOnShowListener(d -> {
            try {
                FrameLayout bottomSheet = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                if (bottomSheet != null) {
                    BottomSheetBehavior<FrameLayout> behavior = BottomSheetBehavior.from(bottomSheet);
                    behavior.setState(BottomSheetBehavior.STATE_EXPANDED);
                    behavior.setSkipCollapsed(true);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        View btnClose = view.findViewById(R.id.btn_close_preferences_sheet);
        Button btnDone = view.findViewById(R.id.btn_preferences_done);
        LinearLayout listContainer = view.findViewById(R.id.layout_preferences_list);

        View.OnClickListener dismissListener = v -> dialog.dismiss();
        btnClose.setOnClickListener(dismissListener);
        btnDone.setOnClickListener(dismissListener);

        // Configure Vehicle Body Type selector for Commercial / Cargo drivers
        View cardBodyType = view.findViewById(R.id.card_body_type_container);
        RadioGroup rgBodyType = view.findViewById(R.id.rg_vehicle_body_type);
        RadioButton rbBoth = view.findViewById(R.id.rb_body_both);
        RadioButton rbOpen = view.findViewById(R.id.rb_body_open);
        RadioButton rbHalf = view.findViewById(R.id.rb_body_half);
        RadioButton rbCovered = view.findViewById(R.id.rb_body_covered);

        String allowed = riderData != null ? riderData.getAllowedBodyTypes() : null;
        String vehicleName = riderData != null && riderData.getVehicle() != null ? riderData.getVehicle().toLowerCase() : "";
        boolean isTwoWheeler = vehicleName.contains("bike") || vehicleName.contains("scooter")
                || vehicleName.contains("motorcycle") || vehicleName.contains("2 wheeler");

        if (allowed == null) {
            allowed = isTwoWheeler ? "" : "open,half,covered";
        }
        allowed = allowed.toLowerCase().trim();

        boolean showBodyType = !isTwoWheeler && !allowed.isEmpty();

        if (cardBodyType != null) {
            cardBodyType.setVisibility(showBodyType ? View.VISIBLE : View.GONE);
        }

        if (showBodyType && cardBodyType != null && rgBodyType != null) {
            boolean allowOpen = allowed.contains("open");
            boolean allowHalf = allowed.contains("half");
            boolean allowCovered = allowed.contains("covered");

            if (rbOpen != null) rbOpen.setVisibility(allowOpen ? View.VISIBLE : View.GONE);
            if (rbHalf != null) rbHalf.setVisibility(allowHalf ? View.VISIBLE : View.GONE);
            if (rbCovered != null) rbCovered.setVisibility(allowCovered ? View.VISIBLE : View.GONE);

            int allowedCount = (allowOpen ? 1 : 0) + (allowHalf ? 1 : 0) + (allowCovered ? 1 : 0);
            if (rbBoth != null) rbBoth.setVisibility(allowedCount > 1 ? View.VISIBLE : View.GONE);

            String currentBodyType = riderData.getBodyType();
            if ("open".equalsIgnoreCase(currentBodyType) && !allowOpen) currentBodyType = "both";
            if ("half".equalsIgnoreCase(currentBodyType) && !allowHalf) currentBodyType = "both";
            if ("covered".equalsIgnoreCase(currentBodyType) && !allowCovered) currentBodyType = "both";

            if ("open".equalsIgnoreCase(currentBodyType) && allowOpen) {
                if (rbOpen != null) rbOpen.setChecked(true);
            } else if ("half".equalsIgnoreCase(currentBodyType) && allowHalf) {
                if (rbHalf != null) rbHalf.setChecked(true);
            } else if ("covered".equalsIgnoreCase(currentBodyType) && allowCovered) {
                if (rbCovered != null) rbCovered.setChecked(true);
            } else {
                if (rbBoth != null) rbBoth.setChecked(true);
            }

            rgBodyType.setOnCheckedChangeListener((group, checkedId) -> {
                String newBodyType = "both";
                if (checkedId == R.id.rb_body_open) {
                    newBodyType = "open";
                } else if (checkedId == R.id.rb_body_half) {
                    newBodyType = "half";
                } else if (checkedId == R.id.rb_body_covered) {
                    newBodyType = "covered";
                }

                riderData.setBodyType(newBodyType);
                try {
                    SessionManager sessionManager = new SessionManager(context);
                    sessionManager.setUserDetails(riderData);
                } catch (Exception ignored) {}

                if (riderData.getId() > 0) {
                    Map<String, Object> body = new HashMap<>();
                    body.put("rider_id", riderData.getId());
                    body.put("body_type", newBodyType);

                    NodeApiClient.getInterface().setBodyType(body).enqueue(new retrofit2.Callback<JsonObject>() {
                        @Override
                        public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                            if (response.isSuccessful() && response.body() != null) {
                                Log.d("DeliveryPreferences", "Vehicle body type updated to: " + riderData.getBodyType());
                            }
                        }

                        @Override
                        public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                            Log.e("DeliveryPreferences", "Failed to update vehicle body type", t);
                        }
                    });
                }
            });
        } else if (cardBodyType != null) {
            cardBodyType.setVisibility(View.GONE);
        }

        if (packageDataList != null && !packageDataList.isEmpty() && listContainer != null) {
            LayoutInflater inflater = LayoutInflater.from(context);
            int riderId = (riderData != null) ? riderData.getId() : 0;

            for (PackageData packageData : packageDataList) {
                View card = inflater.inflate(R.layout.item_delivery_type_card, listContainer, false);
                bindTierCard(context, card, packageData, riderId, listener);
                listContainer.addView(card);
            }
        }

        dialog.show();
    }

    /**
     * Binds a delivery tier item card with tier-specific branding, dynamic pricing,
     * separate info modal trigger, and instant optimistic UI toggle.
     */
    public static void bindTierCard(Context context, View card, PackageData packageData, int riderId, OnPreferencesChangedListener listener) {
        if (context == null || card == null || packageData == null) return;

        FrameLayout layoutIconBg = card.findViewById(R.id.layout_tier_icon_bg);
        ImageView imgTierIcon = card.findViewById(R.id.img_tier_icon);
        TextView txtTitle = card.findViewById(R.id.txt_model_title);
        TextView txtSubtitle = card.findViewById(R.id.txt_model_subtitle);
        View btnInfo = card.findViewById(R.id.btn_model_info);
        SwitchCompat switchStatus = card.findViewById(R.id.switch_model_status);

        String title = packageData.getTitle();
        txtTitle.setText(title != null ? title : "Delivery Tier");

        // Tier branding comes from TierTheme, the same resolver the order
        // request popup uses - one place decides what a tier looks like.
        TierTheme theme = TierTheme.resolve(packageData.getId(), title, packageData.getRawTitle());
        layoutIconBg.setBackgroundTintList(ColorStateList.valueOf(theme.highlightBgColor));
        imgTierIcon.setImageResource(theme.headerIconRes);
        imgTierIcon.setColorFilter(theme.headerBgColor);

        // Card subtitle is admin-authored; hide the line when it is blank.
        String cardSubtitle = packageData.getCardSubtitle();
        if (cardSubtitle.isEmpty()) {
            txtSubtitle.setVisibility(View.GONE);
        } else {
            txtSubtitle.setVisibility(View.VISIBLE);
            txtSubtitle.setText(cardSubtitle);
        }

        // Details chip: hidden entirely when the admin has configured no
        // content for this tier, so it can never open an empty sheet.
        if (packageData.hasInfoContent()) {
            btnInfo.setVisibility(View.VISIBLE);
            btnInfo.setOnClickListener(v -> ModelInfoBottomSheet.show(context, packageData));
        } else {
            btnInfo.setVisibility(View.GONE);
            btnInfo.setOnClickListener(null);
        }

        // Switch State & Instant Optimistic UI Toggle
        boolean isActive = "1".equals(packageData.getDriver_active());
        switchStatus.setOnCheckedChangeListener(null);
        switchStatus.setChecked(isActive);

        switchStatus.setOnCheckedChangeListener((buttonView, isChecked) -> {
            boolean oldActive = "1".equals(packageData.getDriver_active());
            if (oldActive == isChecked) return;

            // 1. Instant optimistic update in memory and parent callback
            packageData.setDriver_active(isChecked ? "1" : "0");
            packageData.setStatus(isChecked ? "1" : "0");
            if (listener != null) {
                listener.onPreferencesChanged();
            }

            // 2. Asynchronous background network sync (Zero UI thread blocking)
            if (riderId > 0 && packageData.getId() != null) {
                try {
                    Map<String, Object> body = new HashMap<>();
                    body.put("rider_id", riderId);
                    body.put("package_id", Integer.parseInt(packageData.getId()));
                    body.put("enabled", isChecked);

                    NodeApiClient.getInterface().updateDeliveryType(body).enqueue(new retrofit2.Callback<JsonObject>() {
                        @Override
                        public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                            if (!response.isSuccessful() || response.body() == null) {
                                revertOptimisticState();
                            }
                        }

                        @Override
                        public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                            Log.e("DeliveryPreferences", "Network error toggling package", t);
                            revertOptimisticState();
                        }

                        private void revertOptimisticState() {
                            if (context instanceof Activity) {
                                ((Activity) context).runOnUiThread(() -> {
                                    packageData.setDriver_active(oldActive ? "1" : "0");
                                    packageData.setStatus(oldActive ? "1" : "0");
                                    switchStatus.setOnCheckedChangeListener(null);
                                    switchStatus.setChecked(oldActive);
                                    switchStatus.setOnCheckedChangeListener((btn, chk) -> {});
                                    if (listener != null) {
                                        listener.onPreferencesChanged();
                                    }
                                    Toast.makeText(context, "Could not update " + packageData.getTitle() + ". Please check internet.", Toast.LENGTH_SHORT).show();
                                });
                            }
                        }
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });
    }
}
