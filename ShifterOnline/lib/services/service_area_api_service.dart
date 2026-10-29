import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../Api/config.dart';

/// Service-area check (backend: POST /api/order/validate-location). Asks the server whether a pickup or drop point is
/// inside a city's pickup service area and, when a vehicle category is given, outside that vehicle's No Entry Zones.
/// The server owns the rules and the exact message. This is only an early warning for the customer: order creation
/// checks again, so a network failure here must never block a booking (it returns null = no objection).
class ServiceAreaApiService {
  ServiceAreaApiService._();

  /// The server's message when the location is not allowed, else null (allowed, check off, or could not be read).
  static Future<String?> blockedMessage({
    required double lat,
    required double lng,
    required String type, // 'pickup' | 'drop'
    Object? categoryId,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('${Config.nodeBaseUrl}/api/order/validate-location'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'lat': lat, 'lng': lng, 'type': type, if (categoryId != null) 'cat_id': categoryId}),
          )
          .timeout(const Duration(seconds: 12));
      final json = jsonDecode(response.body);
      if (json is Map && (json['Result'] == true || json['Result'] == 'true') && json['allowed'] == false) {
        final message = json['message']?.toString().trim() ?? '';
        return message.isEmpty ? 'This location is not available for booking.' : message;
      }
    } catch (e) {
      debugPrint('ServiceArea validate failed: $e');
    }
    return null;
  }

  /// Pickup first, then drop. Returns the first message, or null when both are fine.
  static Future<String?> routeBlockedMessage({
    required double pickupLat,
    required double pickupLng,
    required double dropLat,
    required double dropLng,
    Object? categoryId,
  }) async {
    final pickup = await blockedMessage(lat: pickupLat, lng: pickupLng, type: 'pickup', categoryId: categoryId);
    if (pickup != null) return pickup;
    return blockedMessage(lat: dropLat, lng: dropLng, type: 'drop', categoryId: categoryId);
  }
}
