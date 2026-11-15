import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/notification_target.dart';

NotificationTarget t(Map<String, dynamic>? data) => resolveNotificationTarget(data);

void main() {
  group('ride notifications open the booking they name (never a chat page)', () {
    for (final type in rideNotificationTypes) {
      test(type, () {
        final target = t({'type': type, 'order_id': '929'});
        expect(target.screen, NotificationScreen.tracking);
        expect(target.orderId, '929');
      });
    }

    test('trip milestones (booking confirmed, driver reached, ride started, completed) all go to the booking', () {
      for (final milestone in ['booked', 'driver_reached', 'ride_started', 'completed']) {
        final target = t({'type': 'trip_milestone', 'order_id': 12, 'milestone': milestone, 'event_id': '5'});
        expect(target, isA<NotificationTarget>().having((x) => x.screen, 'screen', NotificationScreen.tracking).having((x) => x.orderId, 'id', '12'));
      }
    });

    test('driver assigned, cancelled and payment-pending open that booking', () {
      expect(t({'type': 'order_assigned', 'order_id': '7'}).screen, NotificationScreen.tracking);
      expect(t({'type': 'order_cancelled', 'order_id': '7', 'reason': 'x'}).screen, NotificationScreen.tracking);
      expect(t({'type': 'settlement_pending', 'order_id': '7', 'amount': '90'}).screen, NotificationScreen.tracking);
    });
  });

  group('booking id problems fall back to My Orders, not to a broken or chat page', () {
    for (final id in [null, '', '   ', 'abc', '0', '-4', '3.5']) {
      test('order_id = $id', () {
        expect(t({'type': 'trip_milestone', 'order_id': id}).screen, NotificationScreen.myOrders);
      });
    }
    test('no order_id key at all', () {
      expect(t({'type': 'order_assigned'}).screen, NotificationScreen.myOrders);
    });
    test('an id with spaces around it still works', () {
      expect(t({'type': 'order_assigned', 'order_id': ' 41 '}).orderId, '41');
    });
  });

  group('payment and wallet', () {
    test('a wallet transaction opens the wallet', () {
      expect(t({'type': 'wallet_transaction', 'txn_type': 'credit', 'amount': '50'}).screen, NotificationScreen.wallet);
    });
  });

  group('customise orders', () {
    test('open that Customise Order, or My Orders without an id', () {
      final target = t({'type': 'customise_offer', 'order_id': '88'});
      expect((target.screen, target.orderId), (NotificationScreen.customise, '88'));
      expect(t({'type': 'customise_relisted'}).screen, NotificationScreen.myOrders);
    });
  });

  group('chat is kept for real chat messages only', () {
    test('a message that names who to talk to', () {
      expect(t({'receiverId': '55', 'receiverName': 'Asha'}).screen, NotificationScreen.chat);
    });
    test('a ride type wins over a stray receiverId', () {
      expect(t({'type': 'order_assigned', 'order_id': '9', 'receiverId': '55'}).screen, NotificationScreen.tracking);
    });
  });

  group('everything else opens nothing', () {
    test('empty, null, account notices, unknown type without a booking', () {
      expect(t(null).screen, NotificationScreen.none);
      expect(t({}).screen, NotificationScreen.none);
      expect(t({'type': 'account_status', 'is_blocked': '1'}).screen, NotificationScreen.none);
      expect(t({'type': 'kyc_document_decision', 'order_id': '9'}).screen, NotificationScreen.none);
      expect(t({'type': 'something_new'}).screen, NotificationScreen.none);
    });
    test('an unknown type that names a booking is a ride update: open the booking', () {
      expect(t({'type': 'driver_arrived_v2', 'order_id': '9'}).screen, NotificationScreen.tracking);
    });
    test('type matching ignores case and spaces', () {
      expect(t({'type': ' Order_Assigned ', 'order_id': '9'}).screen, NotificationScreen.tracking);
    });
  });
}
