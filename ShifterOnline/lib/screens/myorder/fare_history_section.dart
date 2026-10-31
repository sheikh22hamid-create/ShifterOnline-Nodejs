import 'package:flutter/material.dart';
import 'package:get/get.dart';

/// One backend fare-history row (pkg_order_fare_history). Nothing here is computed on the phone:
/// amounts come from the server's own records and are only formatted for display.
class FareHistoryEntry {
  final String kind;
  final String reason;
  final double amountDiff;
  final double newTotal;

  const FareHistoryEntry({required this.kind, required this.reason, required this.amountDiff, required this.newTotal});

  bool get isOriginal => kind == 'original';

  static List<FareHistoryEntry> parseList(dynamic raw) {
    if (raw is! List) return const [];
    final out = <FareHistoryEntry>[];
    for (final e in raw) {
      if (e is! Map) continue;
      final total = double.tryParse('${e['new_total']}');
      if (total == null) continue;
      out.add(FareHistoryEntry(
        kind: '${e['kind'] ?? ''}',
        reason: '${e['reason'] ?? ''}',
        amountDiff: double.tryParse('${e['amount_diff']}') ?? 0,
        newTotal: total,
      ));
    }
    return out;
  }
}

String fareMoney(String currency, double v) =>
    '$currency${v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2)}';

/// "+₹30" for an increase, "-₹30" for a decrease, "+₹0" when unchanged.
String signedFareMoney(String currency, double diff) =>
    '${diff < 0 ? '-' : '+'}${fareMoney(currency, diff.abs())}';

/// Shown inside "View full breakdown": original booking fare, each change in the order it happened with the
/// running total, then the current final fare. Renders nothing for orders with no history.
class FareHistorySection extends StatelessWidget {
  final dynamic rawEntries;
  final String currency;
  /// The order's current fare as the server reports it (grand_total).
  final double currentFare;
  final Color textColor;
  final Color mutedColor;
  final Color increaseColor;
  final Color decreaseColor;

  const FareHistorySection({
    super.key,
    required this.rawEntries,
    required this.currency,
    required this.currentFare,
    required this.textColor,
    required this.mutedColor,
    this.increaseColor = const Color(0xFFFF6D00),
    this.decreaseColor = const Color(0xFF00C853),
  });

  static String _title(FareHistoryEntry e) {
    switch (e.kind) {
      case 'pickup_change':
        return 'Pickup Location Changed'.tr;
      case 'drop_change':
        return 'Drop Location Changed'.tr;
      case 'driver_assigned':
        return 'Driver Assigned'.tr;
      case 'stop_added':
        // reason is "Additional stop N" - keep the number the server recorded.
        final n = RegExp(r'(\d+)\s*$').firstMatch(e.reason)?.group(1);
        return n == null ? 'Additional Stop'.tr : '${'Additional Stop'.tr} $n';
      default:
        return e.reason;
    }
  }

  /// The address part of "... changed to <address>"; other kinds show the server's reason as is; stops need none.
  static String? _detail(FareHistoryEntry e) {
    if (e.kind == 'stop_added') return null;
    final i = e.reason.indexOf(' changed to ');
    return i >= 0 ? e.reason.substring(i + ' changed to '.length) : e.reason;
  }

  Widget _row(String label, String value, {Color? valueColor, bool bold = false, double size = 13, String? sub}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(color: bold ? textColor : mutedColor, fontFamily: bold ? 'Gilroy_Bold' : 'Gilroy_Medium', fontSize: size)),
                if (sub != null && sub.isNotEmpty)
                  Text(sub, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: mutedColor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(value, style: TextStyle(color: valueColor ?? textColor, fontFamily: bold ? 'Gilroy_Bold' : 'Gilroy_Medium', fontSize: size)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final entries = FareHistoryEntry.parseList(rawEntries);
    if (entries.isEmpty) return const SizedBox.shrink();

    final original = entries.firstWhere((e) => e.isOriginal, orElse: () => entries.first);
    final changes = entries.where((e) => !identical(e, original)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 6),
        Divider(color: Colors.grey.shade200),
        Text('Fare History'.tr, style: TextStyle(color: textColor, fontFamily: 'Gilroy_Bold', fontSize: 14)),
        const SizedBox(height: 4),
        _row('Original Booking Fare'.tr, fareMoney(currency, original.newTotal), bold: true),
        for (final e in changes) ...[
          _row(
            _title(e),
            signedFareMoney(currency, e.amountDiff),
            valueColor: e.amountDiff < 0 ? decreaseColor : (e.amountDiff > 0 ? increaseColor : textColor),
            sub: _detail(e),
          ),
          _row('Updated Fare'.tr, fareMoney(currency, e.newTotal), size: 12),
        ],
        Divider(color: Colors.grey.shade200),
        _row('Current Final Fare'.tr, fareMoney(currency, currentFare), bold: true, size: 14),
      ],
    );
  }
}
