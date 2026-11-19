import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/screens/myorder/tracking_steps.dart';

void main() {
  test('while searching for a driver no step is active (not "Assigned")', () {
    expect(heroStepIndex('Pending', searching: true), 0);
    expect(heroStepIndex('Processing', searching: true), 0);
  });

  test('statuses map to their step', () {
    expect(heroStepIndex('Processing', searching: false), 1);
    expect(heroStepIndex('pickup', searching: false), 2);
    expect(heroStepIndex('On Route', searching: false), 3);
    expect(heroStepIndex('in transit', searching: false), 3);
    expect(heroStepIndex('Completed', searching: false), 5);
  });
}
