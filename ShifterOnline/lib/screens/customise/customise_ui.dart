import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import '../../theme/app_tokens.dart';
import '../home/widgets/feature_intro_sheet.dart';

/// Small shared pieces for the Customise Order screens (list, form, detail), in the v2 look.

/// Status of a Customise Order in plain words, with its colour.
class CustomiseStatus {
  const CustomiseStatus(this.label, this.hint);
  final String label;
  final String hint;

  static CustomiseStatus of(String status) {
    switch (status) {
      case 'scheduled':
        return const CustomiseStatus('Starts soon', 'Drivers can send offers once bargaining starts');
      case 'open':
        return const CustomiseStatus('Taking offers', 'Drivers are seeing your price now');
      case 'converted':
        return const CustomiseStatus('Driver confirmed', 'Your order is now a ride');
      case 'expired':
        return const CustomiseStatus('Expired', 'No driver was confirmed in time');
      case 'cancelled':
        return const CustomiseStatus('Cancelled', 'You cancelled this order');
      default:
        return CustomiseStatus(status.isEmpty ? '—' : status, '');
    }
  }

  static (Color fg, Color bg) colors(String status) {
    final p = AppPalette.current;
    switch (status) {
      case 'open':
        return (p.brandText, p.brandTint);
      case 'converted':
        return (p.successText, p.successTint);
      case 'scheduled':
        return (p.warning, p.warningTint);
      case 'cancelled':
        return (p.danger, p.dangerTint);
      default:
        return (p.inkMuted, p.canvas);
    }
  }
}

class CustomiseStatusChip extends StatelessWidget {
  const CustomiseStatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = CustomiseStatus.colors(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child:
          Text(CustomiseStatus.of(status).label.tr, style: AppText.caption(fg).copyWith(fontFamily: 'Gilroy_Bold', fontSize: 12)),
    );
  }
}

/// White card with an optional numbered step badge, a title and a one-line helper.
class CustomiseSection extends StatelessWidget {
  const CustomiseSection({super.key, this.step, required this.title, this.subtitle, required this.children});

  final int? step;
  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card,
      ),
      child: Material(
        color: p.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (step != null) ...[
                    Container(
                      width: 26,
                      height: 26,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: p.brand, shape: BoxShape.circle),
                      child: Text('$step', style: AppText.bodyStrong(p.onBrand).copyWith(fontSize: 13)),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title.tr, style: AppText.section(p.ink)),
                        if (subtitle != null) ...[
                          const SizedBox(height: 2),
                          Text(subtitle!.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 12.5, height: 1.3)),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      ),
    );
  }
}

/// Tap-to-choose place row (pickup / stop / drop) with its route marker.
class CustomisePlaceTile extends StatelessWidget {
  const CustomisePlaceTile({super.key, required this.marker, required this.placeholder, this.address, required this.onTap});

  final Widget marker;
  final String placeholder;
  final String? address;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final chosen = address != null && address!.trim().isNotEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: p.canvas,
        borderRadius: BorderRadius.circular(AppRadius.input),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.input),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  marker,
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      chosen ? address!.trim() : placeholder.tr,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style:
                          chosen ? AppText.body(p.ink).copyWith(fontSize: 14) : AppText.body(p.inkSubtle).copyWith(fontSize: 14),
                    ),
                  ),
                  Icon(chosen ? Icons.edit_outlined : Icons.chevron_right_rounded, size: 20, color: p.inkSubtle),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Text field in the app's input style.
class CustomiseField extends StatelessWidget {
  const CustomiseField({
    super.key,
    required this.label,
    required this.controller,
    this.number = false,
    this.decimal = false,
    this.lines = 1,
    this.hint,
    this.prefix,
    this.big = false,
  });

  final String label;
  final TextEditingController controller;
  final bool number;
  final bool decimal;
  final int lines;
  final String? hint;
  final String? prefix;

  /// Large text (the price).
  final bool big;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final style = big ? AppText.title(p.ink) : AppText.body(p.ink).copyWith(fontSize: 14.5);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(
        controller: controller,
        maxLines: lines,
        keyboardType:
            number ? (decimal ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.number) : TextInputType.text,
        inputFormatters: number ? [FilteringTextInputFormatter.allow(RegExp(decimal ? r'[0-9.]' : r'[0-9]'))] : null,
        style: style,
        decoration: InputDecoration(
          labelText: label.tr,
          hintText: hint?.tr,
          prefixText: prefix,
          prefixStyle: style,
          isDense: !big,
          filled: true,
          fillColor: p.surface,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.input), borderSide: BorderSide(color: p.line)),
          enabledBorder:
              OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.input), borderSide: BorderSide(color: p.line)),
          focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.input), borderSide: BorderSide(color: p.brand, width: 1.5)),
          labelStyle: AppText.body(p.inkMuted).copyWith(fontSize: 14),
          hintStyle: AppText.body(p.inkSubtle).copyWith(fontSize: 14),
        ),
      ),
    );
  }
}

/// "How it works" in 3 steps — the same words as the Home tile's sheet.
class CustomiseHowItWorks extends StatelessWidget {
  const CustomiseHowItWorks({super.key});

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final intro = FeatureIntro.all[ServiceFeature.customise]!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(AppRadius.card)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('How it works'.tr, style: AppText.bodyStrong(p.brandText).copyWith(fontSize: 14)),
          const SizedBox(height: 10),
          for (var i = 0; i < intro.steps.length; i++)
            Padding(
              padding: EdgeInsets.only(bottom: i == intro.steps.length - 1 ? 0 : 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 22,
                    height: 22,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: p.brand, shape: BoxShape.circle),
                    child: Text('${i + 1}', style: AppText.caption(p.onBrand).copyWith(fontFamily: 'Gilroy_Bold')),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(intro.steps[i].tr, style: AppText.body(p.ink).copyWith(fontSize: 13.5, height: 1.35)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Collapsed "More details (optional)" block, so the form shows only what is needed first.
class CustomiseMore extends StatelessWidget {
  const CustomiseMore(
      {super.key, required this.title, required this.subtitle, required this.children, this.icon = Icons.tune_rounded});

  final String title;
  final String subtitle;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: p.canvas,
        borderRadius: BorderRadius.circular(AppRadius.input),
        clipBehavior: Clip.antiAlias,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 12),
            childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
            shape: const RoundedRectangleBorder(side: BorderSide.none),
            collapsedShape: const RoundedRectangleBorder(side: BorderSide.none),
            iconColor: p.inkMuted,
            collapsedIconColor: p.inkMuted,
            leading: Icon(icon, color: p.inkMuted, size: 20),
            title: Text(title.tr, style: AppText.bodyStrong(p.ink).copyWith(fontSize: 14)),
            subtitle: Text(subtitle.tr, style: AppText.caption(p.inkMuted)),
            children: children,
          ),
        ),
      ),
    );
  }
}
