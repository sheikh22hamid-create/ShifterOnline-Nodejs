package com.shifter.driver.model;

public class ContactItem {
    private String name;
    private String phone;
    private String rawPhone;
    private boolean selected;

    public ContactItem() {
    }

    public ContactItem(String name, String phone, String rawPhone) {
        this.name = name != null ? name.trim() : "";
        this.phone = phone != null ? phone.trim() : "";
        this.rawPhone = rawPhone != null ? rawPhone.trim() : "";
        this.selected = false;
    }

    public String getName() {
        return name != null ? name : "";
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPhone() {
        return phone != null ? phone : "";
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getRawPhone() {
        return rawPhone != null && !rawPhone.isEmpty() ? rawPhone : phone;
    }

    public void setRawPhone(String rawPhone) {
        this.rawPhone = rawPhone;
    }

    public boolean isSelected() {
        return selected;
    }

    public void setSelected(boolean selected) {
        this.selected = selected;
    }
}
