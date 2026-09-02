package com.shifter.driver.utility;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;

import java.util.Locale;

public class LocaleHelper {

    public static Context onAttach(Context context) {
        SessionManager sessionManager = new SessionManager(context);
        String lang = sessionManager.getLanguage();
        if (lang == null || lang.isEmpty()) {
            lang = "en";
        }
        return setLocale(context, lang);
    }

    public static Context onAttach(Context context, String defaultLanguage) {
        SessionManager sessionManager = new SessionManager(context);
        String lang = sessionManager.getLanguage();
        if (lang == null || lang.isEmpty()) {
            lang = defaultLanguage;
        }
        return setLocale(context, lang);
    }

    public static String getLanguage(Context context) {
        SessionManager sessionManager = new SessionManager(context);
        String lang = sessionManager.getLanguage();
        return lang != null && !lang.isEmpty() ? lang : Locale.getDefault().getLanguage();
    }

    public static Context setLocale(Context context, String language) {
        // Don't persist here, let SessionManager handle it
        // This method is just for applying locale to context
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            return updateResources(context, language);
        }
        
        return updateResourcesLegacy(context, language);
    }

    @TargetApi(Build.VERSION_CODES.N)
    private static Context updateResources(Context context, String language) {
        Locale locale = new Locale(language);
        Locale.setDefault(locale);

        Configuration configuration = context.getResources().getConfiguration();
        configuration.setLocale(locale);
        configuration.setLayoutDirection(locale);

        return context.createConfigurationContext(configuration);
    }

    @SuppressWarnings("deprecation")
    private static Context updateResourcesLegacy(Context context, String language) {
        Locale locale = new Locale(language);
        Locale.setDefault(locale);

        Resources resources = context.getResources();
        Configuration configuration = resources.getConfiguration();
        configuration.locale = locale;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            configuration.setLayoutDirection(locale);
        }
        resources.updateConfiguration(configuration, resources.getDisplayMetrics());

        return context;
    }
}
