import 'package:flutter/foundation.dart';
import 'package:get_storage/get_storage.dart';

import '../Api/Api_wrapper.dart';
import '../Api/config.dart';

/// Ledger balance from a wallet-history response, or null when the call did not succeed.
double? parseWalletBalance(dynamic response) {
  if (response is! Map) return null;
  final ok = response['Result'] == true || response['Result'] == 'true';
  if (!ok) return null;
  return double.tryParse(response['wallet_balance']?.toString() ?? '');
}

/// Reads the customer's wallet balance with the same wallet-history request the Wallet tab makes
/// (`wallet_page.dart`), so Home can show it. Any failure returns null and the caller hides the chip.
class WalletBalanceService {
  WalletBalanceService._();

  static Future<double?> fetch() async {
    try {
      final user = GetStorage().read('UserLogin');
      if (user is! Map || user['mobile'] == null) return null;
      final response = await ApiWrapper.dataPostNode(Config.nodeWalletHistory, {
        'mobile': user['mobile'],
        'wallet_type': 'user',
        'from_date': '',
        'to_date': '',
        'txn_type': '',
      });
      return parseWalletBalance(response);
    } catch (e) {
      debugPrint('Wallet balance for Home failed: $e');
      return null;
    }
  }
}
