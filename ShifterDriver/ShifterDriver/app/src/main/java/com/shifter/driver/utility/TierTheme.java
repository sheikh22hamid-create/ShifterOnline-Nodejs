package com.shifter.driver.utility;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

import com.shifter.driver.R;
import com.shifter.driver.model.RiderData;

import java.util.List;
import java.util.Locale;

/**
 * Encapsulates the visual design theme and tier-specific messaging
 * for the Driver Order Request popup.
 */
public class TierTheme {

    public enum Type {
        STANDARD,
        SILVER,
        PRIME,
        GOLD_BEAST,
        EARNING_BEAST
    }

    public final Type type;
    public final String tierName;
    public final String headerSubtitle;
    public final String highlightMessage;
    public final int headerBgColor;
    public final int headerIconRes;
    public final int highlightBgColor;
    public final int highlightBorderColor;
    public final int highlightTextColor;
    public final int highlightIconRes;
    public final int acceptBtnColor;

    public TierTheme(Type type, String tierName, String headerSubtitle, String highlightMessage,
                     int headerBgColor, int headerIconRes,
                     int highlightBgColor, int highlightBorderColor, int highlightTextColor, int highlightIconRes,
                     int acceptBtnColor) {
        this.type = type;
        this.tierName = tierName;
        this.headerSubtitle = headerSubtitle;
        this.highlightMessage = highlightMessage;
        this.headerBgColor = headerBgColor;
        this.headerIconRes = headerIconRes;
        this.highlightBgColor = highlightBgColor;
        this.highlightBorderColor = highlightBorderColor;
        this.highlightTextColor = highlightTextColor;
        this.highlightIconRes = highlightIconRes;
        this.acceptBtnColor = acceptBtnColor;
    }

    public static final TierTheme STANDARD = new TierTheme(
            Type.STANDARD,
            "Standard Tier",
            "New Order Request",
            "Standard delivery • Earn steadily",
            Color.parseColor("#2563EB"),
            R.drawable.ic_tier_standard_box,
            Color.parseColor("#EFF6FF"),
            Color.parseColor("#BFDBFE"),
            Color.parseColor("#1D4ED8"),
            R.drawable.ic_info_circle,
            Color.parseColor("#2563EB")
    );

    public static final TierTheme SILVER = new TierTheme(
            Type.SILVER,
            "Silver Tier",
            "New Order Request",
            "Priority over Standard • Higher earnings",
            Color.parseColor("#334155"),
            R.drawable.ic_tier_silver_medal,
            Color.parseColor("#F1F5F9"),
            Color.parseColor("#CBD5E1"),
            Color.parseColor("#334155"),
            R.drawable.ic_medal_small,
            Color.parseColor("#334155")
    );

    public static final TierTheme PRIME = new TierTheme(
            Type.PRIME,
            "Prime Tier",
            "New Order Request",
            "High-value order • Premium earnings",
            Color.parseColor("#7C3AED"),
            R.drawable.ic_tier_prime_crown,
            Color.parseColor("#F5F3FF"),
            Color.parseColor("#DDD6FE"),
            Color.parseColor("#6D28D9"),
            R.drawable.ic_zap_bolt,
            Color.parseColor("#7C3AED")
    );

    public static final TierTheme GOLD_BEAST = new TierTheme(
            Type.GOLD_BEAST,
            "Gold Beast",
            "New Order Request",
            "Top priority order • Maximum earnings",
            Color.parseColor("#D97706"),
            R.drawable.ic_tier_gold_star,
            Color.parseColor("#FFFBEB"),
            Color.parseColor("#FDE68A"),
            Color.parseColor("#B45309"),
            R.drawable.ic_trophy_small,
            Color.parseColor("#D97706")
    );

    public static final TierTheme EARNING_BEAST = new TierTheme(
            Type.EARNING_BEAST,
            "Earning Beast",
            "New Order Request",
            "More orders • Higher incentives • Earn more",
            Color.parseColor("#059669"),
            R.drawable.ic_tier_earning_chart,
            Color.parseColor("#ECFDF5"),
            Color.parseColor("#A7F3D0"),
            Color.parseColor("#047857"),
            R.drawable.ic_chart_small,
            Color.parseColor("#059669")
    );

    /**
     * Resolves the corresponding visual theme based on package_id, model_name, or title.
     */
    public static TierTheme resolve(String packageId, String modelName, String packageTitle) {
        String combined = ((packageId != null ? packageId : "") + " "
                + (modelName != null ? modelName : "") + " "
                + (packageTitle != null ? packageTitle : "")).toLowerCase().trim();

        if (combined.contains("earning") || combined.contains("model 5") || combined.contains("priority") || "34".equals(packageId)) {
            return EARNING_BEAST;
        }
        if (combined.contains("gold") || combined.contains("model 4") || combined.contains("express") || "33".equals(packageId)) {
            return GOLD_BEAST;
        }
        if (combined.contains("prime") || combined.contains("model 3") || combined.contains("comfort") || "21".equals(packageId)) {
            return PRIME;
        }
        if (combined.contains("silver") || combined.contains("model 2") || combined.contains("saver plus") || "7".equals(packageId)) {
            return SILVER;
        }
        return STANDARD;
    }

    public static TierTheme applyThemeToView(
            View view,
            Context context,
            String orderId,
            String packageId,
            String modelName,
            String packageTitle,
            String pickupAddress,
            String deliveryAddress,
            String distanceKm,
            String category,
            String customerName,
            Location driverLocation) {
        return applyThemeToView(view, context, orderId, packageId, modelName, packageTitle,
                pickupAddress, deliveryAddress, null, null, distanceKm, category, customerName, "5.0", "0", "0", driverLocation);
    }

    public static TierTheme applyThemeToView(
            View view,
            Context context,
            String orderId,
            String packageId,
            String modelName,
            String packageTitle,
            String pickupAddress,
            String deliveryAddress,
            String distanceKm,
            String category,
            String customerName,
            String estimatedEarning,
            Location driverLocation) {
        return applyThemeToView(view, context, orderId, packageId, modelName, packageTitle,
                pickupAddress, deliveryAddress, null, null, distanceKm, category, customerName, "5.0", "0", estimatedEarning, driverLocation);
    }

    /**
     * Applies the complete visual design theme, fare amount, and order info to the order request view.
     */
    public static TierTheme applyThemeToView(
            View view,
            Context context,
            String orderId,
            String packageId,
            String modelName,
            String packageTitle,
            String pickupAddress,
            String deliveryAddress,
            Double pickupLat,
            Double pickupLng,
            String distanceKm,
            String category,
            String customerName,
            String estimatedEarning,
            Location driverLocation) {
        return applyThemeToView(view, context, orderId, packageId, modelName, packageTitle,
                pickupAddress, deliveryAddress, pickupLat, pickupLng, distanceKm, category, customerName, "5.0", "0", estimatedEarning, driverLocation);
    }

    /**
     * Applies the complete visual design theme, fare amount, customer stats, and order info to the order request view.
     */
    public static TierTheme applyThemeToView(
            View view,
            Context context,
            String orderId,
            String packageId,
            String modelName,
            String packageTitle,
            String pickupAddress,
            String deliveryAddress,
            Double pickupLat,
            Double pickupLng,
            String distanceKm,
            String category,
            String customerName,
            String customerRating,
            String customerOrders,
            String estimatedEarning,
            Location driverLocation) {

        TierTheme theme = resolve(packageId, modelName, packageTitle);

        // 1. Header Container
        View headerContainer = view.findViewById(R.id.header_container);
        if (headerContainer != null) {
            GradientDrawable headerBg = new GradientDrawable();
            float radius = dpToPx(context, 18);
            headerBg.setCornerRadii(new float[]{radius, radius, radius, radius, 0, 0, 0, 0});
            headerBg.setColor(theme.headerBgColor);
            headerContainer.setBackground(headerBg);
        }

        // 2. Header Icon & Titles
        ImageView imgTierIcon = view.findViewById(R.id.img_tier_icon);
        if (imgTierIcon != null) {
            imgTierIcon.setImageResource(theme.headerIconRes);
        }

        TextView txtTierName = view.findViewById(R.id.txt_tier_name);
        if (txtTierName != null) {
            txtTierName.setText(theme.tierName);
        }

        TextView txtHeaderSubtitle = view.findViewById(R.id.txt_header_subtitle);
        if (txtHeaderSubtitle != null) {
            String idStr = (orderId != null && !orderId.trim().isEmpty()) ? "#" + orderId.trim() : "";
            if (!idStr.isEmpty()) {
                txtHeaderSubtitle.setText(idStr + " • " + theme.headerSubtitle);
            } else {
                txtHeaderSubtitle.setText(theme.headerSubtitle);
            }
        }

        // 2b. Estimated Fare / Price Badge (e.g. ₹150)
        TextView txtPrice = view.findViewById(R.id.txt_estimated_price);
        if (txtPrice != null) {
            txtPrice.setText(formatEarning(context, estimatedEarning));
        }

        // 3. Pickup Location + (Distance from Current Location)
        TextView txtPickupTitle = view.findViewById(R.id.txt_pickup_name_title);
        TextView txtPickup = view.findViewById(R.id.txt_pickup_address);
        Double distToPickup = OrderVoiceAnnouncer.distanceToPickupKm(pickupLat, pickupLng, driverLocation);

        if (txtPickupTitle != null) {
            if (distToPickup != null && distToPickup > 0.05) {
                txtPickupTitle.setText(String.format(Locale.US, "PICKUP • (%.1f km from your location)", distToPickup));
            } else {
                txtPickupTitle.setText("PICKUP LOCATION");
            }
        }
        if (txtPickup != null) {
            txtPickup.setText(cleanAddress(pickupAddress));
        }

        // 4. Drop Location + (Distance from Pickup Location)
        TextView txtDropTitle = view.findViewById(R.id.txt_drop_name_title);
        TextView txtDrop = view.findViewById(R.id.txt_drop_address);
        String tripDist = (distanceKm != null && !distanceKm.trim().isEmpty()) ? distanceKm.trim() : "";

        if (txtDropTitle != null) {
            if (!tripDist.isEmpty()) {
                String d = tripDist.toLowerCase().contains("km") ? tripDist : tripDist + " km";
                txtDropTitle.setText("DROP • (" + d + " from pickup)");
            } else {
                txtDropTitle.setText("DROP LOCATION");
            }
        }
        if (txtDrop != null) {
            txtDrop.setText(cleanAddress(deliveryAddress));
        }

        // 5. Distance & Duration
        TextView txtDist = view.findViewById(R.id.txt_distance);
        if (txtDist != null) {
            String distText = (distanceKm != null && !distanceKm.trim().isEmpty()) ? distanceKm : "0";
            if (!distText.toLowerCase().contains("km")) distText += " km";
            txtDist.setText(distText);
        }

        TextView txtDuration = view.findViewById(R.id.txt_duration);
        if (txtDuration != null) {
            txtDuration.setText(calculateDurationText(distanceKm));
        }

        // 6. Vehicle & Fare sublabel
        TextView txtVehicle = view.findViewById(R.id.txt_vehicle);
        if (txtVehicle != null) {
            txtVehicle.setText(category != null && !category.isEmpty() ? category : "Bike");
        }

        TextView txtTierSublabel = view.findViewById(R.id.txt_tier_sublabel);
        if (txtTierSublabel != null) {
            txtTierSublabel.setText("Fare: " + formatEarning(context, estimatedEarning));
        }

        // 7. Customer Info & Rating
        TextView txtCustomerName = view.findViewById(R.id.txt_customer_name);
        if (txtCustomerName != null) {
            String name = resolveCustomerName(customerName);
            txtCustomerName.setText(name);
        }

        TextView txtDriverRating = view.findViewById(R.id.txt_driver_rating);
        if (txtDriverRating != null) {
            txtDriverRating.setText(formatCustomerRating(customerRating, customerOrders));
        }

        // 8. Highlight Card
        View highlightLayout = view.findViewById(R.id.layout_tier_highlight);
        if (highlightLayout != null) {
            GradientDrawable highlightBg = new GradientDrawable();
            highlightBg.setCornerRadius(dpToPx(context, 8));
            highlightBg.setColor(theme.highlightBgColor);
            highlightBg.setStroke(dpToPx(context, 1), theme.highlightBorderColor);
            highlightLayout.setBackground(highlightBg);
        }

        ImageView imgHighlightIcon = view.findViewById(R.id.img_highlight_icon);
        if (imgHighlightIcon != null) {
            imgHighlightIcon.setImageResource(theme.highlightIconRes);
            imgHighlightIcon.setColorFilter(theme.highlightTextColor);
        }

        TextView txtTierHighlight = view.findViewById(R.id.txt_tier_highlight);
        if (txtTierHighlight != null) {
            txtTierHighlight.setText(theme.highlightMessage);
            txtTierHighlight.setTextColor(theme.highlightTextColor);
        }

        // 9. Accept Button Theme
        Button btnAccept = view.findViewById(R.id.btn_accept);
        if (btnAccept != null) {
            GradientDrawable acceptBg = new GradientDrawable();
            acceptBg.setCornerRadius(dpToPx(context, 12));
            acceptBg.setColor(theme.acceptBtnColor);
            btnAccept.setBackground(acceptBg);
        }

        return theme;
    }

    public static int dpToPx(Context context, int dp) {
        if (context == null) return dp;
        return (int) (dp * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    public static String calculateDurationText(String distanceKm) {
        double dist = 0.0;
        if (distanceKm != null) {
            try {
                dist = Double.parseDouble(distanceKm.replaceAll("[^0-9.]", "").trim());
            } catch (Exception ignored) {}
        }
        if (dist <= 0) return "~ 15 mins";
        int mins = Math.max(5, (int) Math.round(dist * 1.5 + 3));
        return "~ " + mins + " mins";
    }

    public static String resolveCurrentLocationName(Context context, Location driverLocation, String pickupAddress) {
        if (context != null && driverLocation != null && driverLocation.getLatitude() != 0.0 && driverLocation.getLongitude() != 0.0) {
            try {
                Geocoder geocoder = new Geocoder(context, Locale.getDefault());
                List<Address> addresses = geocoder.getFromLocation(
                        driverLocation.getLatitude(), driverLocation.getLongitude(), 1);
                if (addresses != null && !addresses.isEmpty()) {
                    Address addr = addresses.get(0);
                    String locality = addr.getLocality();
                    String subLocality = addr.getSubLocality();
                    String adminArea = addr.getAdminArea();
                    if (subLocality != null && adminArea != null) {
                        return subLocality + ", " + adminArea;
                    } else if (locality != null && adminArea != null) {
                        return locality + ", " + adminArea;
                    } else if (locality != null) {
                        return locality;
                    }
                }
            } catch (Exception ignored) {}
        }
        if (pickupAddress != null && !pickupAddress.isEmpty()) {
            return pickupAddress.contains(",") ? pickupAddress.split(",")[0].trim() : pickupAddress;
        }
        return "Current Location";
    }

    public static String resolveCustomerName(String customerName) {
        if (customerName != null && !customerName.trim().isEmpty() && !"Customer".equalsIgnoreCase(customerName.trim())) {
            return customerName.trim();
        }
        return "Customer";
    }

    public static String resolveDriverOrCustomerName(Context context, String customerName) {
        return resolveCustomerName(customerName);
    }

    public static String formatCustomerRating(String ratingStr, String ordersStr) {
        double rating = 5.0;
        int orders = 0;
        try {
            if (ratingStr != null && !ratingStr.trim().isEmpty()) {
                rating = Double.parseDouble(ratingStr.replaceAll("[^0-9.]", "").trim());
            }
        } catch (Exception ignored) {}

        try {
            if (ordersStr != null && !ordersStr.trim().isEmpty()) {
                orders = Integer.parseInt(ordersStr.replaceAll("[^0-9]", "").trim());
            }
        } catch (Exception ignored) {}

        if (orders <= 0) {
            return String.format(Locale.US, "%.1f (New Customer)", rating);
        } else if (orders == 1) {
            return String.format(Locale.US, "%.1f (1 order)", rating);
        } else {
            return String.format(Locale.US, "%.1f (%d orders)", rating, orders);
        }
    }

    public static String formatEarning(Context context, String earningStr) {
        String currency = "₹";
        if (context != null) {
            try {
                com.shifter.driver.utility.SessionManager sessionManager = new com.shifter.driver.utility.SessionManager(context);
                String curr = sessionManager.getStringData(com.shifter.driver.utility.SessionManager.currency);
                if (curr != null && !curr.trim().isEmpty()) {
                    currency = curr.trim();
                }
            } catch (Exception ignored) {}
        }

        if (earningStr == null || earningStr.trim().isEmpty()) {
            return currency + "0";
        }

        try {
            String clean = earningStr.replaceAll("[^0-9.]", "").trim();
            if (clean.isEmpty()) return currency + "0";
            double val = Double.parseDouble(clean);
            if (val == (long) val) {
                return currency + String.format(Locale.US, "%d", (long) val);
            } else {
                return currency + String.format(Locale.US, "%.2f", val);
            }
        } catch (Exception e) {
            return currency + earningStr.trim();
        }
    }

    public static String cleanAddress(String addr) {
        if (addr == null || addr.trim().isEmpty()) return "Location unavailable";
        String s = addr.trim();
        while (s.startsWith(",")) {
            s = s.substring(1).trim();
        }
        return s.isEmpty() ? addr.trim() : s;
    }
}
