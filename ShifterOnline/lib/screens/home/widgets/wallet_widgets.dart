import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_buttons.dart';
import '../../../theme/widgets/pressable_scale.dart';
import '../../../theme/widgets/v2_art.dart';

/// Wallet tab (Porter "Payments" style) building blocks. Presentational only — wallet_page.dart keeps
/// the balance, history, filters and the Add Money / Razorpay flow.

/// Balance card with the full-width Add Money button.
class WalletBalanceCard extends StatelessWidget {
  const WalletBalanceCard({super.key, required this.balance, required this.onAddMoney});

  final double balance;
  final VoidCallback onAddMoney;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Shifter Wallet'.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                    const SizedBox(height: 4),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text('₹${balance.toStringAsFixed(2)}',
                          style: AppText.title(p.ink).copyWith(fontSize: 32, letterSpacing: -0.5)),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              const V2Art(asset: 'assets/v2/wallet_icon.png', placeholderLabel: 'W1', width: 56, height: 56),
            ],
          ),
          const SizedBox(height: 14),
          AppPrimaryButton(label: 'Add Money'.tr, onPressed: onAddMoney),
        ],
      ),
    );
  }
}

/// Reward Points row-card → the existing Reward Points screen.
class RewardPointsCard extends StatelessWidget {
  const RewardPointsCard({super.key, required this.points, required this.onTap});

  final String points;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          boxShadow: AppShadow.card,
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: p.warningTint, borderRadius: BorderRadius.circular(12)),
              child: Icon(Icons.toll_outlined, color: p.warning, size: 22),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Reward Points'.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 15)),
                  const SizedBox(height: 2),
                  Text('@n points'.trParams({'n': points}), style: AppText.caption(p.inkMuted).copyWith(fontSize: 13)),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 22),
          ],
        ),
      ),
    );
  }
}

/// All / Credit / Debit shortcut into the existing transaction-type filter ('' / 'credit' / 'debit').
class TxnTypeChips extends StatelessWidget {
  const TxnTypeChips({super.key, required this.selected, required this.onSelected});

  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    const options = [('', 'All'), ('credit', 'Credit'), ('debit', 'Debit')];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final (value, label) in options)
          PressableScale(
            onTap: () => onSelected(value),
            semanticLabel: label.tr,
            child: Container(
              height: 36,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected == value ? p.brandTint : p.surface,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: selected == value ? p.brand : p.line, width: selected == value ? 1.5 : 1),
              ),
              child: Text(label.tr,
                  style: AppText.bodyStrong(selected == value ? p.brandText : p.ink).copyWith(fontSize: 13)),
            ),
          ),
      ],
    );
  }
}
