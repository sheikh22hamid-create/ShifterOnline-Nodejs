import 'package:flutter/material.dart';

import '../../../theme/app_tokens.dart';

/// One delivery model (Super Saver / Priority ...) on the vehicle screen. The switch and the whole row
/// both call [onToggle] with the new value; the ON/OFF cascade rules stay in the screen.
class DeliveryModelTile extends StatelessWidget {
  final String title;
  final String? description;
  final String fare;
  final bool on;
  final bool selected;
  final bool nextDaySaver;
  final ValueChanged<bool> onToggle;

  const DeliveryModelTile({
    super.key,
    required this.title,
    this.description,
    required this.fare,
    required this.on,
    required this.selected,
    this.nextDaySaver = false,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final bg = selected ? p.brandTint : p.surface;
    final border = selected ? p.brand : (on ? p.brand.withValues(alpha: 0.45) : p.line);
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => onToggle(!on),
          borderRadius: BorderRadius.circular(14),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.fromLTRB(8, 10, 14, 10),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: border, width: selected ? 1.5 : 1),
            ),
            child: Row(
              children: [
                SizedBox(
                  height: 28,
                  child: Switch(
                    value: on,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    onChanged: onToggle,
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(title, style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 14.5)),
                          if (nextDaySaver)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(6)),
                              child: Text('Next Day Saver',
                                  style: TextStyle(color: p.brandText, fontFamily: 'Gilroy_Bold', fontSize: 10.5)),
                            ),
                        ],
                      ),
                      if ((description ?? '').isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(description!,
                            style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium', fontSize: 12, height: 1.3)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(fare, style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 15)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Tappable row for coupon / referral points. [onClear] shows a remove button while [active].
class BookingOptionRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool active;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  /// Replaces the chevron (e.g. a checkbox state icon for referral points).
  final IconData? leadingStateIcon;

  const BookingOptionRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    required this.active,
    required this.onTap,
    this.onClear,
    this.leadingStateIcon,
  });

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: active ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: active ? p.brand : p.line),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: active ? p.surface : p.canvas, shape: BoxShape.circle),
                child: Icon(leadingStateIcon ?? icon, color: active ? p.brandText : p.inkMuted, size: 18),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(color: p.ink, fontFamily: 'Gilroy_Bold', fontSize: 13.5)),
                    if ((subtitle ?? '').isNotEmpty)
                      Text(subtitle!, style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium', fontSize: 12)),
                  ],
                ),
              ),
              if (active && onClear != null)
                IconButton(
                  tooltip: 'Remove',
                  onPressed: onClear,
                  visualDensity: VisualDensity.compact,
                  icon: Icon(Icons.close_rounded, color: p.inkSubtle, size: 18),
                )
              else if (onClear != null || leadingStateIcon == null)
                Icon(Icons.chevron_right_rounded, color: p.inkSubtle, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

/// Date / time field (schedule pickup, Low Fare window). Tinted once a [value] is picked.
class BookingPickerField extends StatelessWidget {
  final IconData? icon;
  final String label;
  final String? value;
  final String placeholder;
  final VoidCallback onTap;

  const BookingPickerField({
    super.key,
    this.icon,
    required this.label,
    required this.value,
    required this.placeholder,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final filled = value != null;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          decoration: BoxDecoration(
            color: filled ? p.brandTint : p.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: filled ? p.brand : p.line, width: filled ? 1.5 : 1),
          ),
          child: Row(
            children: [
              if (icon != null) ...[
                Icon(icon, color: filled ? p.brandText : p.inkMuted, size: 20),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: TextStyle(color: p.inkSubtle, fontFamily: 'Gilroy_Medium', fontSize: 12)),
                    const SizedBox(height: 2),
                    Text(
                      value ?? placeholder,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: filled ? p.ink : p.inkMuted, fontFamily: 'Gilroy_Bold', fontSize: 14),
                    ),
                  ],
                ),
              ),
              if (icon != null) Icon(Icons.expand_more_rounded, color: p.inkSubtle, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

/// Pill used for goods type and similar single-choice lists.
class BookingChoicePill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const BookingChoicePill({super.key, required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: selected ? p.brandTint : p.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: selected ? p.brand : p.line),
            ),
            child: Text(
              label,
              style: TextStyle(
                color: selected ? p.brandText : p.inkMuted,
                fontFamily: selected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                fontSize: 13,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
