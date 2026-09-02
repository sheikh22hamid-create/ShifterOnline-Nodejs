package com.shifter.driver.socket;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.Iterator;

import io.socket.client.IO;
import io.socket.client.Socket;

/**
 * One persistent Socket.io connection to the Node order-flow backend,
 * opened when the driver goes online and closed when they go offline —
 * the same lifecycle as LocationUpdateService, which is a foreground
 * Service and already keeps the process (and this socket) alive in the
 * background. See docs/superpowers/plans/2026-09-02-driver-app-node-
 * socket-integration.md Global Constraints for why this is safe.
 */
public class NodeSocketManager {

    private static final String TAG = "NodeSocketManager";
    public static final String NODE_BASE_URL = "https://shifteronline-nodejs.onrender.com";

    /** Must match BaseActivity.ACTION_ORDER_NOTIFICATION / EXTRA_ORDER_ID exactly — see Task 2 note. */
    public static final String ACTION_ORDER_NOTIFICATION = "com.shifter.driver.ORDER_NOTIFICATION";
    public static final String EXTRA_ORDER_ID = "order_id";
    public static final String ACTION_ORDER_DISMISS = "com.shifter.driver.ORDER_DISMISS";

    private static NodeSocketManager instance;

    private Socket socket;
    private int riderId = -1;
    private Context appContext;

    private NodeSocketManager() {
    }

    public static synchronized NodeSocketManager getInstance() {
        if (instance == null) {
            instance = new NodeSocketManager();
        }
        return instance;
    }

    public synchronized void connect(Context context, int riderId) {
        if (socket != null && socket.connected() && this.riderId == riderId) {
            return; // already connected for this rider — no-op
        }
        disconnect();

        this.appContext = context.getApplicationContext();
        this.riderId = riderId;

        try {
            IO.Options opts = new IO.Options();
            opts.reconnection = true;
            opts.reconnectionDelay = 2000;
            opts.forceNew = true;
            socket = IO.socket(NODE_BASE_URL, opts);
        } catch (URISyntaxException e) {
            Log.e(TAG, "Bad Node socket URL", e);
            socket = null;
            return;
        }

        socket.on(Socket.EVENT_CONNECT, args -> {
            Log.d(TAG, "Node socket connected — joining driver_" + this.riderId);
            JSONObject payload = new JSONObject();
            try {
                payload.put("rider_id", this.riderId);
            } catch (JSONException ignored) {
            }
            socket.emit("driver:join", payload);
        });

        socket.on(Socket.EVENT_DISCONNECT, args -> Log.d(TAG, "Node socket disconnected"));
        socket.on(Socket.EVENT_CONNECT_ERROR, args ->
                Log.e(TAG, "Node socket connect_error: " + (args.length > 0 ? String.valueOf(args[0]) : "unknown")));

        socket.on("order:request", args -> handleOrderRequest(args));
        socket.on("order:dismiss", args -> handleOrderDismiss(args));

        socket.connect();
    }

    private void handleOrderRequest(Object[] args) {
        if (args.length == 0 || !(args[0] instanceof JSONObject) || appContext == null) return;
        JSONObject data = (JSONObject) args[0];

        String orderId = data.optString("order_id", "");
        if (orderId.isEmpty()) return;

        Intent intent = new Intent(ACTION_ORDER_NOTIFICATION);
        intent.setPackage(appContext.getPackageName());
        intent.putExtra(EXTRA_ORDER_ID, orderId);

        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            intent.putExtra(key, data.optString(key, ""));
        }

        Log.d(TAG, "order:request received for order_id=" + orderId + " — broadcasting to foreground Activities");
        appContext.sendBroadcast(intent);
    }

    private void handleOrderDismiss(Object[] args) {
        if (args.length == 0 || !(args[0] instanceof JSONObject) || appContext == null) return;
        JSONObject data = (JSONObject) args[0];

        String orderId = data.optString("order_id", "");
        String reason = data.optString("reason", "");
        Log.d(TAG, "order:dismiss received for order_id=" + orderId + " reason=" + reason);

        Intent intent = new Intent(ACTION_ORDER_DISMISS);
        intent.setPackage(appContext.getPackageName());
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra("reason", reason);
        appContext.sendBroadcast(intent);
    }

    public synchronized void disconnect() {
        if (socket != null) {
            socket.off();
            socket.disconnect();
            socket = null;
        }
        riderId = -1;
    }

    public boolean isConnected() {
        return socket != null && socket.connected();
    }

    public Socket getSocket() {
        return socket;
    }
}
