/// Small display rules for the order tracking screen, kept out of the widget so they can be tested.

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
