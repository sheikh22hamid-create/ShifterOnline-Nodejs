package com.shifter.driver.activity;

import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Query;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ChatUserMainBinding;
import com.shifter.driver.model.MessageChat;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.utility.AppStatus;
import com.shifter.driver.utility.FirebaseAuthHelper;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONObject;

import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class ChatActivityUser extends AppCompatActivity {
    private ChatUserMainBinding binding;

    private MessageAdapter adapter;
    private List<MessageChat> messages;
    private FirebaseFirestore db;
    private String chatId, currentRiderID, receiverId,receiverName;
    SessionManager sessionManager;
    RiderData riderData;
    String accessToken;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ChatUserMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        sessionManager = new SessionManager(this);

        db = FirebaseFirestore.getInstance();
        riderData = sessionManager.getUserDetails();
        if (riderData != null) {
            currentRiderID = String.valueOf(riderData.getId());
        }
        receiverId = getIntent().getStringExtra("receiverId");
        receiverName = getIntent().getStringExtra("receiverName");
        chatId = currentRiderID + "_" + receiverId;

        binding.txtName.setText(receiverName);

        messages = new ArrayList<>();
        adapter = new MessageAdapter(messages, currentRiderID);
        binding.rvChat.setLayoutManager(new LinearLayoutManager(this));
        binding.rvChat.setAdapter(adapter);

        binding.btSent.setOnClickListener(v -> sendMessage());
        binding.imgBack.setOnClickListener(view -> {
            finish();
        });
        listenForMessages();

        FirebaseAuthHelper authHelper = new FirebaseAuthHelper(getApplicationContext());
        authHelper.getAccessToken(token -> {
            Log.d("FCM Access Token", token);
            accessToken=token;
        });

    }

    private void sendMessage() {
        String text = binding.etText.getText().toString().trim();
        if (text.isEmpty()) return;

        Map<String, Object> message = new HashMap<>();
        message.put("senderId", currentRiderID);
        message.put("receiverId", receiverId);
        message.put("message", text);
        message.put("timestamp", System.currentTimeMillis());

        db.collection("Parcelchats").document(chatId).collection("messages")
                .add(message)
                .addOnSuccessListener(documentReference -> Log.d("Chat", "Message sent"))
                .addOnFailureListener(e -> Log.e("Chat", "Error sending message", e));

        binding.etText.setText("");
        db.collection("CustomerParcel").document(receiverId).get()
                .addOnSuccessListener(documentSnapshot -> {
                    if (documentSnapshot.exists()) {
                        String token = documentSnapshot.getString("token");
                        Log.e("token--", token);
                        if (token != null) {

                            sendNotification(token, riderData.getFullName(),text);
                        }
                    }
                })
                .addOnFailureListener(e -> Log.e("Chat", "Error fetching FCM Token", e));

    }





    private static final String FCM_URL = "https://fcm.googleapis.com/v1/projects/studio-67236/messages:send";

    public void sendNotification(String deviceToken, String title, String message) {

        if (accessToken == null) {
            System.out.println("Failed to get access token.");
            return;
        }

        OkHttpClient client = new OkHttpClient();

        // Create JSON payload
        JSONObject jsonPayload = new JSONObject();
        try {
            JSONObject messageObject = new JSONObject();
            messageObject.put("token", deviceToken);

            JSONObject notificationObject = new JSONObject();
            notificationObject.put("title", title);
            notificationObject.put("body", message);

            JSONObject data = new JSONObject();
            data.put("receiverId", riderData.getId());
            data.put("receiverName", riderData.getFullName());
            data.put("receiverMobile", riderData.getMobile());
            data.put("receiverImage", riderData.getProfilePicture());
            messageObject.put("notification", notificationObject);
            messageObject.put("data", data);
            jsonPayload.put("message", messageObject);
        } catch (Exception e) {
            e.printStackTrace();
            return;
        }

        RequestBody body = RequestBody.create(
                jsonPayload.toString(),
                MediaType.get("application/json; charset=utf-8")
        );

        Request request = new Request.Builder()
                .url(FCM_URL)
                .addHeader("Authorization", "Bearer " + accessToken)
                .addHeader("Content-Type", "application/json")
                .post(body)
                .build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                e.printStackTrace();
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                System.out.println("Response: " + response.body().string());
            }
        });
    }


    private void listenForMessages() {
        db.collection("Parcelchats").document(chatId).collection("messages")
                .orderBy("timestamp", Query.Direction.ASCENDING)
                .addSnapshotListener((value, error) -> {
                    if (error != null) {
                        Log.e("Chat", "Error fetching messages", error);
                        return;
                    }
                    messages.clear();
                    for (DocumentSnapshot doc : value.getDocuments()) {
                        try {
                            messages.add(doc.toObject(MessageChat.class));

                        }catch (Exception e){

                        }
                    }
                    adapter.notifyDataSetChanged();
                    binding.rvChat.scrollToPosition(messages.size() - 1);
                });
    }


    public class MessageAdapter extends RecyclerView.Adapter<MessageAdapter.ViewHolder> {
    private ChatUserMainBinding binding;

        private final List<MessageChat> messages;
        private final String currentUserId;

        public MessageAdapter(List<MessageChat> messages, String currentUserId) {
            this.messages = messages;
            this.currentUserId = currentUserId;
        }

        @NonNull
        @Override
        public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_message, parent, false);
            return new ViewHolder(view);
        }

        @Override
        public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
            MessageChat message = messages.get(position);
            String formattedTime = formatTimestamp(message.getTimestamp());

            if (message.getSenderId().equals(currentUserId)) {
                holder.sentMessage.setText(message.getMessage());
                holder.sentTime.setText(formattedTime);
//                holder.sentMessage.setVisibility(View.VISIBLE);
//                holder.sentTime.setVisibility(View.VISIBLE);
                holder.sendLayout.setVisibility(View.VISIBLE);
//                holder.receivedMessage.setVisibility(View.GONE);
//                holder.receivedTime.setVisibility(View.GONE);
                holder.reciveLayout.setVisibility(View.GONE);
            } else {
                holder.receivedMessage.setText(message.getMessage());
                holder.receivedTime.setText(formattedTime);
//                holder.receivedMessage.setVisibility(View.VISIBLE);
//                holder.receivedMessage.setVisibility(View.VISIBLE);
                holder.reciveLayout.setVisibility(View.VISIBLE);
//                holder.sentMessage.setVisibility(View.GONE);
//                holder.sentTime.setVisibility(View.GONE);
                holder.sendLayout.setVisibility(View.GONE);
            }
        }

        @Override
        public int getItemCount() {
            return messages.size();
        }

        class ViewHolder extends RecyclerView.ViewHolder {
            TextView sentMessage, receivedMessage, sentTime, receivedTime;
            LinearLayout sendLayout, reciveLayout;

            ViewHolder(View itemView) {
                super(itemView);
                sendLayout = itemView.findViewById(R.id.sentMessagelayout);
                reciveLayout = itemView.findViewById(R.id.receivedMessagelayout);
                sentMessage = itemView.findViewById(R.id.sentMessage);
                receivedMessage = itemView.findViewById(R.id.receivedMessage);
                sentTime = itemView.findViewById(R.id.sentTime);
                receivedTime = itemView.findViewById(R.id.receivedTime);
            }
        }
    }

    public String formatTimestamp(long timestamp) {
        Calendar messageTime = Calendar.getInstance();
        messageTime.setTimeInMillis(timestamp);

        Calendar now = Calendar.getInstance();

        SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
        SimpleDateFormat dateFormat = new SimpleDateFormat("dd MMM yyyy", Locale.getDefault());

        if (now.get(Calendar.YEAR) == messageTime.get(Calendar.YEAR)) {
            if (now.get(Calendar.DAY_OF_YEAR) == messageTime.get(Calendar.DAY_OF_YEAR)) {
                return timeFormat.format(messageTime.getTime()); // Today
            } else if (now.get(Calendar.DAY_OF_YEAR) - messageTime.get(Calendar.DAY_OF_YEAR) == 1) {
                return "Yesterday"; // Yesterday
            }
        }
        return dateFormat.format(messageTime.getTime()); // Older
    }

    @Override
    protected void onResume() {
        super.onResume();
        AppStatus.setChatActivityOpen(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        AppStatus.setChatActivityOpen(false);
    }

}
