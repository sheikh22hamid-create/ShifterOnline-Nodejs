import 'package:flutter/material.dart';

import '../app_tokens.dart';

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.actionLabel, this.onAction});

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          Expanded(child: Text(title, style: AppText.section(p.ink), maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (actionLabel != null)
            InkWell(
              onTap: onAction,
              borderRadius: BorderRadius.circular(AppRadius.chip),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 44),
                child: Align(
                  widthFactor: 1,
                  child: Text(actionLabel!, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 13)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
