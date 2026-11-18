import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/stop_rules.dart';

Map<String, dynamic> _pt(double lat, double lng) => {'lat_map': '$lat', 'long_map': '$lng'};

void main() {
  // Pickup at Rajwada, Indore; drop ~5 km north-east.
  final pickup = _pt(22.7186, 75.8551);
  final drop = _pt(22.7533, 75.8937);

  test('stop between pickup and drop is allowed', () {
    expect(isStopBeyondFinalDrop(pickup: pickup, drop: drop, stop: _pt(22.7350, 75.8740)), isFalse);
  });

  test('stop farther from pickup than the drop is beyond the drop', () {
    expect(isStopBeyondFinalDrop(pickup: pickup, drop: drop, stop: _pt(22.8000, 75.9500)), isTrue);
  });

  test('stop right at the drop (within 100 m tolerance) is allowed', () {
    expect(isStopBeyondFinalDrop(pickup: pickup, drop: drop, stop: _pt(22.7537, 75.8941)), isFalse);
  });

  test('missing or unreadable coordinates never block the stop', () {
    expect(isStopBeyondFinalDrop(pickup: pickup, drop: drop, stop: {'lat_map': '', 'long_map': null}), isFalse);
    expect(isStopBeyondFinalDrop(pickup: null, drop: drop, stop: _pt(22.8, 75.95)), isFalse);
    expect(isStopBeyondFinalDrop(pickup: pickup, drop: null, stop: _pt(22.8, 75.95)), isFalse);
  });

  test('firstStopBeyondDrop finds the index of the first offending stop, or -1', () {
    final stops = [_pt(22.7350, 75.8740), _pt(22.8000, 75.9500)];
    expect(firstStopBeyondDrop(pickup: pickup, drop: drop, stops: stops), 1);
    expect(firstStopBeyondDrop(pickup: pickup, drop: drop, stops: stops.sublist(0, 1)), -1);
  });
}
