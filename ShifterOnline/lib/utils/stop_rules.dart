import 'dart:math' as math;

/// A stop may not lie beyond the final drop: it is "beyond" when it is farther from the pickup than the drop is.
/// A 100 m tolerance keeps a stop right next to the drop from being rejected by coordinate rounding.
/// Missing or unreadable coordinates never block a stop (same rule the old Home route card used).
bool isStopBeyondFinalDrop({
  required Map<String, dynamic>? pickup,
  required Map<String, dynamic>? drop,
  required Map<String, dynamic> stop,
}) {
  if (pickup == null || drop == null) return false;
  double? read(Map<String, dynamic> m, String key) => double.tryParse(m[key]?.toString() ?? '');

  final pLat = read(pickup, 'lat_map'), pLng = read(pickup, 'long_map');
  final dLat = read(drop, 'lat_map'), dLng = read(drop, 'long_map');
  final sLat = read(stop, 'lat_map'), sLng = read(stop, 'long_map');
  if ([pLat, pLng, dLat, dLng, sLat, sLng].any((v) => v == null)) return false;

  final pickupToDrop = distanceKm(pLat!, pLng!, dLat!, dLng!);
  final pickupToStop = distanceKm(pLat, pLng, sLat!, sLng!);
  return pickupToStop > pickupToDrop + 0.1;
}

/// Index of the first stop that lies beyond the final drop, or -1 when every stop is fine.
int firstStopBeyondDrop({
  required Map<String, dynamic>? pickup,
  required Map<String, dynamic>? drop,
  required List<Map<String, dynamic>> stops,
}) {
  for (var i = 0; i < stops.length; i++) {
    if (isStopBeyondFinalDrop(pickup: pickup, drop: drop, stop: stops[i])) return i;
  }
  return -1;
}

/// Great-circle distance in km (haversine).
double distanceKm(double lat1, double lng1, double lat2, double lng2) {
  const earthRadiusKm = 6371.0;
  final dLat = (lat2 - lat1) * math.pi / 180;
  final dLng = (lng2 - lng1) * math.pi / 180;
  final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(lat1 * math.pi / 180) * math.cos(lat2 * math.pi / 180) * math.sin(dLng / 2) * math.sin(dLng / 2);
  return earthRadiusKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}
