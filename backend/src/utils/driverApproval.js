const prisma = require("../config/db");
const { assignDefaultDeliveryTypes } = require("./assignDefaultDeliveryTypes");

// Auto-approval gate for the automatic/eKYC driver registration flow
// (reg_user.php port). Approval now requires the one-time verification
// payment to be settled (tbl_rider.payment_complete) in addition to all
// mandatory documents being verified - previously a driver whose docs were
// verified could reach "approved" without ever paying, since payment success
// was never reported back to the server. Shared by registration, the
// verification-payment endpoints and the admin manual override so all three
// agree on when a driver actually counts as approved.
async function evaluateDriverApproval(riderId) {
  const [rider, doc] = await Promise.all([
    prisma.tbl_rider.findUnique({ where: { id: riderId } }),
    prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } }),
  ]);
  if (!rider) return { isAllVerified: false, docsVerified: false, paymentComplete: false };

  const isBicycle = doc?.is_bycle === 1;
  const aadharApproved = doc?.aadhar_status === 1;
  const panApproved = doc?.pan_status === 1;
  const residenceApproved = doc?.residence_status === 1;
  const licApproved = doc?.lic_status === 1;
  const docsVerified = isBicycle
    ? residenceApproved && (aadharApproved || panApproved)
    : aadharApproved && panApproved && residenceApproved && licApproved;

  const paymentComplete = Number(rider.payment_complete) === 1;
  const isAllVerified = docsVerified && paymentComplete;

  if (isAllVerified && rider.verification_status !== "approved") {
    if (doc) await prisma.tbl_personal_doc.update({ where: { id: doc.id }, data: { status: 1 } });
    await prisma.tbl_rider.update({
      where: { id: riderId },
      data: { verification_status: "approved", all_verify: 1, a_status: 1, status: 1 },
    });
    await assignDefaultDeliveryTypes(riderId);
  }

  return { isAllVerified, docsVerified, paymentComplete };
}

module.exports = { evaluateDriverApproval };
