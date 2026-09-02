package com.shifter.driver.utility;

public class AppStatus {
    private static boolean isChatActivityOpen = false;

    public static boolean isChatActivityOpen() {
        return isChatActivityOpen;
    }

    public static void setChatActivityOpen(boolean isOpen) {
        isChatActivityOpen = isOpen;
    }
}