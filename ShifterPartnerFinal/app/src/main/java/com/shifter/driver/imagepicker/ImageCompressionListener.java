package com.shifter.driver.imagepicker;

public interface ImageCompressionListener {
    void onStart();
    void onCompressed(String filePath);
    void onError(String errorMessage);
}
