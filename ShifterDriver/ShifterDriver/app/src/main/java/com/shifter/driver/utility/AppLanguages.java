package com.shifter.driver.utility;

/**
 * Languages the driver can pick in Account > Language: English plus the major
 * national (Indian) languages, each labelled in its own script so a driver can
 * find theirs even while the app is in a language they cannot read. A string
 * missing from a language's strings.xml falls back to English (Android's normal
 * resource fallback), so no screen ever shows a raw key.
 */
public final class AppLanguages {
    private AppLanguages() {}

    public static final String[] CODES = {"en", "hi", "mr", "gu", "bn", "ta", "te", "kn", "ml", "pa"};

    public static final String[] NATIVE_NAMES = {
            "English", "हिन्दी", "मराठी", "ગુજરાતી", "বাংলা", "தமிழ்", "తెలుగు", "ಕನ್ನಡ", "മലയാളം", "ਪੰਜਾਬੀ"
    };

    /** Index of [code] in [CODES]; English (0) for null, empty or an unsupported code. */
    public static int indexOf(String code) {
        if (code != null) {
            for (int i = 0; i < CODES.length; i++) {
                if (CODES[i].equalsIgnoreCase(code)) return i;
            }
        }
        return 0;
    }
}
