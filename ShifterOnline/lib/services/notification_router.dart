import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:goParcel/screens/home/home.dart' show getdata;
import 'package:goParcel/screens/customise/customise_order_detail.dart';
import 'package:goParcel/screens/home/wallet_page.dart';
import 'package:goParcel/screens/myorder/myorder.dart';
import 'package:goParcel/screens/myorder/trackingway.dart';
import 'package:goParcel/utils/notification_target.dart';

/// Opens the right screen when a push notification is tapped (spec 2026-11-15). What to open comes from
/// [resolveNotificationTarget]; this class decides WHEN it is safe to open it:
///
///  * app killed or still on the splash: the tap is parked and opened by the Home screen as soon as it is up
///    ([markReady] + [openPending]), so the splash cannot navigate away from it;
///  * logged out: parked the same way and opened right after the customer logs in (the Home screen is what login lands on);
///  * running: opened at once, but never twice - a repeated tap on the same notification, or a tap for the booking that is
///    already on screen, does not stack another copy of the page.
class NotificationRouter {
  NotificationRouter._();

  static const _pendingTtl = Duration(minutes: 30);

  static bool _ready = false;
  static Map<String, dynamic>? _pending;
  static DateTime? _pendingAt;
  static String? _openKey;
  static DateTime? _lastOpenAt;

  static bool get _loggedIn => (getdata.read('Uid') ?? '').toString().trim().isNotEmpty;

  /// The Home screen calls this when it is mounted (true) and when it goes away, e.g. on logout (false).
  static void markReady(bool ready) {
    _ready = ready;
    if (!ready) _openKey = null;
  }

  /// Entry point for every notification tap (foreground, background and terminated).
  static void handleTap(Map<String, dynamic> data) {
    final target = resolveNotificationTarget(data);
    if (target.screen == NotificationScreen.none || target.screen == NotificationScreen.chat) return;
    if (!_ready || !_loggedIn) {
      _pending = Map<String, dynamic>.from(data);
      _pendingAt = DateTime.now();
      debugPrint('NotificationRouter: parked $target until the app is ready and the customer is logged in');
      return;
    }
    _open(target);
  }

  /// Opens a parked tap, once. Called by the Home screen after it has mounted.
  static void openPending() {
    final data = _pending;
    final at = _pendingAt;
    _pending = null;
    _pendingAt = null;
    if (data == null || at == null || !_ready || !_loggedIn) return;
    if (DateTime.now().difference(at) > _pendingTtl) return; // an old tap from long ago is not worth jumping to
    _open(resolveNotificationTarget(data));
  }

  static void _open(NotificationTarget target) {
    final key = '${target.screen.name}:${target.orderId}';
    final now = DateTime.now();
    // The same destination again within a moment, or already showing: do nothing (no duplicate screens).
    if (_openKey == key) return;
    if (_lastOpenAt != null && now.difference(_lastOpenAt!) < const Duration(milliseconds: 1200) && _openKey != null) return;
    if (target.screen == NotificationScreen.tracking &&
        Get.currentRoute == '/TrackingWay' &&
        (getdata.read('OrderID') ?? '').toString() == target.orderId) {
      return;
    }
    _openKey = key;
    _lastOpenAt = now;

    Future<void>? opened;
    switch (target.screen) {
      case NotificationScreen.tracking:
        // Same hand-off the in-app flows use: TrackingWay reads the booking id from storage and fetches the booking.
        getdata.write('OrderID', target.orderId);
        opened = Get.to(
          () => TrackingWay(type: 'Pickup', initialOrderData: {'order_id': target.orderId}),
          preventDuplicates: false,
        );
        break;
      case NotificationScreen.wallet:
        opened = Get.to(() => const WalletPage());
        break;
      case NotificationScreen.customise:
        opened = Get.to(() => CustomiseOrderDetail(orderId: int.parse(target.orderId)));
        break;
      case NotificationScreen.myOrders:
        opened = Get.to(() => const MyOrder());
        break;
      case NotificationScreen.chat:
      case NotificationScreen.none:
        break;
    }
    opened?.whenComplete(() {
      if (_openKey == key) _openKey = null;
    });
  }
}
