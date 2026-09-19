const prisma = require("../config/db");

// Assigns every active package under this rider's vehicle's category as a
// default enabled delivery type. Ported from
// admin/include/Common.php::assignDefaultDeliveryTypes(). Shared by
// riderAuthController.registerHandler (auto-approval at registration) and
// driverDocumentVerificationController (auto-approval when all mandatory
// documents get verified after the fact) - both run the exact same
// "all documents verified -> approve + assign delivery types" sequence.
async function assignDefaultDeliveryTypes(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { vehicle: true } });
  if (!rider?.vehicle) return;

  const cat = await prisma.pkg_category.findFirst({ where: { cat_name: rider.vehicle, cat_status: 1 } });
  if (!cat) return;

  const packages = await prisma.tbl_package.findMany({ where: { cat_id: cat.id, status: 1 } });
  for (const pkg of packages) {
    const exists = await prisma.tbl_rider_delivery_type.findFirst({
      where: { rider_id: riderId, delivery_type: String(pkg.id) },
    });
    if (!exists) {
      await prisma.tbl_rider_delivery_type.create({ data: { rider_id: riderId, delivery_type: String(pkg.id), status: 1 } });
    }
  }
}

module.exports = { assignDefaultDeliveryTypes };
