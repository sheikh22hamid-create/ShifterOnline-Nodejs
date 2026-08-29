const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");

router.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query || query.length < 2) {
      return res.status(200).json({ Result: true, suggestions: [] });
    }

    // 1. Try Photon Geocoding API first (fast & reliable)
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`;
      const photonRes = await fetch(photonUrl, {
        headers: { "User-Agent": "ShifterOnline-App/1.0" },
      });
      if (photonRes.ok) {
        const data = await photonRes.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          const suggestions = data.features.map((f) => {
            const p = f.properties || {};
            const parts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);
            const cleanDesc = [...new Set(parts)].join(", ");
            return {
              title: p.name || parts[0] || query,
              description: cleanDesc,
              lat: Number(f.geometry.coordinates[1]),
              lng: Number(f.geometry.coordinates[0]),
            };
          });
          return res.status(200).json({ Result: true, suggestions });
        }
      }
    } catch (photonErr) {
      logger.warn("Photon geocoding failed, trying Nominatim fallback:", photonErr.message);
    }

    // 2. Fallback: OpenStreetMap Nominatim
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;
      const nomRes = await fetch(nomUrl, {
        headers: { "User-Agent": "ShifterOnline-App/1.0" },
      });
      if (nomRes.ok) {
        const nomData = await nomRes.json();
        if (Array.isArray(nomData)) {
          const suggestions = nomData.map((item) => ({
            title: item.display_name.split(",")[0],
            description: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          }));
          return res.status(200).json({ Result: true, suggestions });
        }
      }
    } catch (nomErr) {
      logger.warn("Nominatim geocoding fallback failed:", nomErr.message);
    }

    return res.status(200).json({ Result: true, suggestions: [] });
  } catch (err) {
    logger.error("locationRoutes search error:", err);
    return res.status(500).json({ Result: false, msg: "Failed to search location" });
  }
});

module.exports = router;
