import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/utils/model_toggle_rules.dart';

/// The ON models for [count] models given the lowest ON index, as a readable list of model numbers (1-based).
List<int> on(int? lowest, int count) => [for (var i = 0; i < count; i++) if (isModelOn(lowest, i)) i + 1];

void main() {
  group('turning a model ON', () {
    test('turns ON every model above it (model 5 -> 1..5)', () {
      final next = applyModelToggle(lowestOnIndex: 0, index: 4, on: true, count: 5);
      expect(on(next, 5), [1, 2, 3, 4, 5]);
    });
    test('works from all OFF', () {
      expect(on(applyModelToggle(lowestOnIndex: null, index: 2, on: true, count: 5), 5), [1, 2, 3]);
    });
    test('does not touch the models below it', () {
      // 1..4 are ON; turning ON model 2 (already ON) must not turn 3 and 4 OFF
      final next = applyModelToggle(lowestOnIndex: 3, index: 1, on: true, count: 5);
      expect(on(next, 5), [1, 2, 3, 4]);
    });
  });

  group('turning a model OFF', () {
    const all5 = 4; // lowest ON = model 5
    test('model 5 OFF -> only model 5 goes OFF', () {
      expect(on(applyModelToggle(lowestOnIndex: all5, index: 4, on: false, count: 5), 5), [1, 2, 3, 4]);
    });
    test('model 4 OFF -> 4 and 5 OFF', () {
      expect(on(applyModelToggle(lowestOnIndex: all5, index: 3, on: false, count: 5), 5), [1, 2, 3]);
    });
    test('model 3 OFF -> 3, 4, 5 OFF', () {
      expect(on(applyModelToggle(lowestOnIndex: all5, index: 2, on: false, count: 5), 5), [1, 2]);
    });
    test('model 2 OFF -> 2, 3, 4, 5 OFF', () {
      expect(on(applyModelToggle(lowestOnIndex: all5, index: 1, on: false, count: 5), 5), [1]);
    });
    test('model 1 OFF -> everything OFF', () {
      expect(applyModelToggle(lowestOnIndex: all5, index: 0, on: false, count: 5), isNull);
    });
    test('turning OFF a model that is already OFF changes nothing', () {
      expect(applyModelToggle(lowestOnIndex: 1, index: 4, on: false, count: 5), 1);
      expect(applyModelToggle(lowestOnIndex: null, index: 3, on: false, count: 5), isNull);
    });
  });

  group('dynamic number of models', () {
    test('a single model just switches ON and OFF', () {
      expect(applyModelToggle(lowestOnIndex: null, index: 0, on: true, count: 1), 0);
      expect(applyModelToggle(lowestOnIndex: 0, index: 0, on: false, count: 1), isNull);
    });
    test('8 models behave the same way', () {
      var s = applyModelToggle(lowestOnIndex: 0, index: 7, on: true, count: 8);
      expect(on(s, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
      s = applyModelToggle(lowestOnIndex: s, index: 5, on: false, count: 8);
      expect(on(s, 8), [1, 2, 3, 4, 5]);
    });
    test('an index outside the list is ignored', () {
      expect(applyModelToggle(lowestOnIndex: 2, index: 9, on: true, count: 5), 2);
      expect(applyModelToggle(lowestOnIndex: 2, index: -1, on: false, count: 5), 2);
    });
  });
}
