import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// Low Fare Booking (customer side): the next-day price quote. Backend: POST /api/order/low-fare-quote.
/// Like the other customer endpoints it trusts the posted `uid` (known app-wide gap).
class LowFareApiService {
  LowFareApiService._();

  /// Returns null when the quote could not be read (network or server error), so the caller can refuse to
  /// show a price it is not sure of. `{'enabled': false}` means the feature is off and next-day booking is unchanged.
  static Future<Map<String, dynamic>?> quote({
    required Object categoryId,
    required double plat,
    required double plong,
    required double dlat,
    required double dlong,
    required List<Map<String, dynamic>> stops,
    required String bodyType,
    Object? uid,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('${Config.nodeBaseUrl}/api/order/low-fare-quote'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'cat_id': categoryId,
              'plat': plat, 'plong': plong, 'dlat': dlat, 'dlong': dlong,
              'stops': stops,
              'body_type': bodyType,
              if (uid != null) 'uid': uid,
            }),
          )
          .timeout(const Duration(seconds: 15));
      final json = jsonDecode(response.body);
      if (json is Map && (json['Result'] == true || json['Result'] == 'true')) return Map<String, dynamic>.from(json);
    } catch (e) {
      debugPrint('LowFare quote failed: $e');
    }
    return null;
  }
}

/// The customer's chosen pickup window, kept as plain values and sent to the server as date + HH:MM (IST wall clock,
/// the same clock the customer reads). The server is the judge of what is valid.
class LowFareWindow {
  const LowFareWindow({this.date, this.from, this.until});
  final DateTime? date;
  final TimeOfDay? from;
  final TimeOfDay? until;

  bool get isComplete => date != null && from != null && until != null;

  static String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  String get dateText =>
      date == null ? '' : '${date!.year.toString().padLeft(4, '0')}-${date!.month.toString().padLeft(2, '0')}-${date!.day.toString().padLeft(2, '0')}';
  String get fromText => from == null ? '' : _hhmm(from!);
  String get untilText => until == null ? '' : _hhmm(until!);

  /// A plain message when the window cannot be right, null when it looks fine (the server still checks).
  String? problem({required int maxWindowHours}) {
    if (!isComplete) return 'Choose a date and a pickup time window first.';
    final start = from!.hour * 60 + from!.minute;
    final end = until!.hour * 60 + until!.minute;
    if (end <= start) return 'End time must be after the start time';
    if (end - start > maxWindowHours * 60) return 'The time window cannot be longer than $maxWindowHours hours';
    return null;
  }

  Map<String, dynamic> toBody() => {'low_fare_date': dateText, 'low_fare_from': fromText, 'low_fare_until': untilText};
}
