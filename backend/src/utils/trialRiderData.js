/** Row data for a brand-new tbl_rider placed on the trial roster (shared by the admin trial form and the outside-driver onboarding). */
function newTrialRiderData({ fullName, mobile, vehicle, cityId, trialOrdersAllowed, vehicleNo }) {
  return {
    full_name: fullName,
    fmobile: mobile,
    vehicle,
    city_id: cityId,
    verification_type: "manual",
    verification_status: "pending",
    all_verify: 0,
    a_status: 0,
    status: 1,
    payment_complete: 0,
    password: "",
    profile_picture: "",
    fcm_token: "",
    device_id: "",
    rdate: new Date(),
    trial_status: "active",
    trial_orders_allowed: trialOrdersAllowed,
    trial_orders_completed: 0,
    ...(vehicleNo ? { vehicle_no: vehicleNo } : {}),
  };
}

module.exports = { newTrialRiderData };
