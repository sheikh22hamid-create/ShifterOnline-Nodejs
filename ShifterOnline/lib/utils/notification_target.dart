/// Which screen a tapped push notification opens (spec 2026-11-15). Pure: it only reads the notification's data map
/// (`type`, `order_id`, ...) that the backend already sends, so the push system itself is untouched.
///
///  * every ride notification that names a booking opens that booking's tracking / details screen (TrackingWay), which
///    already shows the right thing for the booking's CURRENT state: driver details, route and live tracking while it is
///    active, the completed ride, or the cancellation;
///  * payment notifications (a pending payment for a ride, wallet money) open the ride's screen or the wallet;
///  * a ride notification with a missing or invalid booking id falls back to the My Orders list;
///  * a real chat message (a `receiverId` and no ride type) still opens the chat;
///  * anything else (account / KYC notices, unknown types without a booking) opens nothing, never a chat page.
library;

enum NotificationScreen { tracking, wallet, customise, myOrders, chat, none }

class NotificationTarget {
  final NotificationScreen screen;

  /// The booking (or Customise Order) id as a positive integer string; empty when the notification has none.
  final String orderId;

  const NotificationTarget(this.screen, {this.orderId = ''});

  @override
  String toString() => 'NotificationTarget($screen, order=$orderId)';
}

/// Ride notifications whose data names one booking (`order_id`).
const Set<String> rideNotificationTypes = {
  'trip_milestone', // booking confirmed / driver reached pickup / ride started / ride completed ... (event in `milestone`)
  'order_assigned',
  'next_day_assigned',
  'no_driver_found',
  'order_cancelled',
  'advance_timeout_cancel',
  'scheduled_cancelled',
  'schedule_reminder',
  'schedule_confirm',
  'schedule_live',
  'schedule_late_pickup',
  'destination_updated',
  'pickup_updated',
  'stop_added',
  'free_booking_refunded',
  'settlement_pending', // payment still to be made for the ride: the ride screen carries the payment sheet
  'force_assign',
};

const Set<String> _walletTypes = {'wallet_transaction'};
const Set<String> _customiseTypes = {'customise_offer', 'customise_order', 'customise_relisted'};

/// A positive integer booking id as a string, or '' when it is missing, non-numeric, zero or negative.
String validOrderId(Object? raw) {
  final text = (raw ?? '').toString().trim();
  final id = int.tryParse(text);
  return id != null && id > 0 ? id.toString() : '';
}

NotificationTarget resolveNotificationTarget(Map<String, dynamic>? data) {
  if (data == null || data.isEmpty) return const NotificationTarget(NotificationScreen.none);
  final type = (data['type'] ?? '').toString().trim().toLowerCase();
  final orderId = validOrderId(data['order_id']);

  if (_walletTypes.contains(type)) return const NotificationTarget(NotificationScreen.wallet);
  if (_customiseTypes.contains(type)) {
    return orderId.isEmpty
        ? const NotificationTarget(NotificationScreen.myOrders)
        : NotificationTarget(NotificationScreen.customise, orderId: orderId);
  }
  if (rideNotificationTypes.contains(type)) {
    return orderId.isEmpty
        ? const NotificationTarget(NotificationScreen.myOrders)
        : NotificationTarget(NotificationScreen.tracking, orderId: orderId);
  }

  // A chat message: names who to talk to, and is not a ride type.
  final receiverId = (data['receiverId'] ?? '').toString().trim();
  if (receiverId.isNotEmpty) return const NotificationTarget(NotificationScreen.chat);

  // An unknown type that still names a booking is a ride update from a newer backend: open that booking.
  if (type.isNotEmpty && orderId.isNotEmpty && !_isAccountType(type)) {
    return NotificationTarget(NotificationScreen.tracking, orderId: orderId);
  }
  return const NotificationTarget(NotificationScreen.none);
}

bool _isAccountType(String type) => type == 'account_status' || type == 'kyc_document_decision' || type == 'model1_suspended';
