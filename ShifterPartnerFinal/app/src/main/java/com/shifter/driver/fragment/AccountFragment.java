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
import com.shifter.driver.activity.WalletActivity;
import com.shifter.driver.databinding.FragmentAccountBinding;
import com.shifter.driver.model.Help;
import com.shifter.driver.model.Pages;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
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

        binding.lvlEdit.setOnClickListener(this::onBindClick);
        binding.lvlLogout.setOnClickListener(this::onBindClick);
        binding.lvlLanguage.setOnClickListener(this::onBindClick);
        binding.lvlPremiumPlans.setOnClickListener(this::onBindClick);
        binding.lvlReferEarn.setOnClickListener(this::onBindClick);

        LinearLayoutManager mLayoutManager2 = new LinearLayoutManager(getActivity());
        mLayoutManager2.setOrientation(LinearLayoutManager.VERTICAL);
        binding.recyclerMenu.setLayoutManager(mLayoutManager2);
        binding.recyclerMenu.setItemAnimator(new DefaultItemAnimator());

        binding.edUsername.setText(user.getFullName());

        binding.edPhone.setText(user.getMobile());

        Glide.with(getActivity()).load(APIClient.baseUrl + "/" + user.getProfilePicture()).thumbnail(Glide.with(getActivity()).load(R.drawable.user)).into(binding.imgProfile);
        getPrivacy();
        return binding.getRoot();
    }



        public void onBindClick(View view) {
        int id = view.getId();
        if (id == R.id.lvl_edit) {
            startActivity(new Intent(getActivity(), ProfileActivity.class));

        } else if (id == R.id.lvl_payout) {
            startActivity(new Intent(getActivity(), WalletActivity.class));

        } else if (id == R.id.lvl_payoutlist) {

        } else if (id == R.id.lvl_premium_plans) {
            startActivity(new Intent(getActivity(), PremiumPlansActivity.class));

        } else if (id == R.id.lvl_refer_earn) {
            showReferTypeDialog();

        } else if (id == R.id.lvl_setting) {

        } else if (id == R.id.lvl_language) {
            showLanguageDialog();
        } else if (id == R.id.lvl_logout) {
            logoutApi();
         }
    }

    // ─── Beautiful Refer Type Bottom Sheet ───────────────────────────────────
    private void showReferTypeDialog() {
        if (getActivity() == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(getActivity());
        View view = LayoutInflater.from(getActivity())
                .inflate(R.layout.dialog_refer_type, null);
        dialog.setContentView(view);

        // Show referral code in the chip
        TextView txtCode = view.findViewById(R.id.txt_ref_code_chip);
        if (referralCode != null && !referralCode.trim().isEmpty()) {
            txtCode.setText(referralCode.trim());
        } else {
            txtCode.setText("—");
        }

        // DRIVER card — existing driver app URL
        view.findViewById(R.id.option_driver).setOnClickListener(v -> {
            dialog.dismiss();
            shareReferral("driver");
        });

        // CUSTOMER card — customer app URL
        view.findViewById(R.id.option_customer).setOnClickListener(v -> {
            dialog.dismiss();
            shareReferral("customer");
        });

        // Cancel
        view.findViewById(R.id.txt_cancel).setOnClickListener(v -> dialog.dismiss());

        dialog.show();
    }

    // ─── Share Referral (type = "driver" or "customer") ───────────────────────
    private void shareReferral(String type) {
        try {
            StringBuilder sb = new StringBuilder();

            // Message
            if (referralMsg != null && !referralMsg.trim().isEmpty()) {
                sb.append("🚀 ").append(referralMsg.trim());
            } else {
                sb.append("🚀 Hey! Use my referral code to sign up on Shifter Online and earn exciting rewards!");
            }

            // Referral code
            if (referralCode != null && !referralCode.trim().isEmpty()) {
                sb.append("\n\n🎁 Referral Code: ").append(referralCode.trim());
            }

            // Play Store URL — different for driver vs customer
            String playStoreUrl;
            if ("customer".equalsIgnoreCase(type)) {
                playStoreUrl = "https://play.google.com/store/apps/details?id=com.shifter.online&pcampaignid=web_share";
            } else {
                // Driver app — use current app package name
                String pkgName = getActivity() != null
                        ? getActivity().getPackageName()
                        : "com.shifter.driver";
                playStoreUrl = "https://play.google.com/store/apps/details?id=" + pkgName;
            }

            sb.append("\n\n📲 Download App: ").append(playStoreUrl);

            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_SUBJECT, "Shifter Online Referral Code");
            shareIntent.putExtra(Intent.EXTRA_TEXT, sb.toString());
            startActivity(Intent.createChooser(shareIntent, "Share Referral Code via"));

        } catch (Exception e) {
            Log.e("REFER_SHARE", "Error: " + e.getMessage());
            Toast.makeText(getActivity(), "Unable to share referral code", Toast.LENGTH_SHORT).show();
        }
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

        // 2) Set driver status to OFFLINE (status = "0") in rider_status.php
        if (user != null) {
            try {
                JSONObject statusObj = new JSONObject();
                statusObj.put("rider_id", String.valueOf(user.getId()));
                statusObj.put("status", "0");
                RequestBody statusBody = RequestBody.create(MediaType.parse("application/json"), statusObj.toString());
                APIClient.getInterface().riderStatus(statusBody).enqueue(new retrofit2.Callback<JsonObject>() {
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
        Call<JsonObject> call = APIClient.getInterface().logoutRider(bodyRequest);
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
        Call<JsonObject> call = APIClient.getInterface().pagelist(bodyRequest);
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
                    if (help.getReferralCode() != null) {
                        referralCode = help.getReferralCode();
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
