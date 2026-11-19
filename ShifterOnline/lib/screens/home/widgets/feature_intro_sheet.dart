import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../../theme/app_tokens.dart';
import '../../../theme/widgets/app_buttons.dart';
import '../../../theme/widgets/app_sheet.dart';
import '../../../theme/widgets/v2_art.dart';

/// The four Home services. Each has a short "how it works" sheet, shown the first time its tile is tapped
/// and any time from the tile's ⓘ button.
enum ServiceFeature { bookNow, schedule, lowFare, customise }

class FeatureIntro {
  const FeatureIntro({
    required this.title,
    required this.tagline,
    required this.art,
    required this.steps,
    this.note,
  });

  final String title;
  final String tagline;
  final String art;
  final List<String> steps;

  /// One extra line (e.g. who can use it), shown under the steps.
  final String? note;

  static const Map<ServiceFeature, FeatureIntro> all = {
    ServiceFeature.bookNow: FeatureIntro(
      title: 'Book Now',
      tagline: 'A vehicle at your pickup in minutes',
      art: 'assets/v2/tile_book_now.png',
      steps: [
        'Choose the drop location and a vehicle that fits your goods',
        'See the full fare before you book, no surprises',
        'The nearest driver comes to your pickup. Track the trip live',
      ],
    ),
    ServiceFeature.schedule: FeatureIntro(
      title: 'Schedule',
      tagline: 'Book now, pickup at the time you choose',
      art: 'assets/v2/tile_schedule.png',
      steps: [
        'Choose the drop, the vehicle, and a pickup date and time',
        'See the fare now and confirm the booking',
        'A driver is assigned before your time and comes to the pickup',
      ],
    ),
    ServiceFeature.lowFare: FeatureIntro(
      title: 'Low Fare',
      tagline: 'Next-day delivery at a lower price',
      art: 'assets/v2/tile_low_fare.png',
      steps: [
        'Choose a date (tomorrow or later) and a time window for pickup',
        'Pay less than a normal booking for the same trip',
        'A driver takes your order within that window and comes for pickup',
      ],
      note: 'Available with a Premium plan. Best when the delivery is not urgent.',
    ),
    ServiceFeature.customise: FeatureIntro(
      title: 'Customise Order',
      tagline: 'Offer your own fare',
      art: 'assets/v2/tile_customise.png',
      steps: [
        'Enter your pickup, drop and the fare you want to pay',
        'Nearby drivers accept it or send you a counter-offer',
        'Pick the offer you like. It becomes a normal ride at that fare',
      ],
    ),
  };
}

/// Storage key that remembers the sheet was seen (then a tile tap goes straight to the feature).
String featureIntroSeenKey(ServiceFeature f) => 'feature_intro_seen_${f.name}';

/// "How it works" bottom sheet. [onContinue] runs the feature; without it the sheet only explains (ⓘ).
class FeatureIntroSheet extends StatelessWidget {
  const FeatureIntroSheet({super.key, required this.feature, this.onContinue});

  final ServiceFeature feature;
  final VoidCallback? onContinue;

  @override
  Widget build(BuildContext context) {
    final p = AppPalette.current;
    final intro = FeatureIntro.all[feature]!;
    return AppSheet(
      padding: EdgeInsets.fromLTRB(20, 8, 20, 16 + MediaQuery.paddingOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 150,
            decoration: BoxDecoration(color: p.brandTint, borderRadius: BorderRadius.circular(AppRadius.card)),
            padding: const EdgeInsets.all(12),
            child: V2Art(asset: intro.art, placeholderLabel: intro.title, fit: BoxFit.contain),
          ),
          const SizedBox(height: 16),
          Text(intro.title.tr, style: AppText.title(p.ink)),
          const SizedBox(height: 4),
          Text(intro.tagline.tr, style: AppText.body(p.inkMuted).copyWith(fontSize: 14.5)),
          const SizedBox(height: 18),
          Text('How it works'.tr,
              style: AppText.caption(p.inkSubtle).copyWith(fontFamily: 'Gilroy_Bold', letterSpacing: 0.4)),
          const SizedBox(height: 10),
          for (var i = 0; i < intro.steps.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 26,
                    height: 26,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: p.brand, shape: BoxShape.circle),
                    child: Text('${i + 1}', style: AppText.bodyStrong(p.onBrand).copyWith(fontSize: 13)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(intro.steps[i].tr, style: AppText.body(p.ink).copyWith(fontSize: 14.5, height: 1.35)),
                    ),
                  ),
                ],
              ),
            ),
          if (intro.note != null) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: p.canvas, borderRadius: BorderRadius.circular(12)),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline_rounded, size: 18, color: p.inkMuted),
                  const SizedBox(width: 8),
                  Expanded(child: Text(intro.note!.tr, style: AppText.caption(p.inkMuted).copyWith(fontSize: 13, height: 1.35))),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 4),
          AppPrimaryButton(
            label: (onContinue != null ? 'Continue' : 'Got it').tr,
            onPressed: () {
              Navigator.of(context).pop();
              onContinue?.call();
            },
          ),
        ],
      ),
    );
  }
}

/// Opens the sheet. Returns when it closes.
Future<void> showFeatureIntro(BuildContext context, ServiceFeature feature, {VoidCallback? onContinue}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => SingleChildScrollView(child: FeatureIntroSheet(feature: feature, onContinue: onContinue)),
    );
