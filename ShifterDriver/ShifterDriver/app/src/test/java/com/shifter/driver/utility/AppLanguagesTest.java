package com.shifter.driver.utility;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class AppLanguagesTest {

    private static final Pattern STRING = Pattern.compile("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>", Pattern.DOTALL);
    private static final Pattern PLACEHOLDER = Pattern.compile("%(?:\\d+\\$)?[sdfx]");

    private static File resDir() {
        // Gradle runs unit tests with the module (app/) as the working directory.
        File dir = new File("src/main/res");
        if (!dir.isDirectory()) dir = new File("app/src/main/res");
        return dir;
    }

    private static java.util.Map<String, String> load(String folder) throws Exception {
        File file = new File(resDir(), folder + "/strings.xml");
        String xml = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        java.util.Map<String, String> out = new java.util.LinkedHashMap<>();
        Matcher m = STRING.matcher(xml);
        while (m.find()) out.put(m.group(1), m.group(2));
        return out;
    }

    private static java.util.List<String> placeholders(String text) {
        java.util.List<String> found = new java.util.ArrayList<>();
        Matcher m = PLACEHOLDER.matcher(text);
        while (m.find()) found.add(m.group());
        java.util.Collections.sort(found);
        return found;
    }

    @Test
    public void codesAndNamesLineUp() {
        assertEquals(AppLanguages.CODES.length, AppLanguages.NATIVE_NAMES.length);
        assertEquals("en", AppLanguages.CODES[0]);
    }

    @Test
    public void indexOfDefaultsToEnglish() {
        assertEquals(0, AppLanguages.indexOf(null));
        assertEquals(0, AppLanguages.indexOf(""));
        assertEquals(0, AppLanguages.indexOf("fr"));
        assertEquals(AppLanguages.indexOf("ta"), java.util.Arrays.asList(AppLanguages.CODES).indexOf("ta"));
    }

    @Test
    public void everyNonEnglishLanguageHasAStringsFile() {
        for (String code : AppLanguages.CODES) {
            if ("en".equals(code)) continue;
            assertTrue("values-" + code + "/strings.xml is missing", new File(resDir(), "values-" + code + "/strings.xml").isFile());
        }
    }

    @Test
    public void translationsOnlyUseKnownKeysAndKeepFormatPlaceholders() throws Exception {
        java.util.Map<String, String> english = load("values");
        Set<String> knownKeys = new HashSet<>(english.keySet());
        for (String code : AppLanguages.CODES) {
            if ("en".equals(code)) continue;
            java.util.Map<String, String> translated = load("values-" + code);
            for (java.util.Map.Entry<String, String> e : translated.entrySet()) {
                assertTrue(code + ": unknown string key " + e.getKey(), knownKeys.contains(e.getKey()));
                assertEquals(code + ": format placeholders differ for " + e.getKey(),
                        placeholders(english.get(e.getKey())), placeholders(e.getValue()));
                assertTrue(code + ": empty translation for " + e.getKey(), !e.getValue().trim().isEmpty());
            }
        }
    }

    @Test
    public void theMainScreensAreTranslatedInEveryLanguage() throws Exception {
        // Strings every driver sees on the home / orders / ledger screens.
        String[] mustHave = {"home", "orders", "reject", "confirm_order", "order_details", "cancel"};
        for (String code : AppLanguages.CODES) {
            if ("en".equals(code)) continue;
            java.util.Map<String, String> translated = load("values-" + code);
            for (String key : mustHave) {
                assertTrue(code + " should translate " + key, translated.containsKey(key));
            }
        }
    }
}
