import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img_lib;

import '../Api/config.dart';
import '../screens/home/home.dart' show pickupiteam;

/// Map marker showing the vehicle image of [categoryName] (the same catalog
/// image the booking flow uses, from the home screen's `pickupiteam`), so a
/// bike order shows a bike on the map and a 4-wheeler order a 4-wheeler.
///
/// Returns null when the category has no catalog image or the download or
/// decode fails - callers fall back to a plain pin (never red: red means
/// "drop location" on these maps).
Future<BitmapDescriptor?> loadVehicleMarker(String categoryName, {int width = 110}) async {
  if (categoryName.isEmpty) return null;

  String imagePath = '';
  for (final item in pickupiteam) {
    if (item is Map && (item['cat_name']?.toString() ?? '').toLowerCase() == categoryName.toLowerCase()) {
      imagePath = item['cat_img']?.toString() ?? '';
      break;
    }
  }
  if (imagePath.isEmpty) return null;

  try {
    final response = await http.get(Uri.parse('${Config.imageURLPath}$imagePath')).timeout(const Duration(seconds: 8));
    if (response.statusCode != 200) return null;
    final decoded = img_lib.decodeImage(response.bodyBytes);
    if (decoded == null) return null;
    final resized = img_lib.copyResize(decoded, width: width);
    return BitmapDescriptor.fromBytes(Uint8List.fromList(img_lib.encodePng(resized)));
  } catch (e) {
    debugPrint('[vehicle_marker] icon load failed for $categoryName: $e');
    return null;
  }
}
