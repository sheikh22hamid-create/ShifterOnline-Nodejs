import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// Free Booking Offer calls (backend: /api/order/free-booking/*).
/// Like the other customer endpoints these trust the posted `uid` (known app-wide gap).
class FreeBookingApiService {
  FreeBookingApiService._();

  static Future<Map<String, dynamic>> _post(String endpoint, Map<String, dynamic> body) async {
    try {
      final response = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/$endpoint'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
      final json = jsonDecode(response.body);
      if (json is Map<String, dynamic>) return json;
    } catch (e) {
      debugPrint('FreeBooking $endpoint failed: $e');
    }
    return {'Result': 'false'};
  }

  /// outcome: eligible | no_free_vehicle | locked | not_premium | offer_off | open_booking.
  /// Any failure returns 'offer_off', so a network problem never blocks a normal booking.
  static Future<Map<String, dynamic>> check({
    required int uid,
    required double plat,
    required double plong,
    required String category,
    required int radiusKm,
    required int bookingType,
  }) async {
    final json = await _post('api/order/free-booking/check', {
      'uid': uid, 'plat': plat, 'plong': plong, 'category': category,
      'radius_km': radiusKm, 'booking_type': bookingType,
    });
    final ok = json['Result'] == true || json['Result'] == 'true';
    return {
      'outcome': ok ? (json['outcome']?.toString() ?? 'offer_off') : 'offer_off',
      'message': json['message']?.toString() ?? '',
    };
  }

  /// state: available | unlocked | locked | not_premium | offer_off | open_booking.
  static Future<Map<String, dynamic>> status(int uid) async {
    final json = await _post('api/order/free-booking/status', {'uid': uid});
    final ok = json['Result'] == true || json['Result'] == 'true';
    return {
      'state': ok ? (json['state']?.toString() ?? 'offer_off') : 'offer_off',
      'message': json['message']?.toString() ?? '',
    };
  }
}
