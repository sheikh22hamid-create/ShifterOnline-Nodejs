import 'package:flutter/material.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

class AppSegment<T> {
  const AppSegment({required this.value, required this.label, required this.icon, this.iconColor});

  final T value;
  final String label;
  final IconData icon;
  final Color? iconColor;
}

/// Equal-width pill choices (e.g. Now / Schedule / Low Fare).
class AppSegmented<T> extends StatelessWidget {
  const AppSegmented({super.key, required this.segments, required this.value, required this.onChanged});

  final List<AppSegment<T>> segments;
  final T? value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    return Row(
      children: [
        for (var i = 0; i < segments.length; i++) ...[
          if (i > 0) const SizedBox(width: AppSpace.s),
          Expanded(
            child: Builder(builder: (context) {
              final s = segments[i];
              final selected = s.value == value;
              return PressableScale(
                onTap: () => onChanged(s.value),
                child: AnimatedContainer(
                  duration: reduceMotion ? Duration.zero : const Duration(milliseconds: 180),
                  constraints: const BoxConstraints(minHeight: 44),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                  decoration: BoxDecoration(
                    color: selected ? p.brandTint : p.surface,
                    borderRadius: BorderRadius.circular(AppRadius.input),
                    border: Border.all(color: selected ? p.brand : p.line, width: selected ? 1.5 : 1),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(s.icon, size: 15, color: s.iconColor ?? (selected ? p.brand : p.ink)),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(
                          s.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption(p.ink).copyWith(
                            fontSize: 13,
                            fontFamily: selected ? 'Gilroy_Bold' : 'Gilroy_Medium',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ],
      ],
    );
  }
}
