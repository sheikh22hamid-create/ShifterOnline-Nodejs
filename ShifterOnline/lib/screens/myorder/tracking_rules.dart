/// Small display rules for the order tracking screen, kept out of the widget so they can be tested.

import 'package:intl/intl.dart';

/// "Mon, 16 Nov, 2026 • 08:35 PM". The server sends UTC ("...Z"), so convert to the phone's time first.
/// Text that is not a date is shown as it came.
String formatOrderDate(String? raw) {
  if (raw == null || raw.isEmpty) return '';
  final dt = DateTime.tryParse(raw);
  if (dt == null) return raw;
  return DateFormat('EEE, d MMM, yyyy • hh:mm a').format(dt.toLocal());
}

bool _hasRider(String riderId) {
  final id = riderId.trim();
  return id.isNotEmpty && id != '0' && id != 'null';
}

/// The rating sheet pops up by itself once per screen; the customer's own tap ("Rate" / a star)
/// must always open it, even after they skipped the automatic one.
bool canOpenFeedback({required bool shownBefore, required bool manual}) => manual || !shownBefore;

/// The rider card shows the driver, or "Looking for Rider..." while searching. A cancelled order
/// that never got a driver has nothing to show there, so the card is hidden.
bool showRiderCard({required String status, required String riderId}) {
  final s = status.trim().toLowerCase();
  final cancelled = s == 'cancelled' || s == 'cancel';
  return !(cancelled && !_hasRider(riderId));
}
