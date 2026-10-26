import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import 'package:provider/provider.dart';
import '../../services/free_booking_api_service.dart';
import '../../utils/colors.dart';
import '../customise/my_customise_orders.dart';

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
  Widget? content,
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
            if (content != null) ...[
              const SizedBox(height: 14),
              content,
            ],
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
/// not used yet -> how the free booking works). Open to general and premium customers alike.
class FreeRideChanceTile extends StatefulWidget {
  const FreeRideChanceTile({super.key});

  @override
  State<FreeRideChanceTile> createState() => _FreeRideChanceTileState();
}

class _FreeRideChanceTileState extends State<FreeRideChanceTile> {
  String _state = 'offer_off';
  String _message = '';
  int _referralsRequired = 0;
  int _referralsDone = 0;

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
      _referralsRequired = result['referrals_required'] as int;
      _referralsDone = result['referrals_done'] as int;
    });
  }

  /// Case 1 card: what happens when a free driver is confirmed.
  Widget _refundCard() {
    const green = Color(0xff2E9E5B);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: const Color(0xffE6F6EC),
          borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: green.withOpacity(0.18), shape: BoxShape.circle),
            child: const Icon(Icons.account_balance_wallet_rounded,
                color: green, size: 26),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'If a free driver is confirmed, you will get 100% booking amount refund.'
                  .tr,
              style: const TextStyle(
                  fontFamily: 'Gilroy_Bold',
                  fontSize: 14,
                  color: Color(0xff1F2937),
                  height: 1.35),
            ),
          ),
        ],
      ),
    );
  }

  /// Case 2 card: the admin's referral condition for the next free ride, with progress.
  Widget _referralConditionCard() {
    const orange = Color(0xfff26522);
    final required = _referralsRequired > 0 ? _referralsRequired : 1;
    final done = _referralsDone.clamp(0, required);
    final left = required - done;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: const Color(0xffFFF4DC),
          borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.campaign_rounded, color: orange, size: 26),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'To get next Free Ride Chance, complete the following condition:'
                      .tr,
                  style: const TextStyle(
                      fontFamily: 'Gilroy_Bold',
                      fontSize: 13,
                      color: Color(0xff1F2937)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: Colors.white, borderRadius: BorderRadius.circular(12)),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: const BoxDecoration(
                      color: orange, shape: BoxShape.circle),
                  child: const Icon(Icons.groups_rounded,
                      color: Colors.white, size: 22),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        left == 1
                            ? 'Refer 1 more friend'.tr
                            : 'Refer $left more friends'.tr,
                        style: const TextStyle(
                            fontFamily: 'Gilroy_Bold',
                            fontSize: 14,
                            color: Color(0xff1F2937)),
                      ),
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: done / required,
                          minHeight: 8,
                          backgroundColor: const Color(0xffE5E7EB),
                          valueColor: const AlwaysStoppedAnimation(
                              Color(0xff2E9E5B)),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Text('$done / $required',
                    style: const TextStyle(
                        fontFamily: 'Gilroy_Bold',
                        fontSize: 14,
                        color: Color(0xff1F2937))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _onTap() {
    const orange = Color(0xfff26522);
    switch (_state) {
      case 'locked':
        showHomeInfoDialog(
          icon: Icons.card_giftcard_rounded,
          color: orange,
          title: 'Free Ride Chance'.tr,
          message:
              'You have already received a free booking with 100% refund.'.tr,
          content: _referralConditionCard(),
          buttonLabel: 'Okay'.tr,
        );
      case 'available':
      case 'unlocked':
        showHomeInfoDialog(
          icon: Icons.card_giftcard_rounded,
          color: orange,
          title: 'Free Ride Chance'.tr,
          message:
              "You have a chance to book with our company's free drivers.".tr,
          content: _refundCard(),
          buttonLabel: 'Okay'.tr,
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

/// "Customise Order (with bargaining)" tile: opens the customer's negotiated orders and the form to post a new one.
class CustomiseOrderTile extends StatelessWidget {
  const CustomiseOrderTile({super.key});

  @override
  Widget build(BuildContext context) {
    return HomeOptionTile(
      icon: Icons.handshake_rounded,
      gradient: const [Color(0xffB34EFF), Color(0xff7B2FF7)],
      borderColor: const Color(0xff7B2FF7).withOpacity(0.3),
      title: 'Customise Order'.tr,
      subtitle: '(name your price)'.tr,
      onTap: () => Get.to(() => const MyCustomiseOrders()),
    );
  }
}

/// Kept for reference: the earlier "Coming Soon" version of the Customise Order tile (no longer used on Home).
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
