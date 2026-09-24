package com.shifter.driver.fragment;

import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import android.net.Uri;
import java.util.HashMap;
import java.util.Map;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.activity.HelpDetailsActivity;
import com.shifter.driver.activity.LoginActivity;
import com.shifter.driver.activity.PremiumPlansActivity;
import com.shifter.driver.activity.ProfileActivity;
import com.shifter.driver.activity.TrainingVideoActivity;
import com.shifter.driver.activity.WalletActivity;
import com.shifter.driver.databinding.FragmentAccountBinding;
import com.shifter.driver.model.Help;
import com.shifter.driver.model.Pages;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.LocaleHelper;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONObject;

import java.util.List;

import de.hdodenhof.circleimageview.CircleImageView;
import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class AccountFragment extends Fragment implements GetResult.MyListener {
    private FragmentAccountBinding binding;

    SessionManager sessionManager;
    RiderData user;
    CustPrograssbar custPrograssbar;
    private String referralCode = "";
    private String referralMsg = "";
    private String customerCareNumber = "+91 9109114515";
    private String customerCareEmail = "support@shifter.online";
    private String customerCareHours = "24/7 Helpline";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        binding = FragmentAccountBinding.inflate(inflater, container, false);
        
        sessionManager = new SessionManager(getActivity());
        user = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();
        customerCareNumber = sessionManager.getCustomerCareNumber();

        binding.cardProfile.setOnClickListener(this::onBindClick);
        binding.lvlEdit.setOnClickListener(this::onBindClick);
        binding.lvlLogout.setOnClickListener(this::onBindClick);
        binding.lvlLanguage.setOnClickListener(this::onBindClick);
        binding.lvlPremiumPlans.setOnClickListener(this::onBindClick);
        binding.lvlReferEarn.setOnClickListener(this::onBindClick);
        binding.lvlTraining.setOnClickListener(this::onBindClick);
        binding.lvlTestRide.setOnClickListener(v -> {
            if (sessionManager.getActiveOrder() != null) {
                Toast.makeText(requireContext(), R.string.demo_active_trip, Toast.LENGTH_LONG).show();
                return;
            }
            startActivity(new Intent(requireContext(), com.shifter.driver.activity.DemoRideActivity.class));
        });
        binding.lvlPayout.setOnClickListener(this::onBindClick);
        binding.lvlPrivacy.setOnClickListener(this::onBindClick);
        binding.lvlTerms.setOnClickListener(this::onBindClick);
        binding.lvlContact.setOnClickListener(this::onBindClick);

        LinearLayoutManager mLayoutManager2 = new LinearLayoutManager(getActivity());
        mLayoutManager2.setOrientation(LinearLayoutManager.VERTICAL);
        binding.recyclerMenu.setLayoutManager(mLayoutManager2);
        binding.recyclerMenu.setItemAnimator(new DefaultItemAnimator());

        binding.layoutBell.setOnClickListener(v -> startActivity(new Intent(getActivity(), com.shifter.driver.activity.NotificationActivity.class)));
        binding.txtVehicleTag.setText(user.getVehicle() != null ? user.getVehicle() : "Shifter partner");
        binding.edUsername.setText(user.getFullName());
        binding.edPhone.setText(user.getMobile());
        if (user != null && user.getRefferCode() != null && !user.getRefferCode().trim().isEmpty()) {
            referralCode = user.getRefferCode().trim();
        } else {
            com.shifter.driver.utility.ReferAndEarnBottomSheet.prefetchReferralCode(getActivity(), user, sessionManager, code -> referralCode = code);
        }

        loadProfileImage(user != null ? user.getProfilePicture() : null);
        getPrivacy();
        return binding.getRoot();
    }

    private void loadProfileImage(String pic) {
        if (getActivity() == null || binding == null) return;
        if (pic != null && !pic.trim().isEmpty()) {
            String url = pic.trim();
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                if (url.startsWith("/")) {
                    url = NodeApiClient.baseUrl + url.substring(1);
                } else {
                    url = NodeApiClient.baseUrl + url;
                }
            }
            Glide.with(getActivity()).load(url).placeholder(R.drawable.user).error(R.drawable.user).into(binding.imgProfile);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (sessionManager != null) {
            user = sessionManager.getUserDetails();
            if (user != null && binding != null) {
                binding.edUsername.setText(user.getFullName() != null ? user.getFullName() : "");
                binding.edPhone.setText(user.getMobile() != null ? user.getMobile() : "");
                loadProfileImage(user.getProfilePicture());
                if (user.getRefferCode() != null && !user.getRefferCode().trim().isEmpty()) {
                    referralCode = user.getRefferCode().trim();
                } else {
                    com.shifter.driver.utility.ReferAndEarnBottomSheet.prefetchReferralCode(getActivity(), user, sessionManager, code -> referralCode = code);
                }
            }
        }
    }

    public void onBindClick(View view) {
        int id = view.getId();
        if (id == R.id.lvl_edit || id == R.id.card_profile) {
            startActivity(new Intent(getActivity(), ProfileActivity.class));
        } else if (id == R.id.lvl_payout) {
            startActivity(new Intent(getActivity(), WalletActivity.class));
        } else if (id == R.id.lvl_premium_plans) {
            startActivity(new Intent(getActivity(), PremiumPlansActivity.class));
        } else if (id == R.id.lvl_refer_earn) {
            showReferTypeDialog();
        } else if (id == R.id.lvl_training) {
            Intent i = new Intent(getActivity(), TrainingVideoActivity.class);
            i.putExtra("replay_mode", true);
            startActivity(i);
        } else if (id == R.id.lvl_language) {
            showLanguageDialog();
        } else if (id == R.id.lvl_privacy) {
            startActivity(new Intent(getActivity(), HelpDetailsActivity.class)
                    .putExtra("title", "Privacy Policy")
                    .putExtra("desc", "<p>We value your privacy and are committed to protecting your personal data. Your location data is used only when active to match you with nearby delivery requests.</p>"));
        } else if (id == R.id.lvl_terms) {
            startActivity(new Intent(getActivity(), HelpDetailsActivity.class)
                    .putExtra("title", "Terms & Conditions")
                    .putExtra("desc", "<p>Please read these terms and conditions carefully before using our driver partner application. By accepting deliveries, you agree to follow safety and service standards.</p>"));
        } else if (id == R.id.lvl_contact) {
            showCustomerCareDialog();
        } else if (id == R.id.lvl_logout) {
            handleLogoutClick();
        }
    }

    // ─── Beautiful Refer Type Bottom Sheet ───────────────────────────────────
    private void showReferTypeDialog() {
        if (getActivity() == null) return;
        com.shifter.driver.utility.ReferAndEarnBottomSheet.show(getActivity(), user, sessionManager,
                referralCode, referralMsg, code -> referralCode = code);
    }

    // ─── Logout & Go Offline Flow ───────────────────────────────────────────
    private void handleLogoutClick() {
        if (getActivity() == null) return;
        boolean isOnline = com.shifter.driver.locationservice.LocationUpdateService.isRunning(getActivity());
        if (isOnline) {
            showGoOfflineLogoutDialog();
        } else {
            showConfirmLogoutDialog();
        }
    }

    private void showGoOfflineLogoutDialog() {
        if (getActivity() == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(getActivity(), R.style.CustomBottomSheetDialogTheme);
        View view = LayoutInflater.from(getActivity()).inflate(R.layout.dialog_logout_go_offline, null);
        dialog.setContentView(view);

        dialog.setOnShowListener(d -> {
            try {
                android.widget.FrameLayout bottomSheet = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                if (bottomSheet != null) {
                    bottomSheet.setBackgroundResource(android.R.color.transparent);
                    com.google.android.material.bottomsheet.BottomSheetBehavior<android.view.View> behavior =
                            com.google.android.material.bottomsheet.BottomSheetBehavior.from(bottomSheet);
                    behavior.setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
                    behavior.setSkipCollapsed(true);
                }
            } catch (Exception ignored) {}
        });

        // Close button (X)
        View btnClose = view.findViewById(R.id.btn_close_offline_sheet);
        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dialog.dismiss());
        }

        // Cancel button
        View btnCancel = view.findViewById(R.id.btn_cancel_logout);
        if (btnCancel != null) {
            btnCancel.setOnClickListener(v -> dialog.dismiss());
        }

        // Just Go Offline (Stay logged in)
        View btnGoOfflineOnly = view.findViewById(R.id.btn_go_offline_only);
        if (btnGoOfflineOnly != null) {
            btnGoOfflineOnly.setOnClickListener(v -> {
                dialog.dismiss();
                performGoOfflineOnly();
            });
        }

        // Go Offline & Log Out
        View btnGoOfflineLogout = view.findViewById(R.id.btn_go_offline_logout);
        if (btnGoOfflineLogout != null) {
            btnGoOfflineLogout.setOnClickListener(v -> {
                dialog.dismiss();
                logoutApi();
            });
        }

        dialog.show();
    }

    private void performGoOfflineOnly() {
        if (getActivity() == null) return;
        Toast.makeText(getActivity(), "Going offline...", Toast.LENGTH_SHORT).show();

        // 1) Stop background location update service
        try {
            getActivity().stopService(new Intent(getActivity(), com.shifter.driver.locationservice.LocationUpdateService.class));
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 2) Set driver status to OFFLINE (a_status = 0)
        if (user != null) {
            try {
                java.util.Map<String, Object> statusBody = new java.util.HashMap<>();
                statusBody.put("rider_id", user.getId());
                statusBody.put("a_status", 0);
                if (getActivity() != null) {
                    statusBody.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(getActivity()));
                }
                NodeApiClient.getInterface().setStatus(statusBody).enqueue(new retrofit2.Callback<JsonObject>() {
                    @Override
                    public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                        if (getActivity() != null) {
                            Toast.makeText(getActivity(), "You are now OFFLINE. Duty is off.", Toast.LENGTH_SHORT).show();
                        }
                    }

                    @Override
                    public void onFailure(Call<JsonObject> call, Throwable t) {
                        if (getActivity() != null) {
                            Toast.makeText(getActivity(), "Offline updated locally.", Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    private void showConfirmLogoutDialog() {
        if (getActivity() == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(getActivity(), R.style.CustomBottomSheetDialogTheme);
        View view = LayoutInflater.from(getActivity()).inflate(R.layout.dialog_confirm_logout, null);
        dialog.setContentView(view);

        dialog.setOnShowListener(d -> {
            try {
                android.widget.FrameLayout bottomSheet = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                if (bottomSheet != null) {
                    bottomSheet.setBackgroundResource(android.R.color.transparent);
                    com.google.android.material.bottomsheet.BottomSheetBehavior<android.view.View> behavior =
                            com.google.android.material.bottomsheet.BottomSheetBehavior.from(bottomSheet);
                    behavior.setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
                    behavior.setSkipCollapsed(true);
                }
            } catch (Exception ignored) {}
        });

        View btnClose = view.findViewById(R.id.btn_close_confirm_sheet);
        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dialog.dismiss());
        }

        View btnCancel = view.findViewById(R.id.btn_cancel_confirm_logout);
        if (btnCancel != null) {
            btnCancel.setOnClickListener(v -> dialog.dismiss());
        }

        View btnConfirm = view.findViewById(R.id.btn_confirm_logout);
        if (btnConfirm != null) {
            btnConfirm.setOnClickListener(v -> {
                dialog.dismiss();
                logoutApi();
            });
        }

        dialog.show();
    }

    private void logoutApi() {
        custPrograssbar.prograssCreate(getActivity());

        // 1) Stop background location update service immediately so update_location.php stops
        if (getActivity() != null) {
            try {
                getActivity().stopService(new Intent(getActivity(), com.shifter.driver.locationservice.LocationUpdateService.class));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // 2) Set driver status to OFFLINE (a_status = 0) via Node's setStatus
        if (user != null) {
            try {
                java.util.Map<String, Object> statusBody = new java.util.HashMap<>();
                statusBody.put("rider_id", user.getId());
                statusBody.put("a_status", 0);
                NodeApiClient.getInterface().setStatus(statusBody).enqueue(new retrofit2.Callback<JsonObject>() {
                    @Override
                    public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {}
                    @Override
                    public void onFailure(Call<JsonObject> call, Throwable t) {}
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // 3) Call logout.php API
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rid", user != null ? String.valueOf(user.getId()) : "");
        } catch (Exception e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().logout(bodyRequest);
        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resObj = response.body();
                    if (resObj.has("ResponseMsg")) {
                        Toast.makeText(getActivity(), resObj.get("ResponseMsg").getAsString(), Toast.LENGTH_SHORT).show();
                    }
                }
                performLogout();
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                performLogout();
            }
        });
    }

    private void performLogout() {
        if (getActivity() != null) {
            try {
                getActivity().stopService(new Intent(getActivity(), com.shifter.driver.locationservice.LocationUpdateService.class));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        sessionManager.logoutUser();
        Intent intent = new Intent(getActivity(), LoginActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
    }

    private void getPrivacy() {
        custPrograssbar.prograssCreate(getActivity());
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rid", user.getId());

        } catch (Exception e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().pagelist(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    public class MyFaqAdepter extends RecyclerView.Adapter<MyFaqAdepter.ViewHolder> {
    private FragmentAccountBinding binding;

        private final List<Pages> orderData;

        public MyFaqAdepter(List<Pages> orderData) {
            this.orderData = orderData;
        }

        @Override
        public ViewHolder onCreateViewHolder(ViewGroup parent,
                                             int viewType) {

            View view = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.halp_item, parent, false);
            ViewHolder viewHolder = new ViewHolder(view);
            return viewHolder;
        }

        @Override
        public void onBindViewHolder(ViewHolder holder,
                                     int position) {
            Log.e("position", "" + position);
            Pages order = orderData.get(position);
            holder.txtTital.setText(order.getTitle());

            holder.lvlClick.setOnClickListener(v -> startActivity(new Intent(getActivity(), HelpDetailsActivity.class).putExtra("title", order.getTitle()).putExtra("desc", order.getDescription())));

        }

        @Override
        public int getItemCount() {
            return orderData.size();
        }

        public class ViewHolder extends RecyclerView.ViewHolder {
   // private FragmentAccountBinding binding;

            TextView txtTital;
            LinearLayout lvlClick;


            public ViewHolder(View view) {
                super(view);
                txtTital = itemView.findViewById(R.id.txt_tital);
                lvlClick = itemView.findViewById(R.id.lvl_click);
            }
        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            custPrograssbar.closePrograssBar();
            if (callNo.equalsIgnoreCase("1")) {
                Gson gson = new Gson();
                Help help = gson.fromJson(result.toString(), Help.class);
                if (help != null) {
                    if (help.getReferralCode() != null && !help.getReferralCode().trim().isEmpty()) {
                        referralCode = help.getReferralCode().trim();
                        if (user != null && (user.getRefferCode() == null || user.getRefferCode().trim().isEmpty())) {
                            user.setRefferCode(referralCode);
                            sessionManager.setUserDetails(user);
                        }
                    }
                    if (help.getReferralMsg() != null) {
                        referralMsg = help.getReferralMsg();
                    }
                    if (help.getResult() != null && help.getResult().equalsIgnoreCase("true")) {
                        binding.recyclerMenu.setAdapter(new MyFaqAdepter(help.getPagelist()));
                    }
                }
                if (result.has("customer_care_number") && !result.get("customer_care_number").isJsonNull()) {
                    String num = result.get("customer_care_number").getAsString().trim();
                    if (!num.isEmpty()) {
                        customerCareNumber = num;
                        if (sessionManager != null) sessionManager.setCustomerCareNumber(num);
                    }
                }
                if (result.has("customer_care_email") && !result.get("customer_care_email").isJsonNull()) {
                    String email = result.get("customer_care_email").getAsString().trim();
                    if (!email.isEmpty()) customerCareEmail = email;
                }
                if (result.has("customer_care_hours") && !result.get("customer_care_hours").isJsonNull()) {
                    String hours = result.get("customer_care_hours").getAsString().trim();
                    if (!hours.isEmpty()) customerCareHours = hours;
                }
            }

        } catch (Exception e) {
            Log.e("Error", "-->" + e);
        }
    }



    private void showLanguageDialog() {

        String lang = sessionManager.getLanguage();
        if (lang == null || lang.isEmpty()) {
            lang = "en";
        }

        final String currentLanguage = lang; // ✅ final variable

        int selectedIndex = currentLanguage.equals("hi") ? 1 : 0;

        String[] languages = {
                getString(R.string.english),
                getString(R.string.hindi)
        };
        String[] languageCodes = {"en", "hi"};

        new AlertDialog.Builder(requireContext())
                .setTitle(R.string.select_language)
                .setSingleChoiceItems(languages, selectedIndex, (dialog, which) -> {

                    String selectedLanguageCode = languageCodes[which];

                    if (!selectedLanguageCode.equals(currentLanguage)) {
                        // Save language preference
                        sessionManager.setLanguage(selectedLanguageCode);
                        
                        // Restart activity to apply language change
                        requireActivity().recreate();
                    }

                    dialog.dismiss();
                })
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }


    private void showCustomerCareDialog() {
        if (getActivity() == null) return;
        new AlertDialog.Builder(requireContext())
                .setTitle("Customer Care Helpline")
                .setMessage("Need assistance? Call our dedicated support team.\n\n"
                        + "📞 Phone: " + customerCareNumber + "\n"
                        + "⏰ Hours: " + customerCareHours + "\n"
                        + "✉️ Email: " + customerCareEmail)
                .setPositiveButton("Call Now", (dialog, which) -> {
                    try {
                        Intent dialIntent = new Intent(Intent.ACTION_DIAL);
                        dialIntent.setData(Uri.parse("tel:" + customerCareNumber.replaceAll("\\s+", "")));
                        startActivity(dialIntent);
                    } catch (Exception e) {
                        Toast.makeText(getActivity(), "Unable to open phone dialer", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}
