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
