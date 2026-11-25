/// Collapses duplicate comma-separated segments in an address string.
///
/// Google Places sometimes returns — or the app builds (house-no + base) —
/// addresses where the plus-code / place name is repeated, e.g.
/// "J2XQ+P3G, J2XQ+P3G, Rajasthan State Highway 9B, ...". That reads like a
/// bug to customers. This keeps the FIRST occurrence of each distinct segment
/// (case-insensitive), preserving order, drops empties, and rejoins with ", ".
///
/// Pure display/formatting helper — never changes lat/lng or stored keys other
/// than the human-readable address text.
String cleanAddress(String? raw) {
  if (raw == null) return '';
  final parts = raw.split(',');
  final out = <String>[];
  final seen = <String>{};
  for (final part in parts) {
    final trimmed = part.trim();
    if (trimmed.isEmpty) continue;
    final key = trimmed.toLowerCase();
    if (seen.contains(key)) continue;
    seen.add(key);
    out.add(trimmed);
  }
  return out.join(', ');
}
