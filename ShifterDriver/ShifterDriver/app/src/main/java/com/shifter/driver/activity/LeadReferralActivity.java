package com.shifter.driver.activity;

import android.Manifest;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import com.shifter.driver.R;
import com.shifter.driver.adapter.ContactSelectAdapter;
import com.shifter.driver.adapter.SubmittedLeadsAdapter;
import com.shifter.driver.databinding.ActivityLeadReferralBinding;
import com.shifter.driver.model.ContactItem;
import com.shifter.driver.model.LeadItem;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.SessionManager;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LeadReferralActivity extends AppCompatActivity {

    private static final int REQ_CONTACTS_PERMISSION = 201;

    private ActivityLeadReferralBinding binding;
    private SessionManager sessionManager;
    private int riderId = 0;

    private ContactSelectAdapter contactAdapter;
    private SubmittedLeadsAdapter leadsAdapter;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private boolean isAllSelected = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityLeadReferralBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        RiderData riderData = sessionManager.getUserDetails();
        if (riderData != null) {
            riderId = riderData.getId();
        }

        setupUI();
        setupAdapters();
        setupListeners();

        // Check contacts permission on startup
        checkAndLoadContacts();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdown();
    }

    private void setupUI() {
        binding.txtSubmitBtnLabel.setText("Submit Leads (0 Selected)");
        binding.btnSubmitLeads.setEnabled(false);
        binding.btnSubmitLeads.setAlpha(0.5f);
    }

    private void setupAdapters() {
        // Contacts list adapter
        contactAdapter = new ContactSelectAdapter(this, selectedCount -> {
            binding.txtSelectedCount.setText(selectedCount + " selected");
            binding.txtSubmitBtnLabel.setText("Submit Leads (" + selectedCount + " Selected)");
            boolean hasSelection = selectedCount > 0;
            binding.btnSubmitLeads.setEnabled(hasSelection);
            binding.btnSubmitLeads.setAlpha(hasSelection ? 1.0f : 0.5f);
        });
        binding.recyclerContacts.setLayoutManager(new LinearLayoutManager(this));
        binding.recyclerContacts.setAdapter(contactAdapter);

        // Submitted leads list adapter
        leadsAdapter = new SubmittedLeadsAdapter(this);
        binding.recyclerSubmittedLeads.setLayoutManager(new LinearLayoutManager(this));
        binding.recyclerSubmittedLeads.setAdapter(leadsAdapter);
    }

    private void setupListeners() {
        // Back
        binding.imgBack.setOnClickListener(v -> finish());

        // Refresh leads button in header
        binding.btnRefreshLeads.setOnClickListener(v -> {
            selectTab(false);
            fetchMyLeads();
        });

        // Tabs
        binding.tabSelectContacts.setOnClickListener(v -> selectTab(true));
        binding.tabMyLeads.setOnClickListener(v -> selectTab(false));

        // Grant Permission Button
        binding.btnGrantPermission.setOnClickListener(v -> requestContactsPermission());

        // Select All / Deselect All
        binding.btnToggleSelectAll.setOnClickListener(v -> {
            isAllSelected = !isAllSelected;
            contactAdapter.toggleSelectAll(isAllSelected);
            binding.btnToggleSelectAll.setText(isAllSelected ? "Deselect All" : "Select All");
        });

        // Search in contacts
        binding.edSearchContact.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                String q = s != null ? s.toString() : "";
                contactAdapter.filter(q);
                binding.imgClearSearch.setVisibility(q.isEmpty() ? View.GONE : View.VISIBLE);
            }

            @Override
            public void afterTextChanged(Editable s) {
            }
        });

        binding.imgClearSearch.setOnClickListener(v -> binding.edSearchContact.setText(""));

        // Bottom submit leads button
        binding.btnSubmitLeads.setOnClickListener(v -> submitSelectedLeads());

        // SwipeRefresh for submitted leads
        binding.swipeLeads.setOnRefreshListener(this::fetchMyLeads);

        // Empty state CTA -> jump to contacts tab
        binding.btnEmptyGoSelect.setOnClickListener(v -> selectTab(true));
    }

    private void selectTab(boolean isContactsTab) {
        if (isContactsTab) {
            binding.tabSelectContacts.setBackgroundResource(R.drawable.bg_lead_tab_selected);
            binding.tabSelectContacts.setTextColor(Color.WHITE);

            binding.tabMyLeads.setBackgroundResource(R.drawable.bg_lead_tab_unselected);
            binding.tabMyLeads.setTextColor(Color.parseColor("#64748B"));

            binding.layoutContactsTab.setVisibility(View.VISIBLE);
            binding.layoutLeadsTab.setVisibility(View.GONE);
        } else {
            binding.tabMyLeads.setBackgroundResource(R.drawable.bg_lead_tab_selected);
            binding.tabMyLeads.setTextColor(Color.WHITE);

            binding.tabSelectContacts.setBackgroundResource(R.drawable.bg_lead_tab_unselected);
            binding.tabSelectContacts.setTextColor(Color.parseColor("#64748B"));

            binding.layoutContactsTab.setVisibility(View.GONE);
            binding.layoutLeadsTab.setVisibility(View.VISIBLE);

            fetchMyLeads();
        }
    }

    private void checkAndLoadContacts() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
                == PackageManager.PERMISSION_GRANTED) {
            binding.layoutPermissionDenied.setVisibility(View.GONE);
            binding.recyclerContacts.setVisibility(View.VISIBLE);
            binding.layoutBottomSubmit.setVisibility(View.VISIBLE);
            loadContactsAsync();
        } else {
            binding.layoutPermissionDenied.setVisibility(View.VISIBLE);
            binding.recyclerContacts.setVisibility(View.GONE);
            binding.layoutBottomSubmit.setVisibility(View.GONE);
        }
    }

    private void requestContactsPermission() {
        ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.READ_CONTACTS},
                REQ_CONTACTS_PERMISSION
        );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CONTACTS_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                checkAndLoadContacts();
            } else {
                Toast.makeText(this, "Contacts permission is required to select leads", Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void loadContactsAsync() {
        binding.progressLoadingContacts.setVisibility(View.VISIBLE);
        binding.txtEmptyContacts.setVisibility(View.GONE);

        executor.execute(() -> {
            Map<String, ContactItem> uniqueMap = new LinkedHashMap<>();
            ContentResolver cr = getContentResolver();

            try (Cursor cursor = cr.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            ContactsContract.CommonDataKinds.Phone.NUMBER
                    },
                    null,
                    null,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " COLLATE NOCASE ASC"
            )) {
                if (cursor != null) {
                    int nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                    int numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);

                    while (cursor.moveToNext()) {
                        String name = nameIndex >= 0 ? cursor.getString(nameIndex) : "";
                        String rawNumber = numberIndex >= 0 ? cursor.getString(numberIndex) : "";

                        if (rawNumber == null || rawNumber.trim().isEmpty()) continue;

                        String digitsOnly = rawNumber.replaceAll("[^0-9]", "");
                        if (digitsOnly.length() < 10) continue;

                        // Normalize to last 10 digits to match backend deduplication
                        String normalizedPhone = digitsOnly.substring(digitsOnly.length() - 10);

                        if (!uniqueMap.containsKey(normalizedPhone)) {
                            uniqueMap.put(normalizedPhone, new ContactItem(
                                    name != null && !name.trim().isEmpty() ? name.trim() : normalizedPhone,
                                    normalizedPhone,
                                    rawNumber.trim()
                            ));
                        }
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }

            List<ContactItem> contactsList = new ArrayList<>(uniqueMap.values());

            runOnUiThread(() -> {
                binding.progressLoadingContacts.setVisibility(View.GONE);
                contactAdapter.setContacts(contactsList);
                if (contactsList.isEmpty()) {
                    binding.txtEmptyContacts.setVisibility(View.VISIBLE);
                    binding.txtEmptyContacts.setText("No mobile contacts found on device");
                }
            });
        });
    }

    private void submitSelectedLeads() {
        List<ContactItem> selected = contactAdapter.getSelectedContacts();
        if (selected.isEmpty()) {
            Toast.makeText(this, "Please select at least one contact", Toast.LENGTH_SHORT).show();
            return;
        }

        if (riderId == 0) {
            Toast.makeText(this, "Driver session invalid, please relogin", Toast.LENGTH_SHORT).show();
            return;
        }

        // Show button progress
        binding.txtSubmitBtnLabel.setVisibility(View.GONE);
        binding.progressSubmit.setVisibility(View.VISIBLE);
        binding.btnSubmitLeads.setEnabled(false);

        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderId);

        List<Map<String, String>> contactsArray = new ArrayList<>();
        for (ContactItem c : selected) {
            Map<String, String> item = new HashMap<>();
            item.put("name", c.getName());
            item.put("phone", c.getPhone());
            contactsArray.add(item);
        }
        body.put("contacts", contactsArray);

        NodeApiClient.getInterface().submitLeads(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                binding.txtSubmitBtnLabel.setVisibility(View.VISIBLE);
                binding.progressSubmit.setVisibility(View.GONE);
                binding.btnSubmitLeads.setEnabled(true);

                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resp = response.body();
                    String result = resp.has("Result") ? resp.get("Result").getAsString() : "false";

                    if ("true".equalsIgnoreCase(result)) {
                        int accepted = resp.has("accepted") ? resp.get("accepted").getAsInt() : 0;
                        JsonArray skippedArr = resp.has("skipped") && resp.get("skipped").isJsonArray()
                                ? resp.getAsJsonArray("skipped") : new JsonArray();

                        showSubmitResultDialog(accepted, skippedArr);

                        // Reset selection
                        contactAdapter.toggleSelectAll(false);
                        isAllSelected = false;
                        binding.btnToggleSelectAll.setText("Select All");
                    } else {
                        String msg = resp.has("ResponseMsg") ? resp.get("ResponseMsg").getAsString() : "Failed to submit leads";
                        Toast.makeText(LeadReferralActivity.this, msg, Toast.LENGTH_LONG).show();
                    }
                } else {
                    Toast.makeText(LeadReferralActivity.this, "Server error submitting leads", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                binding.txtSubmitBtnLabel.setVisibility(View.VISIBLE);
                binding.progressSubmit.setVisibility(View.GONE);
                binding.btnSubmitLeads.setEnabled(true);
                Toast.makeText(LeadReferralActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void showSubmitResultDialog(int accepted, JsonArray skippedArr) {
        StringBuilder msg = new StringBuilder();
        msg.append("✅ ").append(accepted).append(" contact(s) submitted successfully!\n\n");
        msg.append("Our ops team will verify them shortly. You'll receive 100 Reward Points on their 1st ride and become their Favorite Driver.\n");

        if (skippedArr.size() > 0) {
            msg.append("\n⚠️ ").append(skippedArr.size()).append(" contact(s) skipped:\n");
            for (int i = 0; i < skippedArr.size(); i++) {
                JsonElement elem = skippedArr.get(i);
                if (elem.isJsonObject()) {
                    JsonObject skipObj = elem.getAsJsonObject();
                    String phone = skipObj.has("phone") ? skipObj.get("phone").getAsString() : "";
                    String reason = skipObj.has("reason") ? skipObj.get("reason").getAsString() : "";

                    String friendlyReason = "Already registered or referred";
                    if ("already_registered".equalsIgnoreCase(reason)) {
                        friendlyReason = "Already registered user";
                    } else if ("already_submitted".equalsIgnoreCase(reason)) {
                        friendlyReason = "Already submitted by a driver";
                    } else if ("invalid_phone".equalsIgnoreCase(reason)) {
                        friendlyReason = "Invalid phone number";
                    }

                    msg.append("• ").append(phone).append(" (").append(friendlyReason).append(")\n");
                }
            }
        }

        new AlertDialog.Builder(this)
                .setTitle("Lead Submission Status")
                .setMessage(msg.toString())
                .setPositiveButton("View My Leads", (dialog, which) -> selectTab(false))
                .setNegativeButton("OK", null)
                .show();
    }

    private void fetchMyLeads() {
        if (riderId == 0) return;

        binding.swipeLeads.setRefreshing(true);
        NodeApiClient.getInterface().getMyLeads(riderId).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                binding.swipeLeads.setRefreshing(false);

                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resp = response.body();
                    String result = resp.has("Result") ? resp.get("Result").getAsString() : "false";

                    if ("true".equalsIgnoreCase(result) && resp.has("leads") && resp.get("leads").isJsonArray()) {
                        Type listType = new TypeToken<List<LeadItem>>() {}.getType();
                        List<LeadItem> leadsList = new Gson().fromJson(resp.getAsJsonArray("leads"), listType);

                        if (leadsList == null) {
                            leadsList = new ArrayList<>();
                        }

                        leadsAdapter.setLeads(leadsList);

                        // Update counters
                        int total = leadsList.size();
                        int verified = 0;
                        int converted = 0;

                        for (LeadItem l : leadsList) {
                            String s = l.getStatus().toLowerCase(Locale.ROOT);
                            if ("verified".equals(s)) verified++;
                            else if ("converted".equals(s)) converted++;
                        }

                        binding.txtStatTotal.setText(String.valueOf(total));
                        binding.txtStatVerified.setText(String.valueOf(verified));
                        binding.txtStatConverted.setText(String.valueOf(converted));

                        if (leadsList.isEmpty()) {
                            binding.layoutEmptyLeads.setVisibility(View.VISIBLE);
                            binding.recyclerSubmittedLeads.setVisibility(View.GONE);
                        } else {
                            binding.layoutEmptyLeads.setVisibility(View.GONE);
                            binding.recyclerSubmittedLeads.setVisibility(View.VISIBLE);
                        }
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                binding.swipeLeads.setRefreshing(false);
                Toast.makeText(LeadReferralActivity.this, "Failed to load leads", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
