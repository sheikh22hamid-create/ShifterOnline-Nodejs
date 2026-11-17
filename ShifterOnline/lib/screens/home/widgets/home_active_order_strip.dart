import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/pressable_scale.dart';

/// Shown on Home while an order is running; Track opens the existing tracking screen.
class HomeActiveOrderStrip extends StatelessWidget {
  const HomeActiveOrderStrip({
    super.key,
    required this.orderId,
    required this.status,
    this.message,
    required this.onTrack,
  });

  final String orderId;
  final String status;
  final String? message;
  final VoidCallback onTrack;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final hasMessage = message != null && message!.trim().isNotEmpty;
    return PressableScale(
      onTap: onTrack,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
          border: Border.all(color: p.line),
        ),
        child: Row(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: p.successTint, borderRadius: BorderRadius.circular(12)),
                  child: Icon(Icons.local_shipping_rounded, color: p.brand, size: 24),
                ),
                const Positioned(top: -3, right: -3, child: _LiveDot()),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Order #@id'.trParams({'id': orderId}),
                      style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(status, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.caption(p.successText)),
                  if (hasMessage) ...[
                    const SizedBox(height: 2),
                    Text(message!,
                        key: const ValueKey('active-order-message'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.caption(p.inkSubtle)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              height: 36,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: p.brand, borderRadius: BorderRadius.circular(18)),
              child: Text('Track'.tr, style: AppText.bodyStrong(p.onBrand).copyWith(fontSize: 12)),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveDot extends StatefulWidget {
  const _LiveDot();

  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1600));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (reduceMotion) {
      _controller.stop();
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return ExcludeSemantics(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            color: p.success,
            shape: BoxShape.circle,
            border: Border.all(color: p.surface, width: 2),
            boxShadow: [
              BoxShadow(
                color: p.success.withValues(alpha: 0.5 * (1 - _controller.value)),
                spreadRadius: 8 * _controller.value,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
