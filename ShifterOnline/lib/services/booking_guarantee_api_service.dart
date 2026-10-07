import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';
import '../utils/booking_guarantee.dart';

/// Display-only quote for the Booking Guarantee line on the booking screen.
/// Any failure returns 0 so a network problem simply hides the line — it never blocks a booking.
class BookingGuaranteeApiService {
  BookingGuaranteeApiService._();

  static Future<double> quote(List<int> packageIds) async {
    if (packageIds.isEmpty) return 0;
    try {
      final response = await http.post(
        Uri.parse('${Config.nodeBaseUrl}/${Config.nodeGuaranteeQuote}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'package_ids': packageIds}),
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
