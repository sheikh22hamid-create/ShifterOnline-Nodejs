import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

class AppNavTab {
  const AppNavTab({required this.label, required this.iconAsset, required this.selectedIconAsset});

  final String label;
  final String iconAsset;
  final String selectedIconAsset;
}

/// Flat white bottom bar (Porter-style): four tabs, active tab gets a brand top indicator.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.tabs,
    required this.selectedIndex,
    required this.onTabSelected,
  }) : assert(tabs.length == 4);

  final List<AppNavTab> tabs;
  final int selectedIndex;
  final ValueChanged<int> onTabSelected;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Container(
      height: 64 + bottomInset,
      padding: EdgeInsets.only(bottom: bottomInset),
      decoration: BoxDecoration(
        color: p.surface,
        boxShadow: [BoxShadow(color: p.navShadow, blurRadius: 10, offset: const Offset(0, -2))],
      ),
      child: Row(
        children: [
          for (var i = 0; i < tabs.length; i++)
            Expanded(
              child: _NavItem(
                index: i,
                tab: tabs[i],
                selected: i == selectedIndex,
                onTap: () => onTabSelected(i),
              ),
            ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.index, required this.tab, required this.selected, required this.onTap});

  final int index;
  final AppNavTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final iconColor = selected ? p.brand : p.inkSubtle;
    return PressableScale(
      onTap: onTap,
      semanticLabel: tab.label,
      child: Stack(
        alignment: Alignment.topCenter,
        children: [
          if (selected)
            Container(
              key: ValueKey('nav-indicator-$index'),
              width: 36,
              height: 3,
              decoration: BoxDecoration(
                color: p.brand,
                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(3)),
              ),
            ),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SvgPicture.asset(
                selected ? tab.selectedIconAsset : tab.iconAsset,
                height: 24,
                colorFilter: ColorFilter.mode(iconColor, BlendMode.srcIn),
              ),
              const SizedBox(height: 4),
              Text(
                tab.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.navLabel(selected ? p.brandText : p.inkSubtle, selected: selected),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
