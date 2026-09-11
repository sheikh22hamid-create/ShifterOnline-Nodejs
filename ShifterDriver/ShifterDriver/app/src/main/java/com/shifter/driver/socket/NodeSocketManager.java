package com.shifter.driver.socket;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.concurrent.atomic.AtomicBoolean;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

/**
 * Single, app-wide socket connection to the Node order/dispatch backend
 * (see backend/API_INTEGRATION_GUIDE.md). Connect once after login (or on
 * app start while already logged in) and leave it connected for the whole
 * session — driver:join must be re-sent on every (re)connect, which this
 * class does automatically via a connect listener, so a dropped/rebuilt
 * connection doesn't silently stop delivering order popups.
 *
 * All listener callbacks are delivered on the main thread.
 */
public class NodeSocketManager {

    private static final String TAG = "NodeSocketManager";

    // Same backend the customer app points at — see
    // backend/API_INTEGRATION_GUIDE.md.
    private static final String BASE_URL = "https://shifteronline-nodejs-dev.onrender.com";

    private static NodeSocketManager instance;

    private Socket socket;
    private int riderId = -1;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public interface OrderRequestListener {
        void onOrderRequest(JSONObject data);
        void onOrderDismiss(JSONObject data);
    }

    public interface NextDayAssignmentListener {
        void onNextDayAssigned(JSONObject data);
    }

    public interface QueueUpdateListener {
        void onQueueUpdate(JSONObject data);
    }

    public interface AckListener {
        void onAck(JSONObject data);
    }

    private OrderRequestListener orderRequestListener;
    private NextDayAssignmentListener nextDayAssignmentListener;
    private QueueUpdateListener queueUpdateListener;

    private NodeSocketManager() {}

    public static synchronized NodeSocketManager getInstance() {
        if (instance == null) {
            instance = new NodeSocketManager();
        }
        return instance;
    }

    public boolean isConnected() {
        return socket != null && socket.connected();
    }

    /** Call once after login, or at app start while already logged in. */
    public synchronized void connectDriver(int riderId) {
        if (socket != null && this.riderId == riderId) {
            // Already set up for this driver — connect() below is a no-op
            // if already connected, and re-joins on its own reconnect event
            // otherwise.
            if (!socket.connected()) socket.connect();
            return;
        }

        this.riderId = riderId;
        disconnectInternal();

        try {
            IO.Options options = new IO.Options();
            options.reconnection = true;
            socket = IO.socket(BASE_URL, options);
        } catch (URISyntaxException e) {
            Log.e(TAG, "Bad socket URL", e);
            return;
        }

        socket.on(Socket.EVENT_CONNECT, args -> {
            Log.d(TAG, "connected, joining as driver " + riderId);
            JSONObject payload = new JSONObject();
            try {
                payload.put("rider_id", riderId);
            } catch (Exception ignored) {}
            socket.emit("driver:join", payload);
        });

        socket.on(Socket.EVENT_DISCONNECT, args -> Log.d(TAG, "disconnected"));
        socket.on(Socket.EVENT_CONNECT_ERROR, args ->
                Log.e(TAG, "connect error: " + (args.length > 0 ? args[0] : "")));

        socket.on("order:request", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderRequestListener != null) {
                orderRequestListener.onOrderRequest(data);
            }
        }));

        socket.on("order:direct_assign", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderRequestListener != null) {
                orderRequestListener.onOrderRequest(data);
            }
        }));

        socket.on("order:assigned", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderRequestListener != null) {
                orderRequestListener.onOrderRequest(data);
            }
        }));

        socket.on("order:scheduled_assigned", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderRequestListener != null) {
                orderRequestListener.onOrderRequest(data);
            }
        }));

        socket.on("order:dismiss", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && orderRequestListener != null) {
                orderRequestListener.onOrderDismiss(data);
            }
        }));

        socket.on("order:next_day_assigned", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (data != null && nextDayAssignmentListener != null) {
                nextDayAssignmentListener.onNextDayAssigned(data);
            }
        }));

        socket.on("queue:update", args -> mainHandler.post(() -> {
            JSONObject data = firstArgAsJson(args);
            if (queueUpdateListener != null) {
                queueUpdateListener.onQueueUpdate(data != null ? data : new JSONObject());
            }
        }));

        socket.connect();
    }

    /** Set once, e.g. from MyApplication — the single receiver of order:request/dismiss. */
    public void setOrderRequestListener(OrderRequestListener listener) {
        this.orderRequestListener = listener;
    }

    /** Set once, e.g. from MyApplication — forced next-day-order notification, no accept/reject. */
    public void setNextDayAssignmentListener(NextDayAssignmentListener listener) {
        this.nextDayAssignmentListener = listener;
    }

    /** Listener for real-time monthly queued orders updates. */
    public void setQueueUpdateListener(QueueUpdateListener listener) {
        this.queueUpdateListener = listener;
    }

    public void emitAccept(JSONObject data, AckListener ackListener) {
        onceThenEmit("order:accept:ack", "order:accept", data, ackListener);
    }

    /** No ack from the server for a reject — fire and forget. */
    public void emitReject(JSONObject data) {
        emit("order:reject", data);
    }

    public void emitStatusUpdate(JSONObject data, AckListener ackListener) {
        onceThenEmit("order:status_update:ack", "order:status_update", data, ackListener);
    }

    /** Call repeatedly (e.g. every 3-5s) while a trip is active. */
    public void emitLocationPing(JSONObject data) {
        emit("driver:location_ping", data);
    }

    private void emit(String event, JSONObject data) {
        if (socket == null) {
            Log.w(TAG, "emit(" + event + ") called before connectDriver()");
            return;
        }
        socket.emit(event, data);
    }

    private void onceThenEmit(String ackEvent, String emitEvent, JSONObject data, AckListener ackListener) {
        onceThenEmit(ackEvent, emitEvent, data, ackListener, 0);
    }

    private void onceThenEmit(String ackEvent, String emitEvent, JSONObject data,
                              AckListener ackListener, int connectionAttempts) {
        if (this.riderId <= 0) {
            if (data != null && data.has("rider_id")) {
                try {
                    int rId = data.optInt("rider_id", -1);
                    if (rId <= 0) {
                        rId = Integer.parseInt(data.optString("rider_id", "-1"));
                    }
                    if (rId > 0) this.riderId = rId;
                } catch (Exception ignored) {}
            }
            if (this.riderId <= 0 && com.shifter.driver.MyApplication.mContext != null) {
                try {
                    com.shifter.driver.utility.SessionManager sm = new com.shifter.driver.utility.SessionManager(com.shifter.driver.MyApplication.mContext);
                    com.shifter.driver.model.RiderData rd = sm.getUserDetails();
                    if (rd != null && rd.getId() > 0) {
                        this.riderId = rd.getId();
                    }
                } catch (Exception ignored) {}
            }
        }

        if (socket == null || !socket.connected()) {
            if (this.riderId > 0 && connectionAttempts < 30) {
                Log.d(TAG, "emit(" + emitEvent + ") waiting for socket connection (riderId=" + this.riderId + ", attempt=" + connectionAttempts + ")");
                connectDriver(this.riderId);
                mainHandler.postDelayed(() -> onceThenEmit(
                        ackEvent, emitEvent, data, ackListener, connectionAttempts + 1), 400L);
                return;
            }

            Log.w(TAG, "emit(" + emitEvent + ") called before connectDriver()");
            mainHandler.post(() -> {
                if (ackListener != null) {
                    JSONObject failure = new JSONObject();
                    try { failure.put("Result", false); failure.put("msg", "Connection unavailable"); } catch (Exception ignored) {}
                    ackListener.onAck(failure);
                }
            });
            return;
        }
        final AtomicBoolean delivered = new AtomicBoolean(false);
        socket.once(ackEvent, args -> mainHandler.post(() -> {
            if (!delivered.compareAndSet(false, true)) return;
            JSONObject ackData = firstArgAsJson(args);
            if (ackListener != null) ackListener.onAck(ackData != null ? ackData : new JSONObject());
        }));
        socket.emit(emitEvent, data);

        // Never leave the driver's progress dialog open forever when the
        // socket reconnects or the server does not send an acknowledgement.
        mainHandler.postDelayed(() -> {
            if (!delivered.compareAndSet(false, true)) return;
            JSONObject failure = new JSONObject();
            try {
                failure.put("Result", false);
                failure.put("msg", "Server did not respond. Please try again.");
            } catch (Exception ignored) {}
            if (ackListener != null) ackListener.onAck(failure);
        }, 25_000L);
    }

    private JSONObject firstArgAsJson(Object[] args) {
        if (args.length > 0 && args[0] instanceof JSONObject) {
            return (JSONObject) args[0];
        }
        return null;
    }

    private void disconnectInternal() {
        if (socket != null) {
            socket.off();
            socket.disconnect();
            socket = null;
        }
    }

    /** Call on logout only — not when the app backgrounds/foregrounds. */
    public synchronized void disconnect() {
        disconnectInternal();
        riderId = -1;
        orderRequestListener = null;
    }
}
