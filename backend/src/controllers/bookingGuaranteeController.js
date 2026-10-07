const logger = require("../utils/logger");
const bookingGuarantee = require("../services/bookingGuaranteeService");

/** POST /api/order/guarantee-quote — display-only "if no driver is found you get ₹X" for the toggled models. */
async function quote(req, res) {
  try {
    const ids = req.body?.package_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must be a non-empty array" });
    }
    if (ids.length > 20) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "package_ids must have at most 20 entries" });
    }
    const q = await bookingGuarantee.quote(ids);
    return res.json({ ResponseCode: "200", Result: "true", amount: q.amount, package_id: q.packageId });
  } catch (err) {
    logger.error("bookingGuarantee.quote failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { quote };
