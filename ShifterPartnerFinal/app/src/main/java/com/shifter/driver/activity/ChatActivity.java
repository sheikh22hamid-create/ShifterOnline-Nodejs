package com.shifter.driver.activity;

import static androidx.constraintlayout.helper.widget.MotionEffect.TAG;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.RelativeLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.firebase.firestore.DocumentChange;
import com.google.firebase.firestore.FirebaseFirestore;
import com.shifter.driver.R;
import com.shifter.driver.adepter.ChatAdapter;
import com.shifter.driver.databinding.ChatMainBinding;
import com.shifter.driver.model.Chat;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.utility.SessionManager;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ChatActivity extends AppCompatActivity {
    private ChatMainBinding binding;

    private List<Chat> mChats;

    private ChatAdapter mAdapter;

    SessionManager sessionManager;
    RiderData riderData;

    private FirebaseFirestore db;
    String admin="Admin";
    @SuppressLint("HardwareIds")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ChatMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        db = FirebaseFirestore.getInstance();

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        
        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.btSent.setOnClickListener(this::onBindClick);

        mChats = new ArrayList<>();
        final LinearLayoutManager linearLayoutManager = new LinearLayoutManager(this);
        linearLayoutManager.setReverseLayout(false);
        binding.rvChat.setLayoutManager(linearLayoutManager);
        mAdapter = new ChatAdapter(mChats, String.valueOf(riderData.getId()));
        binding.rvChat.setAdapter(mAdapter);

        Map<String, Object> city = new HashMap<>();
        city.put("name", riderData.getFullName());
        city.put("image", riderData.getProfilePicture());
        city.put("id", riderData.getId());

        db.collection("Admin").document(String.valueOf(riderData.getId()))
                .update(city)
                .addOnSuccessListener(aVoid -> Log.d(TAG, "DocumentSnapshot successfully written!"))
                .addOnFailureListener(e -> Log.w(TAG, "Error writing document", e));



        db.collection(admin).document(String.valueOf(riderData.getId())).collection("messages").orderBy("createdAt").addSnapshotListener((snapshots, e) -> {
            if (e != null) {
                Log.w(TAG, "listen:error", e);
                return;
            }

            for (DocumentChange dc : snapshots.getDocumentChanges()) {
                switch (dc.getType()) {
                    case ADDED:
                        Log.d(TAG, "New city: " + dc.getDocument().getData());
                        Chat chat = new Chat();
                        chat.setSenderId(dc.getDocument().getData().get("senderId").toString());
                        chat.setMessage(dc.getDocument().getData().get("message").toString());
                        chat.setCreatedAt(dc.getDocument().getData().get("createdAt").toString());
                        mChats.add(chat);
                        mAdapter.notifyDataSetChanged();
                        binding.rvChat.scrollToPosition(mChats.size() - 1);
                        break;
                    case MODIFIED:
                        Log.d(TAG, "Modified city: " + dc.getDocument().getData());
                        break;
                    case REMOVED:
                        Log.d(TAG, "Removed city: " + dc.getDocument().getData());
                        break;
                }
            }

        });
    }

    public void onBindClick(View view) {
        int id = view.getId();
        if (id == R.id.btSent) {
            if (!TextUtils.isEmpty(binding.etText.getText().toString())) {
                sendMessege();
            }
        } else if (id == R.id.img_back) {
            finish();
        }
    }

    public void sendMessege() {

        Date today = new Date();
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss ");
        String dateToStr = format.format(today);

        Map<String, Object> msg = new HashMap<>();
        msg.put("message", binding.etText.getText().toString());
        msg.put("createdAt", dateToStr);
        msg.put("senderId", riderData.getId());
        binding.etText.setText("");

        db.collection(admin).document(String.valueOf(riderData.getId())).collection("messages").add(msg).addOnSuccessListener(documentReference -> Log.e("respons", "-->" + documentReference.toString()))
                .addOnFailureListener(e -> Log.e("Error", "-->" + e));


    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
    }
}
