import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';

import '../app_tokens.dart';
import 'pressable_scale.dart';

class AppNavTab {
  const AppNavTab({required this.label, required this.iconAsset, required this.selectedIconAsset});

  final String label;
  final String iconAsset;
  final String selectedIconAsset;
}

/// Floating bottom bar: two tabs, the round "Book now" action, two tabs.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.tabs,
    required this.selectedIndex,
    required this.onTabSelected,
    required this.onBookTap,
  }) : assert(tabs.length == 4);

  final List<AppNavTab> tabs;
  final int selectedIndex;
  final ValueChanged<int> onTabSelected;
  final VoidCallback onBookTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(12, 0, 12, 12 + bottomInset),
      child: Container(
        height: 68,
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: p.line),
          boxShadow: [BoxShadow(color: p.navShadow, blurRadius: 30, offset: const Offset(0, 10))],
        ),
        child: Row(
          children: [
            Expanded(child: _tab(0)),
            Expanded(child: _tab(1)),
            Expanded(child: _BookAction(onTap: onBookTap)),
            Expanded(child: _tab(2)),
            Expanded(child: _tab(3)),
          ],
        ),
      ),
    );
  }

  Widget _tab(int index) => _NavItem(
        tab: tabs[index],
        selected: index == selectedIndex,
        onTap: () => onTabSelected(index),
      );
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.tab, required this.selected, required this.onTap});

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
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            height: 30,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: selected ? p.brandTint : Colors.transparent,
              borderRadius: BorderRadius.circular(15),
            ),
            child: SvgPicture.asset(
              selected ? tab.selectedIconAsset : tab.iconAsset,
              height: 20,
              colorFilter: ColorFilter.mode(iconColor, BlendMode.srcIn),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            tab.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.navLabel(selected ? p.ink : p.inkSubtle, selected: selected),
          ),
        ],
      ),
    );
  }
}

class _BookAction extends StatelessWidget {
  const _BookAction({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return PressableScale(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: p.brand,
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: p.brand.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4))],
            ),
            child: Center(
              child: SvgPicture.asset(
                'assets/package_box_file.svg',
                height: 20,
                colorFilter: ColorFilter.mode(p.onBrand, BlendMode.srcIn),
              ),
            ),
          ),
          const SizedBox(height: 2),
          Text('Book now'.tr,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.navLabel(p.brandText, selected: true)),
        ],
      ),
    );
  }
}
