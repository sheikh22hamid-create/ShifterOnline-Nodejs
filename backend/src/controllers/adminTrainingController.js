const prisma = require("../config/db");
const logger = require("../utils/logger");

async function getConfig(req, res) {
  try {
    const rows = await prisma.app_settings.findMany({
      where: {
        setting_key: { in: ["training_video_url", "training_video_title"] },
      },
    });
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const videoUrl = map.training_video_url?.trim() || "";
    const videoTitle = map.training_video_title?.trim() || "Driver Onboarding & Training";

    return res.status(200).json({
      success: true,
      data: {
        video_url: videoUrl,
        video_title: videoTitle,
        is_active: Boolean(videoUrl),
      },
    });
  } catch (err) {
    logger.error("adminTraining.getConfig error:", err);
    return res.status(500).json({ success: false, message: "Failed to load training video config" });
  }
}

async function updateConfig(req, res) {
  try {
    const { video_url, video_title } = req.body;
    const updates = [];

    if (video_url !== undefined) {
      updates.push(
        prisma.app_settings.upsert({
          where: { setting_key: "training_video_url" },
          create: { setting_key: "training_video_url", setting_value: String(video_url || "").trim(), updated_at: new Date() },
          update: { setting_value: String(video_url || "").trim(), updated_at: new Date() },
        })
      );
    }

    if (video_title !== undefined) {
      updates.push(
        prisma.app_settings.upsert({
          where: { setting_key: "training_video_title" },
          create: { setting_key: "training_video_title", setting_value: String(video_title || "").trim(), updated_at: new Date() },
          update: { setting_value: String(video_title || "").trim(), updated_at: new Date() },
        })
      );
    }

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }

    return res.status(200).json({
      success: true,
      message: "Training video configuration updated successfully",
    });
  } catch (err) {
    logger.error("adminTraining.updateConfig error:", err);
    return res.status(500).json({ success: false, message: "Failed to update training video config" });
  }
}

async function listProgress(req, res) {
  try {
    const statusFilter = req.query.status; // 'completed', 'in_progress', 'not_started'
    const search = req.query.search?.trim();

    // Query all drivers
    const riders = await prisma.tbl_rider.findMany({
      select: {
        id: true,
        title: true,
        fmobile: true,
        email: true,
        status: true,
        a_status: true,
        city_name: true,
        vehicle: true,
        rdate: true,
      },
      orderBy: { id: "desc" },
    });

    // Query all training progress rows
    const progressRows = await prisma.driver_training_progress.findMany();
    const progressMap = new Map(progressRows.map((p) => [p.rider_id, p]));

    let list = riders.map((r) => {
      const p = progressMap.get(r.id);
      let status = "not_started";
      let watchProgress = 0;
      let completedAt = null;
      let updatedAt = null;

      if (p) {
        watchProgress = p.watch_progress || 0;
        completedAt = p.completed_at;
        updatedAt = p.updated_at;
        if (p.is_completed) {
          status = "completed";
          watchProgress = 100;
        } else if (p.watch_progress > 0) {
          status = "in_progress";
        }
      }

      return {
        rider_id: r.id,
        driver_name: r.title || `Driver #${r.id}`,
        mobile: r.fmobile,
        email: r.email,
        city: r.city_name,
        vehicle: r.vehicle,
        driver_status: r.status,
        online_status: r.a_status,
        joined_at: r.rdate,
        training_status: status,
        watch_progress: watchProgress,
        current_position_seconds: p?.current_position_seconds || 0,
        total_duration_seconds: p?.total_duration_seconds || 0,
        completed_at: completedAt,
        updated_at: updatedAt,
      };
    });

    if (statusFilter && statusFilter !== "all") {
      list = list.filter((item) => item.training_status === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (item) =>
          item.driver_name.toLowerCase().includes(q) ||
          (item.mobile && item.mobile.includes(q)) ||
          (item.city && item.city.toLowerCase().includes(q)) ||
          String(item.rider_id).includes(q)
      );
    }

    return res.status(200).json({
      success: true,
      total: list.length,
      data: list,
    });
  } catch (err) {
    logger.error("adminTraining.listProgress error:", err);
    return res.status(500).json({ success: false, message: "Failed to list driver training progress" });
  }
}

async function resetProgress(req, res) {
  try {
    const rawRiderId = req.params.riderId;
    const riderId = parseInt(rawRiderId, 10);

    if (!rawRiderId || isNaN(riderId) || riderId <= 0) {
      return res.status(400).json({ success: false, message: "Invalid riderId" });
    }

    await prisma.driver_training_progress.deleteMany({
      where: { rider_id: riderId },
    });

    return res.status(200).json({
      success: true,
      message: `Training progress for Driver #${riderId} has been reset successfully`,
    });
  } catch (err) {
    logger.error("adminTraining.resetProgress error:", err);
    return res.status(500).json({ success: false, message: "Failed to reset driver training progress" });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  listProgress,
  resetProgress,
};
