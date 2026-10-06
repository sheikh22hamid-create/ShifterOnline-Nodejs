import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:get_storage/get_storage.dart';
import '../../services/free_booking_api_service.dart';

/// Shows the customer's Free Booking state. Hidden for non-premium users and when the offer is off.
class FreeBookingStatusCard extends StatefulWidget {
  const FreeBookingStatusCard({super.key});

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

  @override
  Widget build(BuildContext context) {
    if (_state == 'offer_off' || _state == 'not_premium' || _message.isEmpty) return const SizedBox.shrink();
    final good = _state == 'available' || _state == 'unlocked';
    final color = good ? Colors.green : Colors.orange.shade800;
    final title = switch (_state) {
      'available' => 'Free Booking Available'.tr,
      'unlocked' => 'Free Booking Unlocked'.tr,
      'locked' => 'Free Booking Locked'.tr,
      _ => 'Free Booking'.tr,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(good ? Icons.card_giftcard_rounded : Icons.lock_outline_rounded, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: color)),
                const SizedBox(height: 4),
                Text(_message, style: const TextStyle(fontSize: 13, height: 1.35)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
