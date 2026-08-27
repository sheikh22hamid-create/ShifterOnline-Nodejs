const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// ---------------------------------------------------------------------------
// Cities (tbl_city)
// ---------------------------------------------------------------------------

async function listCities(req, res) {
  try {
    const rows = await prisma.tbl_city.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "listCities");
  }
}

async function createCity(req, res) {
  try {
    const { title, lat, lng, status } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: "title is required" });
    }
    const created = await prisma.tbl_city.create({
      data: { title, lat: lat ?? null, lng: lng ?? null, status: status === undefined ? 1 : Number(status) },
    });
    return res.status(201).json({ success: true, message: "City created", data: created });
  } catch (err) {
    return internalError(res, err, "createCity");
  }
}

async function updateCity(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_city.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "City not found" });
    }
    const { title, lat, lng, status } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (lat !== undefined) data.lat = lat;
    if (lng !== undefined) data.lng = lng;
    if (status !== undefined) data.status = Number(status);

    const updated = await prisma.tbl_city.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "City updated", data: updated });
  } catch (err) {
    return internalError(res, err, "updateCity");
  }
}

async function deleteCity(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_city.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "City not found" });
    }

    // No DB-level FK constraints exist on these city_id columns (legacy
    // schema), so a hard delete would silently orphan real records instead
    // of failing loudly. Block it and point at deactivation instead.
    const [adminCount, riderCount, orderCount, userCount] = await Promise.all([
      prisma.admin.count({ where: { city_id: id } }),
      prisma.tbl_rider.count({ where: { city_id: id } }),
      prisma.pkg_order.count({ where: { city_id: id } }),
      prisma.tbl_user.count({ where: { city_id: id } }),
    ]);
    if (adminCount || riderCount || orderCount || userCount) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a city with existing staff, drivers, orders, or customers — deactivate it instead (PUT status: 0).",
      });
    }

    await prisma.tbl_city.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "City deleted" });
  } catch (err) {
    return internalError(res, err, "deleteCity");
  }
}

// ---------------------------------------------------------------------------
// Vehicle types (tbl_vechicle)
// ---------------------------------------------------------------------------

async function listVehicles(req, res) {
  try {
    const rows = await prisma.tbl_vechicle.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "listVehicles");
  }
}

async function createVehicle(req, res) {
  try {
    const { title, v_rquired, status } = req.body;
    if (!title || v_rquired === undefined) {
      return res.status(400).json({ success: false, message: "title and v_rquired are required" });
    }
    const created = await prisma.tbl_vechicle.create({
      data: { title, v_rquired: String(v_rquired), status: status === undefined ? 1 : Number(status) },
    });
    return res.status(201).json({ success: true, message: "Vehicle type created", data: created });
  } catch (err) {
    return internalError(res, err, "createVehicle");
  }
}

async function updateVehicle(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_vechicle.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Vehicle type not found" });
    }
    const { title, v_rquired, status } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (v_rquired !== undefined) data.v_rquired = String(v_rquired);
    if (status !== undefined) data.status = Number(status);

    const updated = await prisma.tbl_vechicle.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Vehicle type updated", data: updated });
  } catch (err) {
    return internalError(res, err, "updateVehicle");
  }
}

async function deleteVehicle(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_vechicle.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Vehicle type not found" });
    }
    await prisma.tbl_vechicle.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Vehicle type deleted" });
  } catch (err) {
    return internalError(res, err, "deleteVehicle");
  }
}

// ---------------------------------------------------------------------------
// Package categories (pkg_category)
// ---------------------------------------------------------------------------

async function listCategories(req, res) {
  try {
    const rows = await prisma.pkg_category.findMany({ orderBy: [{ sort_order: "asc" }, { id: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "listCategories");
  }
}

async function createCategory(req, res) {
  try {
    const { cat_name, cat_img, cat_status, city_id, sort_order, other_image } = req.body;
    if (!cat_name || !cat_img) {
      return res.status(400).json({ success: false, message: "cat_name and cat_img are required" });
    }
    const created = await prisma.pkg_category.create({
      data: {
        cat_name,
        cat_img,
        other_image: other_image ?? null,
        cat_status: cat_status === undefined ? 1 : Number(cat_status),
        city_id: city_id ? parseInt(city_id, 10) : null,
        sort_order: sort_order !== undefined ? parseInt(sort_order, 10) : 0,
      },
    });
    return res.status(201).json({ success: true, message: "Category created", data: created });
  } catch (err) {
    return internalError(res, err, "createCategory");
  }
}

async function updateCategory(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.pkg_category.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    const { cat_name, cat_img, cat_status, city_id, sort_order, other_image } = req.body;
    const data = {};
    if (cat_name !== undefined) data.cat_name = cat_name;
    if (cat_img !== undefined) data.cat_img = cat_img;
    if (other_image !== undefined) data.other_image = other_image;
    if (cat_status !== undefined) data.cat_status = Number(cat_status);
    if (city_id !== undefined) data.city_id = city_id ? parseInt(city_id, 10) : null;
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order, 10);

    const updated = await prisma.pkg_category.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Category updated", data: updated });
  } catch (err) {
    return internalError(res, err, "updateCategory");
  }
}

async function deleteCategory(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.pkg_category.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const packageCount = await prisma.tbl_package.count({ where: { cat_id: id } });
    if (packageCount) {
      return res.status(409).json({
        success: false,
        message: "Cannot delete a category with existing rate cards — remove or reassign those first.",
      });
    }

    await prisma.pkg_category.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Category deleted" });
  } catch (err) {
    return internalError(res, err, "deleteCategory");
  }
}

module.exports = {
  listCities,
  createCity,
  updateCity,
  deleteCity,
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
