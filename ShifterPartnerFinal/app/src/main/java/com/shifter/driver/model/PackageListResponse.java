package com.shifter.driver.model;

import java.util.List;

public class PackageListResponse {
    private List<PackageData> PackageData;
    private String ResponseCode;
    private String Result;
    private String ResponseMsg;

    public List<PackageData> getPackageData() { return PackageData; }
    public void setPackageData(List<PackageData> packageData) { PackageData = packageData; }

    public String getResponseCode() { return ResponseCode; }
    public void setResponseCode(String responseCode) { ResponseCode = responseCode; }

    public String getResult() { return Result; }
    public void setResult(String result) { Result = result; }

    public String getResponseMsg() { return ResponseMsg; }
    public void setResponseMsg(String responseMsg) { ResponseMsg = responseMsg; }
}