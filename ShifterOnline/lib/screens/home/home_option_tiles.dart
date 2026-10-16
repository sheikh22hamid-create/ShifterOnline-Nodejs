import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:provider/provider.dart';
import '../../services/free_booking_api_service.dart';
import '../../utils/colors.dart';
import '../profile/free_booking_status_card.dart';
import '../profile/premium_plans_screen.dart';

/// Home page option tile with the same look and size as the existing Next Day / Schedule tiles
/// (rounded white card, 38px gradient icon, bold title, small grey subtitle).
class HomeOptionTile extends StatelessWidget {
  const HomeOptionTile({
    super.key,
    required this.icon,
    required this.gradient,
    required this.borderColor,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.badge,
  });

  final IconData icon;
  final List<Color> gradient;
  final Color borderColor;
  final String title;
  final String? subtitle;

  /// Small tag shown above the tile's top-right corner, e.g. "Coming Soon".
  final String? badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final notifier = Provider.of<ColorNotifier>(context);
    return Stack(
      clipBehavior: Clip.none,
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
            decoration: BoxDecoration(
              color: notifier.getBgColor,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: borderColor, width: 1.2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  height: 38,
                  width: 38,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: gradient,
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: Colors.white, size: 21),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: notifier.text,
                          fontFamily: 'Gilroy_Bold',
                          fontSize: 13,
                          height: 1.15,
                        ),
                      ),
                      if (subtitle != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: greaycolor,
                            fontFamily: 'Gilroy_Medium',
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (badge != null)
          Positioned(
            top: -7,
            right: 10,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xffF3E8FF),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                badge!,
                style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 9,
                  color: Color(0xff9333EA),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Info dialog in the app's rounded style: close button, round icon, coloured title, message and one action.
Future<void> showHomeInfoDialog({
  required IconData icon,
  required Color color,
  required String title,
  required String message,
  required String buttonLabel,
  String? subtitle,
  String? tag,
  VoidCallback? onButton,
}) {
  final notifier = Provider.of<ColorNotifier>(Get.context!, listen: false);
  return Get.dialog(
    Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      child: Container(
        padding: const EdgeInsets.fromLTRB(22, 14, 22, 22),
        decoration: BoxDecoration(
          color: notifier.getBgColor,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: InkWell(
                onTap: () => Get.back(),
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(Icons.close_rounded, color: greaycolor, size: 22),
                ),
              ),
            ),
            Container(
              height: 68,
              width: 68,
              decoration: BoxDecoration(
                  color: color.withOpacity(0.14), shape: BoxShape.circle),
              child: Icon(icon, color: color, size: 32),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: color, fontFamily: 'Gilroy_Bold', fontSize: 20),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: TextStyle(
                    color: notifier.text,
                    fontFamily: 'Gilroy_Medium',
                    fontSize: 14),
              ),
            ],
            if (tag != null) ...[
              const SizedBox(height: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                    color: color.withOpacity(0.14),
                    borderRadius: BorderRadius.circular(8)),
                child: Text(tag,
                    style: TextStyle(
                        color: color, fontFamily: 'Gilroy_Bold', fontSize: 12)),
              ),
            ],
            const SizedBox(height: 10),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: notifier.text,
                  fontFamily: 'Gilroy_Medium',
                  fontSize: 14.5,
                  height: 1.4),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: onButton ?? () => Get.back(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: color,
                  disabledBackgroundColor: color.withOpacity(0.25),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                ),
                child: Text(
                  buttonLabel,
                  style: const TextStyle(
                      color: Colors.white,
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// "Free Ride Chance" tile: replaces the old status card on the Home page. It loads the same Free Booking
/// status the card used and, on tap, shows the matching message (locked -> the existing referral share,
/// not used yet -> how the free booking works, non-premium -> the Premium upsell).
class FreeRideChanceTile extends StatefulWidget {
  const FreeRideChanceTile({super.key});

  @override
  State<FreeRideChanceTile> createState() => _FreeRideChanceTileState();
}

class _FreeRideChanceTileState extends State<FreeRideChanceTile> {
  String _state = 'offer_off';
  String _message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final uid = int.tryParse(GetStorage().read('Uid')?.toString() ?? '') ?? 0;
    if (uid == 0) return;
    final result = await FreeBookingApiService.status(uid);
    if (!mounted) return;
    setState(() {
      _state = result['state'] as String;
      _message = result['message'] as String;
    });
  }

  void _onTap() {
    const orange = Color(0xfff26522);
    switch (_state) {
      case 'locked':
        showHomeInfoDialog(
          icon: Icons.lock_outline_rounded,
          color: orange,
          title: 'Free Ride Chance Locked'.tr,
          // The backend message carries the real referral count set by the admin.
          message: _message.isNotEmpty
              ? _message
              : 'Free Booking Chance is locked. Complete referrals to unlock it.'
                  .tr,
          buttonLabel: 'Refer now'.tr,
          onButton: () {
            Get.back();
            shareReferralInvite();
          },
        );
      case 'available':
      case 'unlocked':
        showHomeInfoDialog(
          icon: Icons.card_giftcard_rounded,
          color: orange,
          title: 'Get Free Booking Chance!'.tr,
          message:
              'On booking with company selected vehicle, you will get the full amount refunded from the receiver.'
                  .tr,
          buttonLabel: 'Okay'.tr,
        );
      case 'not_premium':
        showHomeInfoDialog(
          icon: Icons.star_rounded,
          color: orange,
          title: 'Win Free Rides with Premium'.tr,
          message:
              'Premium members get a chance to win 100% wallet cashback when served by a company free pool vehicle.'
                  .tr,
          buttonLabel: 'Get Premium'.tr,
          onButton: () {
            Get.back();
            Get.to(() => const PremiumPlansScreen());
          },
        );
      default:
        // open_booking (a free booking is already running) or the offer is not live in this city.
        showHomeInfoDialog(
          icon: Icons.card_giftcard_rounded,
          color: orange,
          title: 'Free Ride Chance'.tr,
          message: _message.isNotEmpty
              ? _message
              : 'Free Ride Chance is not available right now.'.tr,
          buttonLabel: 'Okay'.tr,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return HomeOptionTile(
      icon: Icons.bolt_rounded,
      gradient: const [Color(0xffFF8A3D), Color(0xfff26522)],
      borderColor: const Color(0xfff26522).withOpacity(0.4),
      title: 'Free Ride Chance'.tr,
      onTap: _onTap,
    );
  }
}

/// "Custom Order (with bargaining)" tile: not live yet, so it only opens the Coming Soon message.
class CustomOrderComingSoonTile extends StatelessWidget {
  const CustomOrderComingSoonTile({super.key});

  @override
  Widget build(BuildContext context) {
    return HomeOptionTile(
      icon: Icons.card_giftcard_rounded,
      gradient: const [Color(0xffB34EFF), Color(0xff7B2FF7)],
      borderColor: const Color(0xff7B2FF7).withOpacity(0.3),
      title: 'Custom Order'.tr,
      subtitle: '(with bargaining)'.tr,
      badge: 'Coming Soon'.tr,
      onTap: () => showHomeInfoDialog(
        icon: Icons.card_giftcard_rounded,
        color: const Color(0xff9333EA),
        title: 'Custom Order'.tr,
        subtitle: '(with bargaining)'.tr,
        tag: 'Coming Soon'.tr,
        message:
            'Soon you will be able to place custom orders with bargaining.'.tr,
        buttonLabel: 'Coming Soon'.tr,
        onButton: () => Get.back(),
      ),
    );
  }
}
