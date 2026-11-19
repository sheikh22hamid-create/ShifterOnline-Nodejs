import 'dart:math' as math;

/// Window used when the real search deadline is not known yet
/// (System 1, or the screen reopened before order details arrive).
const Duration kNominalSearchWindow = Duration(minutes: 5);

/// How far through the driver search we are, 0..1.
double searchFraction({
  DateTime? start,
  DateTime? deadline,
  required DateTime screenOpenedAt,
  required DateTime now,
}) {
  double f;
  if (start != null && deadline != null && deadline.isAfter(start)) {
    f = now.difference(start).inMilliseconds /
        deadline.difference(start).inMilliseconds;
  } else {
    f = now.difference(screenOpenedAt).inMilliseconds /
        kNominalSearchWindow.inMilliseconds;
  }
  return f.clamp(0.0, 1.0).toDouble();
}

/// 0 <20%, 1 <50%, 2 <80%, 3 = late.
int searchStage(double fraction) {
  if (fraction < 0.20) return 0;
  if (fraction < 0.50) return 1;
  if (fraction < 0.80) return 2;
  return 3;
}

/// Eased bar value: fast at first, then slow; never full before a driver accepts.
double searchBar(double fraction) {
  final f = fraction.clamp(0.0, 1.0).toDouble();
  return math.min(0.96, 0.04 + 0.92 * (1 - math.exp(-3 * f)));
}

/// One truthful message per stage (English keys for `.tr`).
const List<String> kSearchStageMessages = [
  'Sending your order to nearby drivers.',
  'Nearby drivers can see your order now.',
  'Drivers usually accept once they finish their current trip.',
  'Still looking. Your order stays active, no need to book again.',
];

/// Screen-side state for the progress display.
///
/// [searchDeadline] must be the REAL end of the driver search (System 2 window or guarantee wait),
/// never the client's safety timer. Until it is known, time on screen over [kNominalSearchWindow] is used.
/// The returned fraction never moves backwards, so a later deadline cannot shrink the bar or undo "late".
class SearchProgressTracker {
  SearchProgressTracker({required this.screenOpenedAt});

  final DateTime screenOpenedAt;
  DateTime? orderedAt;
  DateTime? searchDeadline;
  double _shown = 0;

  double fractionAt(DateTime now) {
    final f = searchFraction(
      start: searchDeadline == null ? null : orderedAt,
      deadline: searchDeadline,
      screenOpenedAt: screenOpenedAt,
      now: now,
    );
    if (f > _shown) _shown = f;
    return _shown;
  }
}
