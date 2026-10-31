// Booking Guarantee display helpers (backend spec 2026-10-07). Strings go through `.tr` at the call site.

double parseGuaranteeAmount(dynamic raw) {
  final v = raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
  return v == null || v.isNaN || v < 0 ? 0.0 : v;
}

String rupeesText(double amount) =>
    amount == amount.roundToDouble() ? '₹${amount.toInt()}' : '₹${amount.toStringAsFixed(2)}';

/// "If no driver is found, you get ₹X" — null (hide the line) when nothing is owed.
String? guaranteeLine(double amount) =>
    amount > 0 ? 'If no driver is found, you get ${rupeesText(amount)}' : null;

/// [lastModel]: whether the customer booked the last available model (true), an earlier one (false), or it is
/// unknown (null, e.g. an order restored without that info) - unknown keeps the original wording.
String noDriverMessage(double compensation, {bool? lastModel}) {
  if (compensation > 0) return 'No driver found. ${rupeesText(compensation)} has been added to your wallet.';
  if (lastModel == true) return 'No driver found. Please increase search radius.';
  if (lastModel == false) return 'No driver found. Please increase the models and increase search radius.';
  return 'No driver found. Please try again.';
}

/// System 2 (Vehicle Category First): the search window ended with nobody found and no guarantee compensation.
const String driverNotAvailableMessage = 'Driver is not available.';

/// Shown while a locked customer waits: the guarantee will not apply to this order.
const String guaranteeLockedLine = 'Booking Guarantee is locked. Complete your referrals to unlock it.';
