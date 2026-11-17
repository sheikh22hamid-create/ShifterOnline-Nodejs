import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_buttons.dart';
import '../../../theme/widgets/app_segmented.dart';
import '../../../theme/widgets/pressable_scale.dart';
import 'stop_swap_list.dart';

/// Floating route card on Home: pickup, stops, drop, booking mode and the "Choose vehicle" action.
/// Presentational only — every tap goes to a callback owned by home.dart.
class HomeRouteCard extends StatelessWidget {
  const HomeRouteCard({
    super.key,
    required this.pickupAddress,
    required this.dropAddress,
    required this.stops,
    this.onStopSwap,
    required this.canAddStop,
    required this.bookingType,
    required this.scheduleEnabled,
    required this.onPickupTap,
    required this.onDropTap,
    required this.onStopTap,
    required this.onStopDelete,
    required this.onAddStop,
    required this.onNow,
    required this.onSchedule,
    required this.onLowFare,
    required this.onChooseVehicle,
  });

  final String? pickupAddress;
  final String? dropAddress;
  /// The stop maps from home.dart (`address` key); the same objects so drag-to-swap can identify them.
  final List<Map<String, dynamic>> stops;
  /// When set, stops can be long-pressed and dragged onto each other to swap (existing StopSwapList).
  final void Function(Map<String, dynamic> source, Map<String, dynamic> target)? onStopSwap;
  final bool canAddStop;
  /// 1 = Now, 2 = Schedule, 3 = Low Fare (next day).
  final int bookingType;
  final bool scheduleEnabled;
  final VoidCallback onPickupTap;
  final VoidCallback onDropTap;
  final ValueChanged<int> onStopTap;
  final ValueChanged<int> onStopDelete;
  final VoidCallback onAddStop;
  final VoidCallback onNow;
  final VoidCallback onSchedule;
  final VoidCallback onLowFare;
  final VoidCallback onChooseVehicle;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.hero),
        boxShadow: [
          BoxShadow(color: p.navShadow, blurRadius: 32, offset: const Offset(0, 12)),
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 6, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _RouteRow(
            marker: _Dot(color: p.success, ring: p.successTint, square: false),
            label: 'Pickup'.tr,
            text: pickupAddress ?? 'Detecting current location...'.tr,
            textColor: p.ink,
            onTap: onPickupTap,
          ),
          const _Connector(),
          if (stops.isNotEmpty && onStopSwap != null)
            StopSwapList<Map<String, dynamic>>(
              items: stops,
              onSwap: onStopSwap!,
              separator: const _Connector(),
              itemBuilder: (context, stop, index, wrapDragBody) => _stopRow(p, stop, index, wrapDragBody),
            )
          else
            for (var i = 0; i < stops.length; i++) ...[
              if (i > 0) const _Connector(),
              _stopRow(p, stops[i], i, null),
            ],
          if (stops.isNotEmpty) const _Connector(),
          _RouteRow(
            marker: _Dot(color: p.brand, ring: p.brandTint, square: true),
            label: 'Drop'.tr,
            text: dropAddress ?? 'Where is it going?'.tr,
            textColor: dropAddress == null ? p.inkMuted : p.ink,
            onTap: onDropTap,
            trailing: canAddStop
                ? _IconAction(icon: Icons.add_rounded, semanticLabel: 'Add a stop'.tr, onTap: onAddStop, filled: true)
                : null,
          ),
          if (dropAddress != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: AppPrimaryButton(label: 'Choose vehicle'.tr, onPressed: onChooseVehicle),
            ),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: p.canvas,
              border: Border(top: BorderSide(color: p.divider)),
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.hero)),
            ),
            child: AppSegmented<int>(
              value: bookingType,
              onChanged: (v) {
                if (v == 1) onNow();
                if (v == 2) onSchedule();
                if (v == 3) onLowFare();
              },
              segments: [
                AppSegment(value: 1, label: 'Now'.tr, icon: Icons.bolt_rounded),
                if (scheduleEnabled) AppSegment(value: 2, label: 'Schedule'.tr, icon: Icons.calendar_month_outlined),
                AppSegment(value: 3, label: 'Low Fare'.tr, icon: Icons.south_rounded, iconColor: p.successText),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

extension on HomeRouteCard {
  Widget _stopRow(AppPalette p, Map<String, dynamic> stop, int i, Widget Function(Widget body)? wrapDragBody) =>
      _RouteRow(
        marker: _HollowDot(color: p.inkSubtle),
        label: 'Stop @n'.trParams({'n': '${i + 1}'}),
        text: stop['address']?.toString() ?? 'Selected location'.tr,
        textColor: p.ink,
        onTap: () => onStopTap(i),
        wrapDragBody: wrapDragBody,
        trailing: _IconAction(
          icon: Icons.close_rounded,
          semanticLabel: 'Remove stop @n'.trParams({'n': '${i + 1}'}),
          onTap: () => onStopDelete(i),
        ),
      );
}

class _RouteRow extends StatelessWidget {
  const _RouteRow({
    required this.marker,
    required this.label,
    required this.text,
    required this.textColor,
    required this.onTap,
    this.trailing,
    this.wrapDragBody,
  });

  final Widget marker;
  final String label;
  final String text;
  final Color textColor;
  final VoidCallback onTap;
  final Widget? trailing;
  final Widget Function(Widget body)? wrapDragBody;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final wrap = wrapDragBody ?? (Widget body) => body;
    return Row(
      children: [
        Expanded(
          child: wrap(PressableScale(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 64),
              child: Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(18, 10, 8, 10),
                child: Row(
                  children: [
                    SizedBox(width: 14, child: Center(child: marker)),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(label, style: AppText.caption(p.inkSubtle)),
                          const SizedBox(height: 2),
                          Text(text,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.bodyStrong(textColor)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )),
        ),
        if (trailing != null) Padding(padding: const EdgeInsetsDirectional.only(end: 10), child: trailing),
      ],
    );
  }
}

class _Connector extends StatelessWidget {
  const _Connector();

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 24, end: 18),
      child: Row(
        children: [
          ExcludeSemantics(
            child: Column(
              children: [
                for (var i = 0; i < 3; i++)
                  Container(
                    width: 2,
                    height: 3,
                    margin: const EdgeInsets.symmetric(vertical: 1),
                    color: p.line,
                  ),
              ],
            ),
          ),
          const SizedBox(width: 22),
          Expanded(child: Container(height: 1, color: p.divider)),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.ring, required this.square});

  final Color color;
  final Color ring;
  final bool square;

  @override
  Widget build(BuildContext context) => Container(
        width: 12,
        height: 12,
        decoration: BoxDecoration(
          color: color,
          shape: square ? BoxShape.rectangle : BoxShape.circle,
          borderRadius: square ? BorderRadius.circular(3) : null,
          boxShadow: [BoxShadow(color: ring, spreadRadius: 4)],
        ),
      );
}

class _HollowDot extends StatelessWidget {
  const _HollowDot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 11,
        height: 11,
        decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: color, width: 2.5)),
      );
}

class _IconAction extends StatelessWidget {
  const _IconAction({required this.icon, required this.semanticLabel, required this.onTap, this.filled = false});

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onTap;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      semanticLabel: semanticLabel,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: filled ? p.canvas : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadius.input),
        ),
        child: Icon(icon, size: 20, color: filled ? p.ink : p.inkSubtle),
      ),
    );
  }
}
