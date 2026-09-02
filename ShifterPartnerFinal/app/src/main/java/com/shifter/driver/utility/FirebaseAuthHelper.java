package com.shifter.driver.utility;

import android.content.Context;
import android.os.AsyncTask;
import android.util.Log;
import com.google.auth.oauth2.GoogleCredentials;
import java.io.IOException;
import java.io.InputStream;

public class FirebaseAuthHelper {
    private final Context context;

    public FirebaseAuthHelper(Context context) {
        this.context = context;
    }

    public void getAccessToken(AccessTokenCallback callback) {
        new AsyncTask<Void, Void, String>() {
            @Override
            protected String doInBackground(Void... voids) {
                try {
                    InputStream serviceAccount = context.getAssets().open("service-account.json");
                    GoogleCredentials credentials = GoogleCredentials.fromStream(serviceAccount)
                            .createScoped("https://www.googleapis.com/auth/firebase.messaging");
                    credentials.refreshIfExpired();
                    return credentials.getAccessToken().getTokenValue();
                } catch (IOException e) {
                    e.printStackTrace();
                    Log.e("Error", "Failed to get access token: " + e.getMessage());
                    return null;
                }
            }

            @Override
            protected void onPostExecute(String token) {
                if (callback != null) {
                    callback.onTokenReceived(token);
                }
            }
        }.execute();
    }

    public interface AccessTokenCallback {
        void onTokenReceived(String token);
    }
}
