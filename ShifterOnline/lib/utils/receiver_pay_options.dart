// Pure helpers for the "Receiver pays" booking option (no Flutter imports).

bool _truthy(dynamic v) => v == true || v == 'true' || v == 1 || v == '1';

double _num(dynamic v) {
  if (v is num) return v.toDouble();
  return double.tryParse('${v ?? ''}') ?? 0;
}

class ReceiverPayConfig {
  final bool enabled;
  final double maxPercent;
  final double maxAmount;

  const ReceiverPayConfig({
    required this.enabled,
    required this.maxPercent,
    required this.maxAmount,
  });

  static const ReceiverPayConfig disabled =
      ReceiverPayConfig(enabled: false, maxPercent: 0, maxAmount: 0);

  /// Reads res['config']; null or malformed input yields [disabled].
  factory ReceiverPayConfig.fromResponse(Map<String, dynamic>? res) {
    final cfg = res?['config'];
    if (cfg is! Map) return disabled;
    return ReceiverPayConfig(
      enabled: _truthy(cfg['enabled']),
      maxPercent: _num(cfg['max_percent']),
      maxAmount: _num(cfg['max_amount']),
    );
  }
}

class ReceiverPaySelection {
  final bool enabled;
  final double percent;

  const ReceiverPaySelection({required this.enabled, required this.percent});

  static const ReceiverPaySelection off =
      ReceiverPaySelection(enabled: false, percent: 0);
}

/// Last 10 digits of [raw], or '' when fewer than 10 digits are present.
String normalizeIndianMobile(String? raw) {
  final digits = (raw ?? '').replaceAll(RegExp(r'\D'), '');
  if (digits.length < 10) return '';
  return digits.substring(digits.length - 10);
}

/// Commission choices: 0, then 1,2,3,5,10 up to [maxPercent], then [maxPercent] itself.
List<double> percentChoices(double maxPercent) {
  final out = <double>[0];
  if (maxPercent <= 0) return out;
  for (final p in const [1, 2, 3, 5, 10]) {
    if (p <= maxPercent) out.add(p.toDouble());
  }
  if (!out.contains(maxPercent)) out.add(maxPercent);
  return out;
}

/// Null when receiver-pays is available; otherwise a short English reason.
/// [payValue]: cash is 1, wallet is -2.
String? receiverPayUnavailableReason({
  required ReceiverPayConfig config,
  required int payValue,
  required String? dropMobile,
}) {
  if (!config.enabled) return 'Receiver pays is not available right now';
  if (payValue != 1) return 'Only for cash orders';
  if (normalizeIndianMobile(dropMobile).isEmpty) {
    return 'Add a valid 10-digit drop contact number';
  }
  return null;
}
