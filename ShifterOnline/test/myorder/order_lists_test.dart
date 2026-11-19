import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/Api/AppModelApi/order_history_api_model.dart';
import 'package:goParcel/screens/myorder/order_lists.dart';

OrderHistory _o(String id, String status) => OrderHistory(id: id, status: status);

void main() {
  test('no running order: Recently still lists finished orders, newest first', () {
    final list = recentOrders(const [], [_o('9', 'Completed'), _o('12', 'Cancelled'), _o('3', 'Completed')]);
    expect(list.map((o) => o.id), ['12', '9', '3']);
  });

  test('running and finished together, sorted by order id, each once', () {
    final list = recentOrders([_o('20', 'Pending'), _o('12', 'Processing')], [_o('12', 'Processing'), _o('15', 'Completed')]);
    expect(list.map((o) => o.id), ['20', '15', '12']);
  });

  test('favourite / Book Again only on finished orders', () {
    expect(isFinishedOrder(_o('1', 'Completed')), isTrue);
    expect(isFinishedOrder(_o('1', 'Cancelled')), isTrue);
    expect(isFinishedOrder(_o('1', 'Pending')), isFalse);
  });
}
