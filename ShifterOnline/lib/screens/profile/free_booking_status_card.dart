import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:share_plus/share_plus.dart';
import '../../services/free_booking_api_service.dart';
import 'premium_plans_screen.dart';

/// Opens the share sheet with the customer's referral code and the app link (the "Refer now" action).
/// Shared by the status card below and the Home page's Free Ride Chance tile.
Future<void> shareReferralInvite() async {
  final storage = GetStorage();
  final code = storage.read('referral_code')?.toString() ??
      storage.read('UserLogin')?['referral_code']?.toString() ??
      '';
  final defaultMsg =
      "🚚 *Shifter Online — Smart Online Bhada Booking Platform!*\n\n"
      "Kisi bhi saman shifting ya delivery ke liye online book karein Tata Ace, Pickup ya 3-Wheeler!\n\n"
      "🌟 *Aapko Kya Milega:*\n"
      "✅ *Lowest Fare:* Market me sabse sasta aur transparent bhada\n"
      "✅ *100% Free Ride Chance:* Har ride par free trip jeetne ka mauka\n"
      "✅ *No-Driver Compensation:* Driver assign na hone par compensation\n"
      "✅ *Receiver Commission:* Har delivery par commission earn karne ka option\n\n"
      "🎁 *Use my Referral Code for instant rewards:*\n"
      "👉 My Referral Code: {CODE}\n\n"
      "📲 *Download App:* https://play.google.com/store/apps/details?id=com.shifter.online&pcampaignid=web_share";

  final msg = storage.read('referral_msg')?.toString() ?? defaultMsg;
  String? packageName;
  try {
    packageName = (await PackageInfo.fromPlatform()).packageName;
  } catch (_) {}

  String shareText;
  if (msg.contains('{CODE}')) {
    shareText = msg.replaceAll('{CODE}', code);
  } else {
    final text = StringBuffer(msg);
    if (code.isNotEmpty) {
      text.write('\n\nReferral Code: $code');
    }
    if (packageName != null) {
      text.write('\n\nDownload: https://play.google.com/store/apps/details?id=$packageName');
    }
    shareText = text.toString();
  }
  await Share.share(shareText, subject: 'Refer & Earn - Shifter Online');
}

/// Shows the customer's Free Booking state while the offer is live in their city:
/// available / unlocked / locked (with a Refer now button) and, for non-premium users,
/// a Premium upsell (hidden with [showUpsell] = false, e.g. on the Premium Plans screen itself).
class FreeBookingStatusCard extends StatefulWidget {
  const FreeBookingStatusCard({super.key, this.showUpsell = true});

  final bool showUpsell;

  @override
  State<FreeBookingStatusCard> createState() => _FreeBookingStatusCardState();
}

class _FreeBookingStatusCardState extends State<FreeBookingStatusCard> {
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

  Future<void> _referNow() => shareReferralInvite();

  @override
  Widget build(BuildContext context) {
    final upsell = _state == 'not_premium';
    if (_state == 'offer_off' || _message.isEmpty || (upsell && !widget.showUpsell)) return const SizedBox.shrink();
    final good = _state == 'available' || _state == 'unlocked';
    final color = good ? Colors.green : (upsell ? const Color(0xfff26522) : Colors.orange.shade800);
    final title = switch (_state) {
      'available' => 'Free Ride Chance Active'.tr,
      'unlocked' => 'Free Ride Chance Unlocked'.tr,
      'locked' => 'Free Ride Chance Locked'.tr,
      'not_premium' => 'Win Free Rides with Premium'.tr,
      _ => 'Free Ride Chance'.tr,
    };
    final body = upsell
        ? 'Premium members get a chance to win 100% wallet cashback when served by a company free pool vehicle.'.tr
        : _message;
    final action = switch (_state) {
      'locked' => (label: 'Refer now'.tr, icon: Icons.share_rounded, onTap: _referNow),
      'not_premium' => (label: 'Get Premium'.tr, icon: Icons.star_rounded, onTap: () => Get.to(() => const PremiumPlansScreen())),
      _ => null,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            good || upsell ? Icons.card_giftcard_rounded : Icons.lock_outline_rounded,
            color: color,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(fontSize: 13, height: 1.35)),
                if (action != null) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    height: 36,
                    child: ElevatedButton.icon(
                      onPressed: action.onTap,
                      icon: Icon(action.icon, size: 16, color: Colors.white),
                      label: Text(action.label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: color,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
