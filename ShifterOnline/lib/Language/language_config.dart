import 'dart:ui';

/// Languages offered in the customer app: English plus the major national
/// (Indian) languages, each shown by its own name. Translations live in
/// language_indian.dart (keyed by languageCode_countryCode).
class AppLanguage {
  final String name;
  final Locale locale;
  const AppLanguage(this.name, this.locale);

  String get translationKey => '${locale.languageCode}_${locale.countryCode}';
}

const List<AppLanguage> appLanguages = [
  AppLanguage('English', Locale('en', 'US')),
  AppLanguage('हिंदी', Locale('hi', 'IN')),
  AppLanguage('मराठी', Locale('mr', 'IN')),
  AppLanguage('ગુજરાતી', Locale('gu', 'IN')),
  AppLanguage('বাংলা', Locale('bn', 'IN')),
  AppLanguage('தமிழ்', Locale('ta', 'IN')),
  AppLanguage('తెలుగు', Locale('te', 'IN')),
  AppLanguage('ಕನ್ನಡ', Locale('kn', 'IN')),
  AppLanguage('മലയാളം', Locale('ml', 'IN')),
  AppLanguage('ਪੰਜਾਬੀ', Locale('pa', 'IN')),
];

const Locale fallbackAppLocale = Locale('en', 'US');

/// The locale for a saved language code. Anything not offered any more (the
/// old international languages, or no saved choice) resolves to English
/// instead of an untranslated screen.
Locale resolveAppLocale(String? languageCode) {
  for (final language in appLanguages) {
    if (language.locale.languageCode == languageCode) return language.locale;
  }
  return fallbackAppLocale;
}

/// Index in [appLanguages] of the saved language (0 = English).
int appLanguageIndex(String? languageCode) {
  final index = appLanguages.indexWhere((l) => l.locale.languageCode == languageCode);
  return index < 0 ? 0 : index;
}
