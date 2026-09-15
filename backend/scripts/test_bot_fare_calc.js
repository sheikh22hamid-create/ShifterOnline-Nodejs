require("dotenv").config();
const customerHandler = require("../src/whatsapp/handlers/customerHandler");
const pricingEngine = require("../src/services/pricingEngine");
const googleMapsLocation = require("../src/utils/googleMapsLocation");

async function run() {
  console.log("=== 1. TESTING GET ACTIVE CATEGORIES ===");
  const categories = await customerHandler.getActiveCategories();
  console.log("Categories found:", categories.map((c) => ({ id: c.id, name: c.cat_name })));

  if (categories.length > 0) {
    const cat = categories[0];
    console.log(`\n=== 2. TESTING GET CATEGORY MODELS FOR ${cat.cat_name} (ID: ${cat.id}) ===`);
    
    // Geocode test addresses
    const geoPickup = await googleMapsLocation.verifyAndGeocodeLocation("Connaught Place Delhi");
    const geoDrop = await googleMapsLocation.verifyAndGeocodeLocation("Noida Sector 62");

    console.log("Pickup Geo:", geoPickup.formattedAddress, geoPickup.lat, geoPickup.lng);
    console.log("Drop Geo:", geoDrop.formattedAddress, geoDrop.lat, geoDrop.lng);

    const bookingData = {
      pickupAddress: geoPickup.formattedAddress,
      dropAddress: geoDrop.formattedAddress,
      pickupLat: geoPickup.lat,
      pickupLng: geoPickup.lng,
      dropLat: geoDrop.lat,
      dropLng: geoDrop.lng,
      searchRadius: 5,
    };

    const modelResult = await customerHandler.getCategoryModels(cat.id, bookingData);
    console.log(`Distance: ${modelResult.distanceKm} km`);
    console.log("Models retrieved from pricingEngine:");
    modelResult.models.forEach((m) => {
      console.log(`  * ID ${m.package_id}: title="${m.title}", user_title="${m.user_title}", estimated_fare=₹${m.estimated_fare}, radius_charge=₹${m.radius_charge}`);
    });

    console.log("\n=== 3. FORMATTED MODELS PROMPT FOR WHATSAPP ===");
    const prompt = customerHandler.formatModelsPrompt(cat.cat_name, modelResult.models, modelResult.distanceKm);
    console.log(prompt);

    console.log("\n=== 4. FARE ESTIMATE RESULT FOR SELECTED MODEL ===");
    const selectedModel = modelResult.models[0];
    const finalResult = await customerHandler.getFareEstimateResult({
      ...bookingData,
      vehicleCategory: cat.cat_name,
      selectedModel,
    });
    console.log(finalResult);
  }
}

run().catch(console.error);
