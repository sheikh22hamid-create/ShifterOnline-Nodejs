import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';
import '../utils/booking_guarantee.dart';

/// Display-only quote for the Booking Guarantee line on the booking screen.
/// Any failure returns 0 so a network problem simply hides the line — it never blocks a booking.
class BookingGuaranteeApiService {
  BookingGuaranteeApiService._();

  /// [uid] and the pickup coordinates let the server judge the guarantee by the pickup's city (its switch)
  /// and the customer's lock; without them the server fails closed and quotes 0.
  static Future<double> quote(List<int> packageIds, {Object? uid, double? pickupLat, double? pickupLng}) async {
    if (packageIds.isEmpty) return 0;
    try {
      final body = <String, dynamic>{'package_ids': packageIds};
      if (uid != null) body['uid'] = int.tryParse(uid.toString()) ?? uid;
      if (pickupLat != null && pickupLng != null) {
        body['pickup_lat'] = pickupLat;
        body['pickup_lng'] = pickupLng;
      }
      final response = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/${Config.nodeGuaranteeQuote}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
      final json = jsonDecode(response.body);
      if (json is Map && (json['Result'] == true || json['Result'] == 'true')) {
        return parseGuaranteeAmount(json['amount']);
      }
    } catch (e) {
      debugPrint('BookingGuarantee quote failed: $e');
    }
    return 0;
  }
}
