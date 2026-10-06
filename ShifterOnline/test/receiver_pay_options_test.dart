import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/receiver_pay_options.dart';

void main() {
  group('normalizeIndianMobile', () {
    test('strips formatting and prefixes', () {
      expect(normalizeIndianMobile('+91 98765 43210'), '9876543210');
      expect(normalizeIndianMobile('09876543210'), '9876543210');
      expect(normalizeIndianMobile('98765-43210'), '9876543210');
    });
    test('too short or empty gives empty', () {
      expect(normalizeIndianMobile(''), '');
      expect(normalizeIndianMobile(null), '');
      expect(normalizeIndianMobile('12345'), '');
    });
  });

  group('percentChoices', () {
    test('standard', () {
      expect(percentChoices(5), [0, 1, 2, 3, 5]);
      expect(percentChoices(10), [0, 1, 2, 3, 5, 10]);
      expect(percentChoices(2.5), [0, 1, 2, 2.5]);
      expect(percentChoices(3), [0, 1, 2, 3]);
    });
    test('zero or negative', () {
      expect(percentChoices(0), [0]);
      expect(percentChoices(-1), [0]);
    });
  });

  group('ReceiverPayConfig.fromResponse', () {
    test('normal map', () {
      final c = ReceiverPayConfig.fromResponse({
        'config': {'enabled': true, 'max_percent': 5, 'max_amount': '500.5'}
      });
      expect(c.enabled, true);
      expect(c.maxPercent, 5);
      expect(c.maxAmount, 500.5);
    });
    test('null and empty are disabled', () {
      expect(ReceiverPayConfig.fromResponse(null).enabled, false);
      expect(ReceiverPayConfig.fromResponse({}).enabled, false);
      expect(ReceiverPayConfig.fromResponse({'config': 'junk'}).enabled, false);
    });
    test('enabled truthiness', () {
      bool e(dynamic v) =>
          ReceiverPayConfig.fromResponse({'config': {'enabled': v}}).enabled;
      expect(e(true), true);
      expect(e('true'), true);
      expect(e(1), true);
      expect(e('1'), true);
      expect(e(false), false);
      expect(e('yes'), false);
      expect(e(2), false);
    });
  });

  group('receiverPayUnavailableReason', () {
    const on = ReceiverPayConfig(enabled: true, maxPercent: 5, maxAmount: 500);
    test('disabled config', () {
      expect(
          receiverPayUnavailableReason(
              config: ReceiverPayConfig.disabled,
              payValue: 1,
              dropMobile: '9876543210'),
          isNotNull);
    });
    test('wallet', () {
      expect(
          receiverPayUnavailableReason(
              config: on, payValue: -2, dropMobile: '9876543210'),
          isNotNull);
    });
    test('bad number', () {
      expect(
          receiverPayUnavailableReason(
              config: on, payValue: 1, dropMobile: '123'),
          isNotNull);
    });
    test('available', () {
      expect(
          receiverPayUnavailableReason(
              config: on, payValue: 1, dropMobile: '+91 98765 43210'),
          isNull);
    });
  });

  group('settlement receiver helpers', () {
    test('isReceiverPaying only for receiver + pending', () {
      expect(isReceiverPaying({'payer': 'receiver', 'status': 'pending'}), true);
      expect(isReceiverPaying({'payer': 'receiver', 'status': 'cash_received'}), false);
      expect(isReceiverPaying({'payer': 'receiver', 'status': 'disputed'}), false);
      expect(isReceiverPaying({'payer': 'customer', 'status': 'pending'}), false);
    });
    test('legacy / null maps are normal customer settlements', () {
      expect(isReceiverPaying({'status': 'pending'}), false);
      expect(isReceiverPaying({'payer': null, 'status': 'pending'}), false);
      expect(isReceiverPaying(null), false);
      expect(isReceiverPaying({}), false);
    });
    test('receiverPayTotal falls back to amount_due', () {
      expect(receiverPayTotal({'receiver_pay_total': 120.5, 'amount_due': 100}), 120.5);
      expect(receiverPayTotal({'receiver_pay_total': '0', 'amount_due': '100'}), 100);
      expect(receiverPayTotal({'amount_due': 80}), 80);
      expect(receiverPayTotal({}), 0);
      expect(receiverPayTotal({'receiver_pay_total': null, 'amount_due': null}), 0);
    });
    test('receiverMarkup reads safely', () {
      expect(receiverMarkup({'receiver_markup': '12'}), 12);
      expect(receiverMarkup({}), 0);
    });
  });

  group('receiverDueAmount', () {
    test('is total minus discount; the advance is not subtracted', () {
      expect(receiverDueAmount(total: 500, discount: 50), 450);
      expect(receiverDueAmount(total: 500, discount: 0), 500);
    });
    test('clamps at zero', () {
      expect(receiverDueAmount(total: 100, discount: 150), 0);
      expect(receiverDueAmount(total: 0, discount: 0), 0);
    });
  });

  group('receiverNumberUpdatedKey', () {
    test('says the link was sent only when the backend sent it', () {
      expect(receiverNumberUpdatedKey(true), 'Receiver number updated. Payment link sent to the new number.');
      expect(receiverNumberUpdatedKey('true'), 'Receiver number updated. Payment link sent to the new number.');
    });
    test('plain confirmation when no link went out', () {
      expect(receiverNumberUpdatedKey(false), 'Receiver number updated');
      expect(receiverNumberUpdatedKey(null), 'Receiver number updated');
    });
  });

  group('dueAtDrop', () {
    test('normal order: advance is netted off the fare', () {
      expect(dueAtDrop(total: 100, advance: 20, discount: 10, receiverMode: false), 70);
    });
    test('receiver pays: the advance is a held deposit and is not netted off', () {
      expect(dueAtDrop(total: 100, advance: 20, discount: 10, receiverMode: true), 90);
    });
    test('never negative', () {
      expect(dueAtDrop(total: 50, advance: 80, discount: 0, receiverMode: false), 0);
      expect(dueAtDrop(total: 50, advance: 0, discount: 80, receiverMode: true), 0);
    });
  });
}
