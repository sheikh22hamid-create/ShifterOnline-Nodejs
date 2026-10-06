import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/Api_wrapper.dart';
import '../Api/config.dart';
import '../utils/receiver_pay_options.dart';

/// Single API client wrapper for all Customer Settlement calls.
///
/// SECURITY GATE NOTICE:
/// Currently, customer settlement endpoints trust the posted `uid` in the body.
/// When real driver/customer authentication ships before `settlement_enabled` is turned on,
/// auth headers (e.g. `Authorization: Bearer <token>`) MUST be added here in ONE place.
class SettlementApiService {
  SettlementApiService._();

  static const String _endpointState = "api/order/settlement/state";
  static const String _endpointChooseDriver = "api/order/settlement/choose-driver";
  static const String _endpointPayOnlineCreate = "api/order/settlement/pay-online/create";
  static const String _endpointPayOnlineVerify = "api/order/settlement/pay-online/verify";
  static const String _endpointDispute = "api/order/settlement/dispute";
  static const String _endpointTakeOver = "api/order/settlement/take-over";
  static const String _endpointResendLink = "api/order/settlement/resend-link";
  static const String _endpointReceiverPhone = "api/order/settlement/receiver-phone";
  static const String _endpointReceiverPayConfig = "api/order/receiver-pay/config";

  static Map<String, String> _buildHeaders() {
    return {
      'Content-Type': 'application/json',
      // SECURITY GATE: Place customer auth token header here when ready.
    };
  }

  static String friendlyErrorMessage(String? code, String? fallbackMsg) {
    switch (code) {
      case 'WINDOW_CLOSED':
        return 'The report window for this trip has closed (48 hours).';
      case 'INVALID_STATE':
        return 'Payment status has changed or is already settled.';
      case 'GATEWAY_ERROR':
        return 'Payment gateway temporarily unreachable. Please retry.';
      case 'PAID_BUT_STATE_CHANGED':
        return 'Payment was received, but the trip state was updated. Our support team will reconcile your account shortly. Please do NOT retry payment.';
      case 'PAYMENT_MISMATCH':
        return 'Payment amount mismatch. Please contact support.';
      case 'PAYMENT_VERIFICATION_FAILED':
        return 'Payment verification failed. Please try again.';
      case 'REASON_REQUIRED':
        return 'Please enter a dispute reason (at least 3 characters).';
      case 'NOT_FOUND':
        return 'No payment record found for this order.';
      case 'FORBIDDEN':
        return 'Access denied for this order.';
      case 'VALIDATION':
        return 'Invalid request details provided.';
      case 'RECEIVER_MODE':
        return 'The receiver is paying for this order. Tap "I\'ll pay myself" to pay instead.';
      case 'RECEIVER_PAY_UNAVAILABLE':
        return 'Receiver pays is not available for this order.';
      case 'NOT_ACTIVE':
      case 'NOT_PAYABLE':
        return 'The receiver payment is already settled or no longer active.';
      case 'NOT_CONFIGURED':
        return 'Payment link is not available right now.';
      case 'TOO_SOON':
        return 'Please wait a minute before sending the link again.';
      case 'LINK_LIMIT':
        return 'The link was already sent too many times. Please contact support.';
      default:
        return (fallbackMsg != null && fallbackMsg.isNotEmpty)
            ? fallbackMsg
            : 'An unexpected error occurred. Please try again.';
    }
  }

  static Future<Map<String, dynamic>> _post(String endpoint, Map<String, dynamic> body) async {
    try {
      final url = Uri.parse("${Config.nodeBaseUrl}/$endpoint");
      debugPrint("🌐 [SETTLEMENT POST] $url: $body");

      final response = await http.post(
        url,
        headers: _buildHeaders(),
        body: jsonEncode(body),
      );

      debugPrint("📊 [SETTLEMENT POST] Status: ${response.statusCode}");
      dynamic json;
      try {
        json = jsonDecode(response.body);
      } catch (e) {
        return {
          "Result": "false",
          "ResponseCode": "${response.statusCode}",
          "ResponseMsg": "Invalid response from server",
          "code": "SERVER_ERROR",
        };
      }

      if (json is Map<String, dynamic>) {
        return json;
      }
      return {
        "Result": "false",
        "ResponseCode": "${response.statusCode}",
        "ResponseMsg": "Unexpected response shape",
      };
    } catch (e) {
      debugPrint("💥 [SETTLEMENT POST] Network exception: $e");
      return {
        "Result": "false",
        "ResponseCode": "500",
        "ResponseMsg": "Network error: $e",
        "code": "NETWORK_ERROR",
      };
    }
  }

  /// Fetch settlement view state for this order.
  static Future<Map<String, dynamic>> getState({
    required int uid,
    required int orderId,
  }) async {
    return _post(_endpointState, {
      'uid': uid,
      'order_id': orderId,
    });
  }

  /// Informational selection: customer chooses to pay driver directly with cash/UPI.
  static Future<Map<String, dynamic>> chooseDriver({
    required int uid,
    required int orderId,
  }) async {
    return _post(_endpointChooseDriver, {
      'uid': uid,
      'order_id': orderId,
    });
  }

  /// Create Razorpay order server-side for amount_due.
  static Future<Map<String, dynamic>> createPayOnline({
    required int uid,
    required int orderId,
  }) async {
    return _post(_endpointPayOnlineCreate, {
      'uid': uid,
      'order_id': orderId,
    });
  }

  /// Verify Razorpay payment signature & settle online.
  static Future<Map<String, dynamic>> verifyPayOnline({
    required int uid,
    required int orderId,
    required String paymentId,
    required String razorpayOrderId,
    required String signature,
  }) async {
    return _post(_endpointPayOnlineVerify, {
      'uid': uid,
      'order_id': orderId,
      'razorpay_payment_id': paymentId,
      'razorpay_order_id': razorpayOrderId,
      'razorpay_signature': signature,
    });
  }

  /// Raise dispute / problem report with reason.
  static Future<Map<String, dynamic>> dispute({
    required int uid,
    required int orderId,
    required String reason,
  }) async {
    return _post(_endpointDispute, {
      'uid': uid,
      'order_id': orderId,
      'reason': reason,
    });
  }

  /// Customer cancels receiver-pays and pays the order themselves.
  static Future<Map<String, dynamic>> takeOver({
    required int uid,
    required int orderId,
  }) =>
      _post(_endpointTakeOver, {'uid': uid, 'order_id': orderId});

  /// Re-send the receiver's WhatsApp payment link.
  static Future<Map<String, dynamic>> resendLink({
    required int uid,
    required int orderId,
  }) =>
      _post(_endpointResendLink, {'uid': uid, 'order_id': orderId});

  /// Booker corrects the receiver's number; the backend re-sends the pay link when one is pending.
  static Future<Map<String, dynamic>> changeReceiverPhone({
    required int uid,
    required int orderId,
    required String mobile,
  }) =>
      _post(_endpointReceiverPhone, {'uid': uid, 'order_id': orderId, 'mobile': mobile});

  /// Never throws: any failure yields ReceiverPayConfig.disabled so booking works exactly as before.
  static Future<ReceiverPayConfig> getReceiverPayConfig() async {
    try {
      final res = await ApiWrapper.dataGetNode(_endpointReceiverPayConfig);
      return ReceiverPayConfig.fromResponse(res is Map<String, dynamic> ? res : null);
    } catch (_) {
      return ReceiverPayConfig.disabled;
    }
  }
}
