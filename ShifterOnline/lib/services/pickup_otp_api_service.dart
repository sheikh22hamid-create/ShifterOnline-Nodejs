import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// "Send OTP to Driver" (backend: POST /api/order/share-pickup-otp, spec 2026-10-29). The server decides everything:
/// whether the driver is waiting for the OTP, whether it was already verified, and whether the driver's app really
/// received it. Success is only reported once the driver's app confirmed it. The call never verifies the OTP.
/// Like the other customer endpoints it trusts the posted `uid` (known app-wide gap; the server checks it owns the order).
class PickupOtpApiService {
  PickupOtpApiService._();

  static const String failedMessage = 'Unable to send OTP to driver. Please try again.';

  /// Returns the server's customer-facing message and whether the OTP reached the driver.
  static Future<({bool ok, String message})> share({required Object uid, required Object orderId}) async {
    try {
      final response = await http
          .post(
            Uri.parse('${Config.nodeBaseUrl}/api/order/share-pickup-otp'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'uid': int.tryParse(uid.toString()) ?? uid, 'order_id': int.tryParse(orderId.toString()) ?? orderId}),
          )
          .timeout(const Duration(seconds: 20));
      final json = jsonDecode(response.body);
      if (json is Map) {
        final message = json['ResponseMsg']?.toString().trim() ?? '';
        return (ok: json['Result'] == 'true' || json['Result'] == true, message: message.isEmpty ? failedMessage : message);
      }
    } catch (e) {
      debugPrint('PickupOtp share failed: $e');
    }
    return (ok: false, message: failedMessage);
  }
}
