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

import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.widget.EditText;
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
import com.shifter.driver.activity.LeadReferralActivity;
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

import java.util.Locale;

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

        binding.cardProfile.setOnClickListener(this::onBindClick);
        binding.lvlEdit.setOnClickListener(this::onBindClick);
        binding.lvlLogout.setOnClickListener(this::onBindClick);
        binding.lvlLanguage.setOnClickListener(this::onBindClick);
        binding.lvlPremiumPlans.setOnClickListener(this::onBindClick);
        binding.lvlReferEarn.setOnClickListener(this::onBindClick);
        binding.lvlTraining.setOnClickListener(this::onBindClick);
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
            fetchFreshReferralCode(null);
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
                    fetchFreshReferralCode(null);
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
            startActivity(new Intent(getActivity(), HelpDetailsActivity.class)
                    .putExtra("title", "Contact Us")
                    .putExtra("desc", "<p>Need help? Contact our support team directly.<br/><br/><b>Email:</b> support@shifter.online<br/><b>Helpline:</b> +91 9999908008</p>"));
        } else if (id == R.id.lvl_logout) {
            logoutApi();
        }
    }

    // ─── Beautiful Refer Type Bottom Sheet ───────────────────────────────────
    private void showReferTypeDialog() {
        if (getActivity() == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(getActivity(), R.style.CustomBottomSheetDialogTheme);
        View view = LayoutInflater.from(getActivity())
                .inflate(R.layout.dialog_refer_type, null);
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
        View btnClose = view.findViewById(R.id.btn_close_refer_sheet);
        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dialog.dismiss());
        }

        // Ensure referralCode is initialized from user if available
        if (referralCode == null || referralCode.trim().isEmpty() || referralCode.equals("—")) {
            if (user != null && user.getRefferCode() != null && !user.getRefferCode().trim().isEmpty()) {
                referralCode = user.getRefferCode().trim();
            }
        }

        // Show referral code in the chip
        TextView txtCode = view.findViewById(R.id.txt_ref_code_chip);
        if (referralCode != null && !referralCode.trim().isEmpty() && !referralCode.equals("—")) {
            txtCode.setText(referralCode.trim());
        } else {
            txtCode.setText("—");
            // If still missing, fetch fresh profile from backend to get/auto-generate referral code
            fetchFreshReferralCode(txtCode);
        }

        // Tap on referral code chip or Copy button to copy
        View.OnClickListener copyListener = v -> {
            String code = (referralCode != null && !referralCode.trim().isEmpty() && !referralCode.equals("—"))
                    ? referralCode.trim()
                    : (txtCode != null ? txtCode.getText().toString().trim() : "");
            if (!code.isEmpty() && !code.equals("—")) {
                ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("Referral Code", code);
                clipboard.setPrimaryClip(clip);
                Toast.makeText(getActivity(), "Referral code copied: " + code, Toast.LENGTH_SHORT).show();
            }
        };

        View lvlChip = view.findViewById(R.id.lvl_ref_code_chip);
        if (lvlChip != null) {
            lvlChip.setOnClickListener(copyListener);
        }
        View lvlCopyBtn = view.findViewById(R.id.lvl_copy_btn_action);
        if (lvlCopyBtn != null) {
            lvlCopyBtn.setOnClickListener(copyListener);
        }

        // ─── Apply Referral Code Section ───
        EditText edApplyCode = view.findViewById(R.id.ed_apply_ref_code);
        TextView btnApplyCode = view.findViewById(R.id.btn_apply_ref_code);
        TextView txtApplyStatus = view.findViewById(R.id.txt_apply_status);

        if (btnApplyCode != null && edApplyCode != null) {
            btnApplyCode.setOnClickListener(v -> {
                String inputCode = edApplyCode.getText().toString().trim().toUpperCase(Locale.US);
                if (inputCode.isEmpty()) {
                    Toast.makeText(getActivity(), "Please enter a referral code", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (referralCode != null && inputCode.equalsIgnoreCase(referralCode.trim())) {
                    Toast.makeText(getActivity(), "You cannot apply your own referral code!", Toast.LENGTH_SHORT).show();
                    return;
                }

                btnApplyCode.setEnabled(false);
                btnApplyCode.setText("...");

                Map<String, Object> applyBody = new HashMap<>();
                applyBody.put("rider_id", user != null ? user.getId() : 0);
                applyBody.put("referral_code", inputCode);

                NodeApiClient.getInterface().applyReferral(applyBody).enqueue(new retrofit2.Callback<JsonObject>() {
                    @Override
                    public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                        btnApplyCode.setEnabled(true);
                        btnApplyCode.setText("Apply");

                        if (response.isSuccessful() && response.body() != null) {
                            JsonObject resp = response.body();
                            String result = resp.has("Result") ? resp.get("Result").getAsString() : "false";
                            String msg = resp.has("ResponseMsg") ? resp.get("ResponseMsg").getAsString() : "Referral status";

                            if ("true".equalsIgnoreCase(result)) {
                                Toast.makeText(getActivity(), msg, Toast.LENGTH_LONG).show();
                                if (txtApplyStatus != null) {
                                    txtApplyStatus.setVisibility(View.VISIBLE);
                                    txtApplyStatus.setText("✓ " + msg);
                                    txtApplyStatus.setTextColor(Color.parseColor("#16A34A"));
                                }
                                edApplyCode.setEnabled(false);
                                btnApplyCode.setVisibility(View.GONE);
                            } else {
                                Toast.makeText(getActivity(), msg, Toast.LENGTH_SHORT).show();
                                if (txtApplyStatus != null) {
                                    txtApplyStatus.setVisibility(View.VISIBLE);
                                    txtApplyStatus.setText("✗ " + msg);
                                    txtApplyStatus.setTextColor(Color.parseColor("#DC2626"));
                                }
                            }
                        } else {
                            Toast.makeText(getActivity(), "Failed to apply referral code", Toast.LENGTH_SHORT).show();
                        }
                    }

                    @Override
                    public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                        btnApplyCode.setEnabled(true);
                        btnApplyCode.setText("Apply");
                        Toast.makeText(getActivity(), "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                    }
                });
            });
        }

        // DRIVER card — existing driver app URL
        View optDriver = view.findViewById(R.id.option_driver);
        if (optDriver != null) {
            optDriver.setOnClickListener(v -> {
                dialog.dismiss();
                shareReferral("driver");
            });
        }

        // CUSTOMER card — customer app URL
        View optCustomer = view.findViewById(R.id.option_customer);
        if (optCustomer != null) {
            optCustomer.setOnClickListener(v -> {
                dialog.dismiss();
                shareReferral("customer");
            });
        }

        // CONTACT REFERRAL card — launch LeadReferralActivity
        View optionContactLeads = view.findViewById(R.id.option_contact_leads);
        if (optionContactLeads != null) {
            optionContactLeads.setOnClickListener(v -> {
                dialog.dismiss();
                startActivity(new Intent(getActivity(), LeadReferralActivity.class));
            });
        }

        // Social Share buttons
        View btnWhatsapp = view.findViewById(R.id.btn_share_whatsapp);
        if (btnWhatsapp != null) {
            btnWhatsapp.setOnClickListener(v -> {
                dialog.dismiss();
                shareViaApp("com.whatsapp", getReferralShareMessage("driver"), "Share via WhatsApp");
            });
        }

        View btnCopyLink = view.findViewById(R.id.btn_share_copy_link);
        if (btnCopyLink != null) {
            btnCopyLink.setOnClickListener(v -> {
                ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData clip = ClipData.newPlainText("Shifter Referral", getReferralShareMessage("driver"));
                clipboard.setPrimaryClip(clip);
                Toast.makeText(getActivity(), "Referral link copied to clipboard!", Toast.LENGTH_SHORT).show();
            });
        }

        View btnFacebook = view.findViewById(R.id.btn_share_facebook);
        if (btnFacebook != null) {
            btnFacebook.setOnClickListener(v -> {
                dialog.dismiss();
                shareViaApp("com.facebook.katana", getReferralShareMessage("driver"), "Share via Facebook");
            });
        }

        View btnInstagram = view.findViewById(R.id.btn_share_instagram);
        if (btnInstagram != null) {
            btnInstagram.setOnClickListener(v -> {
                dialog.dismiss();
                shareViaApp("com.instagram.android", getReferralShareMessage("driver"), "Share via Instagram");
            });
        }

        View btnMore = view.findViewById(R.id.btn_share_more);
        if (btnMore != null) {
            btnMore.setOnClickListener(v -> {
                dialog.dismiss();
                shareReferral("driver");
            });
        }

        // Cancel
        View btnCancel = view.findViewById(R.id.txt_cancel);
        if (btnCancel != null) {
            btnCancel.setOnClickListener(v -> dialog.dismiss());
        }

        dialog.show();
    }

    private String getReferralShareMessage(String type) {
        StringBuilder sb = new StringBuilder();

        // Message
        if (referralMsg != null && !referralMsg.trim().isEmpty()) {
            sb.append("🚀 ").append(referralMsg.trim());
        } else {
            sb.append("🚀 Hey! Use my referral code to join Shifter and earn exciting rewards!");
        }

        // Referral code
        if (referralCode != null && !referralCode.trim().isEmpty() && !referralCode.equals("—")) {
            sb.append("\n\n🎁 My Referral Code: ").append(referralCode.trim());
        }

        // Play Store URL — different for driver vs customer
        String playStoreUrl;
        if ("customer".equalsIgnoreCase(type)) {
            playStoreUrl = "https://play.google.com/store/apps/details?id=com.shifter.online&pcampaignid=web_share";
        } else {
            String pkgName = getActivity() != null ? getActivity().getPackageName() : "com.shifter.driver";
            playStoreUrl = "https://play.google.com/store/apps/details?id=" + pkgName;
        }

        sb.append("\n\n📲 Download App: ").append(playStoreUrl);
        return sb.toString();
    }

    private void shareViaApp(String packageName, String message, String chooserTitle) {
        if (getActivity() == null) return;
        try {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_SUBJECT, "Shifter Referral Code");
            intent.putExtra(Intent.EXTRA_TEXT, message);
            if (packageName != null && !packageName.isEmpty()) {
                intent.setPackage(packageName);
            }
            startActivity(intent);
        } catch (Exception e) {
            // Fallback to normal chooser if app not installed or error
            try {
                Intent chooser = new Intent(Intent.ACTION_SEND);
                chooser.setType("text/plain");
                chooser.putExtra(Intent.EXTRA_SUBJECT, "Shifter Referral Code");
                chooser.putExtra(Intent.EXTRA_TEXT, message);
                startActivity(Intent.createChooser(chooser, chooserTitle));
            } catch (Exception ex) {
                Toast.makeText(getActivity(), "Unable to share", Toast.LENGTH_SHORT).show();
            }
        }
    }

    // ─── Share Referral (type = "driver" or "customer") ───────────────────────
    private void shareReferral(String type) {
        shareViaApp(null, getReferralShareMessage(type), "Share Referral Code via");
    }

    private void fetchFreshReferralCode(TextView txtCode) {
        if (user == null || getActivity() == null) return;
        Map<String, Object> req = new HashMap<>();
        req.put("rider_id", user.getId());
        NodeApiClient.getInterface().getProfile(req).enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject body = response.body();
                    if (body.has("rider_data") && !body.get("rider_data").isJsonNull()) {
                        JsonObject rdata = body.getAsJsonObject("rider_data");
                        String code = "";
                        if (rdata.has("reffer_code") && !rdata.get("reffer_code").isJsonNull()) {
                            code = rdata.get("reffer_code").getAsString();
                        } else if (rdata.has("referral_code") && !rdata.get("referral_code").isJsonNull()) {
                            code = rdata.get("referral_code").getAsString();
                        }
                        if (!code.isEmpty()) {
                            referralCode = code;
                            if (txtCode != null) {
                                txtCode.setText(code);
                            }
                            if (user != null) {
                                user.setRefferCode(code);
                                sessionManager.setUserDetails(user);
                            }
                        }
                    }
                }
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                // Ignore network error on background fetch
            }
        });
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


    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}
