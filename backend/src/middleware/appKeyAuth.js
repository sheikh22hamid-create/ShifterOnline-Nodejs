// Node port of the `Authorization: genie_rest_key` header check the PHP
// rider_api used on several endpoints (address/license/residence document
// upload, bank_account, vehicle_detail_save, tbl_vehicle_list,
// rider_dynamic_question, dy_answer, survey_list, survery_answer). This is
// a single static app-level key shipped inside the driver app binary, not a
// per-user secret — same trust model as the legacy PHP, just moved to env
// so it isn't hardcoded in two places.
const APP_REST_KEY = process.env.APP_REST_KEY || "genie_rest_key";

module.exports = function appKeyAuth(req, res, next) {
  if (req.headers.authorization !== APP_REST_KEY) {
    return res.status(403).json({ ResponseCode: "403", Result: "false", ResponseMsg: "Unauthorized Access!" });
  }
  next();
};
