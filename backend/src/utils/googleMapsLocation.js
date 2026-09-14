const logger = require("./logger");

/**
 * Verifies and geocodes a location text using Google Maps Places API (New)
 * @param {string} locationText 
 * @returns {Promise<{ isValid: boolean, formattedAddress?: string, lat?: number, lng?: number, error?: string }>}
 */
async function verifyAndGeocodeLocation(locationText) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!locationText || !locationText.trim()) {
    return { isValid: false, error: "Empty location text" };
  }

  const cleanText = locationText.trim();

  // If no API key configured, fallback to basic text validity check
  if (!apiKey) {
    logger.warn("GOOGLE_MAPS_API_KEY is not set in .env. Skipping Google Maps API verification.");
    return {
      isValid: true,
      formattedAddress: cleanText,
      lat: 22.7196, // default Indore fallback
      lng: 75.8577,
    };
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({
        textQuery: cleanText,
        languageCode: "en",
      }),
    });

    const data = await res.json();

    if (data.places && data.places.length > 0) {
      const topMatch = data.places[0];
      return {
        isValid: true,
        formattedAddress: topMatch.formattedAddress || cleanText,
        displayName: topMatch.displayName?.text || cleanText,
        lat: topMatch.location?.latitude || 22.7196,
        lng: topMatch.location?.longitude || 75.8577,
      };
    } else {
      return {
        isValid: false,
        error: `Location "${cleanText}" was not found on Google Maps.`,
      };
    }
  } catch (err) {
    logger.error(`verifyAndGeocodeLocation error for "${cleanText}":`, err.message);
    // Graceful fallback if network fails
    return {
      isValid: true,
      formattedAddress: cleanText,
      lat: 22.7196,
      lng: 75.8577,
    };
  }
}

/**
 * Reverse geocodes coordinates (lat, lng) to a formatted address
 */
async function reverseGeocodeLocation(lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      isValid: true,
      formattedAddress: `Lat: ${lat}, Lng: ${lng}`,
      lat: Number(lat),
      lng: Number(lng),
    };
  }

  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return {
        isValid: true,
        formattedAddress: data.results[0].formatted_address,
        lat: Number(lat),
        lng: Number(lng),
      };
    }
  } catch (err) {
    logger.error(`reverseGeocodeLocation error for ${lat},${lng}:`, err.message);
  }

  return {
    isValid: true,
    formattedAddress: `Location Pin (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})`,
    lat: Number(lat),
    lng: Number(lng),
  };
}

module.exports = {
  verifyAndGeocodeLocation,
  reverseGeocodeLocation,
};
