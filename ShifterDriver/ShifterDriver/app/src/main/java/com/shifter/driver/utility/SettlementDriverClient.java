package com.shifter.driver.utility;

import android.content.Context;
import android.util.Log;

import com.google.gson.Gson;
import com.shifter.driver.model.SettlementResponse;
import com.shifter.driver.model.SettlementView;
import com.shifter.driver.retrofit.NodeApiClient;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Single client wrapper for all Driver Settlement API calls
 * (/api/rider/settlement/*).
 *
 * SECURITY GATE NOTE:
 * The rider settlement endpoints currently trust the posted rider_id in the body.
 * Real auth must ship before settlement_enabled is turned on in production (HARD GATE).
 * When real authentication headers/tokens are introduced, attach them here in one central place.
 */
public final class SettlementDriverClient {

    private static final String TAG = "SettlementDriverClient";

    public interface SettlementCallback {
        void onSuccess(SettlementView settlement);
        void onError(String code, String message);
    }

    public interface PendingSettlementsCallback {
        void onSuccess(List<SettlementView> settlements);
        void onError(String code, String message);
    }

    public interface ReceiverRefusedCallback {
        void onSuccess(String phase, SettlementView settlement);
        void onError(String code, String message);
    }

    public interface ResendLinkCallback {
        void onSuccess(boolean sent, String link);
        void onError(String code, String message);
    }

    private static Map<String, Object> createBaseBody(Context context, int riderId) {
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderId);
        // NOTE: SECURITY GATE: When auth tokens are enabled for rider settlement endpoints,
        // attach auth header/token or session token here.
        return body;
    }

    public static String getFriendlyErrorMessage(String code, String serverMsg) {
        if ("VALIDATION".equalsIgnoreCase(code)) {
            return "Invalid settlement data. Please check and try again.";
        } else if ("NOT_FOUND".equalsIgnoreCase(code)) {
            return "Settlement record not found for this order.";
        } else if ("FORBIDDEN".equalsIgnoreCase(code)) {
            return "Access denied for this settlement.";
        } else if ("INVALID_STATE".equalsIgnoreCase(code)) {
            return "This payment status has already changed or is currently under dispute.";
        } else if ("REASON_REQUIRED".equalsIgnoreCase(code)) {
            return "Please enter a valid dispute reason (at least 3 characters).";
        } else if ("WINDOW_CLOSED".equalsIgnoreCase(code)) {
            return "The dispute window for this order has expired.";
        } else if ("GATEWAY_ERROR".equalsIgnoreCase(code)) {
            return "Payment gateway error. Please try again.";
        } else if ("NOT_ACTIVE".equalsIgnoreCase(code) || "NOT_PAYABLE".equalsIgnoreCase(code)) {
            return "The receiver payment is no longer active.";
        } else if ("NOT_CONFIGURED".equalsIgnoreCase(code)) {
            return "The payment link is not available right now.";
        } else if ("TOO_SOON".equalsIgnoreCase(code)) {
            return "Please wait a minute before sending the link again.";
        } else if ("LINK_LIMIT".equalsIgnoreCase(code)) {
            return "The link was already sent too many times. Contact support.";
        }
        if (serverMsg != null && !serverMsg.trim().isEmpty()) {
            return serverMsg;
        }
        return "An error occurred while processing settlement. Please try again.";
    }

    /**
     * POST /api/rider/settlement/state
     * Fetches current settlement status view for an order.
     */
    public static void fetchState(Context context, int riderId, int orderId, SettlementCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);
        body.put("order_id", orderId);

        NodeApiClient.getInterface().getSettlementState(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                handleSettlementResponse(response, callback);
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "fetchState network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    /**
     * POST /api/rider/settlement/received
     * Confirms cash received by driver for this order. Idempotent.
     */
    public static void markReceived(Context context, int riderId, int orderId, SettlementCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);
        body.put("order_id", orderId);

        NodeApiClient.getInterface().markSettlementReceived(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                handleSettlementResponse(response, callback);
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "markReceived network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    /**
     * POST /api/rider/settlement/dispute
     * Raises dispute with driver reason (min 3 chars) while pending.
     */
    public static void raiseDispute(Context context, int riderId, int orderId, String reason, SettlementCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);
        body.put("order_id", orderId);
        body.put("reason", reason);

        NodeApiClient.getInterface().disputeSettlement(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                handleSettlementResponse(response, callback);
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "raiseDispute network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    /**
     * POST /api/rider/settlement/pending
     * Returns list of pending/disputed settlements for this driver (max 20, newest first).
     */
    public static void fetchPending(Context context, int riderId, PendingSettlementsCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);

        NodeApiClient.getInterface().getPendingSettlements(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                SettlementResponse resp = response.body();
                if (resp == null && response.errorBody() != null) {
                    try {
                        resp = new Gson().fromJson(response.errorBody().string(), SettlementResponse.class);
                    } catch (Exception ignored) {}
                }

                if (resp != null && resp.isSuccess()) {
                    if (callback != null) {
                        callback.onSuccess(resp.getSettlements());
                    }
                } else {
                    String code = resp != null ? resp.getCode() : "ERROR";
                    String msg = resp != null ? resp.getResponseMsg() : null;
                    if (callback != null) {
                        callback.onError(code, getFriendlyErrorMessage(code, msg));
                    }
                }
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "fetchPending network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    /**
     * POST /api/rider/settlement/receiver-refused
     * Driver reports the receiver refused to pay; backend converts the payer to the customer.
     */
    public static void receiverRefused(Context context, int riderId, int orderId, ReceiverRefusedCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);
        body.put("order_id", orderId);

        NodeApiClient.getInterface().receiverRefused(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                SettlementResponse resp = readBody(response);
                if (resp != null && resp.isSuccess()) {
                    if (callback != null) {
                        callback.onSuccess(resp.getPhase(), resp.getSettlement());
                    }
                } else if (callback != null) {
                    String code = resp != null ? resp.getCode() : "ERROR";
                    String msg = resp != null ? resp.getResponseMsg() : null;
                    callback.onError(code, getFriendlyErrorMessage(code, msg));
                }
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "receiverRefused network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    /**
     * POST /api/rider/settlement/resend-link
     * Re-sends the receiver's payment link; when WhatsApp delivery fails the link is returned.
     */
    public static void resendLink(Context context, int riderId, int orderId, ResendLinkCallback callback) {
        Map<String, Object> body = createBaseBody(context, riderId);
        body.put("order_id", orderId);

        NodeApiClient.getInterface().resendReceiverLink(body).enqueue(new Callback<SettlementResponse>() {
            @Override
            public void onResponse(Call<SettlementResponse> call, Response<SettlementResponse> response) {
                SettlementResponse resp = readBody(response);
                if (resp != null && resp.isSuccess()) {
                    if (callback != null) {
                        callback.onSuccess(resp.wasSent(), resp.getLink());
                    }
                } else if (callback != null) {
                    String code = resp != null ? resp.getCode() : "ERROR";
                    String msg = resp != null ? resp.getResponseMsg() : null;
                    callback.onError(code, getFriendlyErrorMessage(code, msg));
                }
            }

            @Override
            public void onFailure(Call<SettlementResponse> call, Throwable t) {
                Log.e(TAG, "resendLink network failure", t);
                if (callback != null) {
                    callback.onError("NETWORK_ERROR", "Network connection failed. Please check internet and retry.");
                }
            }
        });
    }

    private static SettlementResponse readBody(Response<SettlementResponse> response) {
        SettlementResponse resp = response.body();
        if (resp == null && response.errorBody() != null) {
            try {
                resp = new Gson().fromJson(response.errorBody().string(), SettlementResponse.class);
            } catch (Exception ignored) {}
        }
        return resp;
    }

    private static void handleSettlementResponse(Response<SettlementResponse> response, SettlementCallback callback) {
        SettlementResponse resp = response.body();
        if (resp == null && response.errorBody() != null) {
            try {
                resp = new Gson().fromJson(response.errorBody().string(), SettlementResponse.class);
            } catch (Exception ignored) {}
        }

        if (resp != null && resp.isSuccess()) {
            if (callback != null) {
                callback.onSuccess(resp.getSettlement());
            }
        } else {
            String code = resp != null ? resp.getCode() : "ERROR";
            String msg = resp != null ? resp.getResponseMsg() : null;
            if (callback != null) {
                callback.onError(code, getFriendlyErrorMessage(code, msg));
            }
        }
    }
}
