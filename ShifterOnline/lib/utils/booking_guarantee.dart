// Booking Guarantee display helpers (backend spec 2026-10-07). Strings go through `.tr` at the call site.

double parseGuaranteeAmount(dynamic raw) {
  final v = raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
  return v == null || v.isNaN || v < 0 ? 0.0 : v;
}

String _rupees(double amount) =>
    amount == amount.roundToDouble() ? '₹${amount.toInt()}' : '₹${amount.toStringAsFixed(2)}';

/// "If no driver is found, you get ₹X" — null (hide the line) when nothing is owed.
String? guaranteeLine(double amount) =>
    amount > 0 ? 'If no driver is found, you get ${_rupees(amount)}' : null;

String noDriverMessage(double compensation) => compensation > 0
    ? 'No driver found. ${_rupees(compensation)} has been added to your wallet.'
    : 'No driver found. Please try again.';
