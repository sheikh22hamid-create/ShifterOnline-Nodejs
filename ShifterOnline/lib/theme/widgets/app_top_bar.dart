import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import '../../utils/colors.dart' show notifier;
import '../app_tokens.dart';
import 'pressable_scale.dart';

/// Light top bar: round back button, title and optional subtitle.
class AppTopBar extends StatelessWidget implements PreferredSizeWidget {
  const AppTopBar({super.key, required this.title, this.subtitle, this.onBack, this.actions = const []});

  final String title;
  final String? subtitle;
  /// Null → `Get.back()`.
  final VoidCallback? onBack;
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final isDark = notifier.getIsDark == true;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: (isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark)
          .copyWith(statusBarColor: Colors.transparent),
      child: Material(
        color: p.surface,
        child: SafeArea(
          bottom: false,
          child: SizedBox(
            height: 64,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  PressableScale(
                    onTap: onBack ?? () => Get.back(),
                    semanticLabel: 'Back'.tr,
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(color: p.canvas, shape: BoxShape.circle),
                      child: Icon(Icons.arrow_back_rounded, color: p.ink, size: 22),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.section(p.ink)),
                        if (subtitle != null)
                          Text(subtitle!,
                              maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption(p.inkSubtle)),
                      ],
                    ),
                  ),
                  ...actions,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
