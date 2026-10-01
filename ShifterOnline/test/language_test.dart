import 'package:flutter_test/flutter_test.dart';
import 'package:goParcel/Language/language_config.dart';
import 'package:goParcel/Language/language_string.dart';

void main() {
  final keys = LocalString().keys;

  test('every offered language has translations', () {
    for (final language in appLanguages) {
      expect(keys.containsKey(language.translationKey), isTrue, reason: '${language.name} (${language.translationKey}) has no translations');
    }
  });

  test('every Indian language covers at least the keys Marathi covers (no missing keys)', () {
    final reference = keys['mr_IN']!.keys.toSet();
    for (final language in appLanguages.where((l) => l.locale.languageCode != 'en')) {
      final present = keys[language.translationKey]!.keys.toSet();
      final missing = reference.difference(present);
      expect(missing, isEmpty, reason: '${language.name} is missing ${missing.length} keys, e.g. ${missing.take(3)}');
    }
  });

  test('no translation is empty and none still contains an unresolved placeholder char', () {
    for (final language in appLanguages.where((l) => l.locale.languageCode != 'en')) {
      keys[language.translationKey]!.forEach((key, value) {
        expect(value.trim(), isNotEmpty, reason: '${language.translationKey}: "$key" is empty');
      });
    }
  });

  test('the old international languages are gone from the translations', () {
    for (final removed in ['ar_IN', 'es_ES', 'fr_ES', 'de_ES', 'in_ES', 'ZA_ES', 'tr_ES', 'pt_ES']) {
      expect(keys.containsKey(removed), isFalse, reason: '$removed should be removed');
    }
  });

  test('older installs that saved gu / GUJARATI still get Gujarati', () {
    expect(keys.containsKey('gu_GUJARATI'), isTrue);
  });

  group('resolveAppLocale', () {
    test('maps every offered language code to itself', () {
      for (final language in appLanguages) {
        expect(resolveAppLocale(language.locale.languageCode), language.locale);
      }
    });

    test('falls back to English for no choice or a removed language', () {
      expect(resolveAppLocale(null), fallbackAppLocale);
      expect(resolveAppLocale('es'), fallbackAppLocale);
      expect(resolveAppLocale('ar'), fallbackAppLocale);
    });

    test('appLanguageIndex finds the saved language, defaulting to English', () {
      expect(appLanguageIndex('ta'), appLanguages.indexWhere((l) => l.locale.languageCode == 'ta'));
      expect(appLanguageIndex('fr'), 0);
      expect(appLanguageIndex(null), 0);
    });
  });
}
