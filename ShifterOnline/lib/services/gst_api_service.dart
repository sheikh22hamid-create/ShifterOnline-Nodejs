import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// Customer GST details (spec 2026-11-15). Backend: POST /api/order/gst/{verify,profile,remove}. Like the other customer
/// endpoints they trust the posted `uid`; the server only ever returns or changes that uid's own details.
class GstVerifyResult {
  /// The GSTIN is real and active; [details] holds the verified business details (legal_name, trade_name, address, state, ...).
  final bool valid;
  final Map<String, dynamic>? details;
  final String message;

  /// True when verification could not be done right now (provider or network trouble): not a verdict on the number.
  final bool unavailable;

  const GstVerifyResult({required this.valid, this.details, this.message = '', this.unavailable = false});
}

class GstApiService {
  GstApiService._();

  static Future<Map<String, dynamic>?> _post(String path, Map<String, dynamic> body) async {
    final response = await http
        .post(
          Uri.parse('${Config.nodeBaseUrl}/api/order/gst/$path'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 20));
    final json = jsonDecode(response.body);
    if (json is Map) return {...Map<String, dynamic>.from(json), '_status': response.statusCode};
    return null;
  }

  /// The customer's saved, verified GST details (to autofill), or null when none or on any error.
  static Future<Map<String, dynamic>?> profile(Object uid) async {
    try {
      final json = await _post('profile', {'uid': uid});
      final details = json?['details'];
      return details is Map ? Map<String, dynamic>.from(details) : null;
    } catch (e) {
      debugPrint('GST profile failed: $e');
      return null;
    }
  }

  /// Verifies [gstin] on the server. A valid one is also saved to the customer's profile there.
  static Future<GstVerifyResult> verify(Object uid, String gstin) async {
    try {
      final json = await _post('verify', {'uid': uid, 'gstin': gstin});
      if (json == null) return const GstVerifyResult(valid: false, unavailable: true, message: 'We could not verify the GSTIN right now. You can still book without GST details.');
      final message = (json['ResponseMsg'] ?? '').toString();
      if (json['valid'] == true && json['details'] is Map) {
        return GstVerifyResult(valid: true, details: Map<String, dynamic>.from(json['details'] as Map), message: message);
      }
      final unavailable = json['_status'] == 503 || json['code'] == 'UNAVAILABLE' || json['_status'] == 429;
      return GstVerifyResult(valid: false, unavailable: unavailable, message: message);
    } catch (e) {
      debugPrint('GST verify failed: $e');
      return const GstVerifyResult(valid: false, unavailable: true, message: 'We could not verify the GSTIN right now. You can still book without GST details.');
    }
  }

  static Future<bool> remove(Object uid) async {
    try {
      final json = await _post('remove', {'uid': uid});
      return json?['Result'] == 'true' || json?['Result'] == true;
    } catch (e) {
      debugPrint('GST remove failed: $e');
      return false;
    }
  }
}
