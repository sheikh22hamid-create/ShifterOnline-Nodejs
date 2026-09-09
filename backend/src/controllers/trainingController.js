const prisma = require("../config/db");
const logger = require("../utils/logger");

const TRAINING_VIDEO_ID = "training_v1";
let tableEnsured = false;

async function ensureTrainingTable() {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS driver_training_progress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rider_id INT NOT NULL UNIQUE,
        video_url TEXT NOT NULL,
        current_position_seconds INT NOT NULL DEFAULT 0,
        total_duration_seconds INT NOT NULL DEFAULT 0,
        watch_progress FLOAT NOT NULL DEFAULT 0,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at DATETIME NULL,
        last_reminded_at DATETIME NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    tableEnsured = true;
  } catch (err) {
    logger.warn("ensureTrainingTable warning:", err.message);
  }
}

async function getTrainingConfig() {
  const rows = await prisma.app_settings.findMany({
    where: {
      setting_key: {
        in: ["training_video_url", "training_video_title"],
      },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  return {
    videoUrl: map.training_video_url?.trim() || "",
    videoTitle: map.training_video_title?.trim() || "Driver Onboarding & Training",
  };
}

async function getStatus(req, res) {
  try {
    await ensureTrainingTable();
    const rawRiderId = req.body?.rider_id;
    const riderId = parseInt(rawRiderId, 10);

    if (!rawRiderId || isNaN(riderId) || riderId <= 0) {
      return res.status(400).json({
        Result: "false",
        ResponseMsg: "Valid rider_id is required",
        training_required: 0,
        training_status: "NOT_STARTED",
      });
    }

    const { videoUrl, videoTitle } = await getTrainingConfig();

    // If no video URL is configured, training gate is disabled.
    if (!videoUrl) {
      return res.status(200).json({
        Result: "true",
        ResponseMsg: "Training not required",
        training_required: 0,
        training_status: "NOT_STARTED",
        video_id: TRAINING_VIDEO_ID,
        video_title: videoTitle,
        video_url: "",
        watch_progress: 0,
        current_position_seconds: 0,
        total_duration_seconds: 0,
        completed_at: null,
      });
    }

    // Look up driver's training progress row
    let progress = null;
    try {
      progress = await prisma.driver_training_progress.findUnique({
        where: { rider_id: riderId },
      });
    } catch (e) {
      logger.warn("driver_training_progress findUnique warning:", e.message);
    }

    if (progress && progress.is_completed) {
      return res.status(200).json({
        Result: "true",
        ResponseMsg: "Training completed",
        training_required: 1,
        training_status: "COMPLETED",
        video_id: TRAINING_VIDEO_ID,
        video_title: videoTitle,
        video_url: videoUrl,
        watch_progress: progress.watch_progress || 100,
        current_position_seconds: progress.current_position_seconds || 0,
        total_duration_seconds: progress.total_duration_seconds || 0,
        completed_at: progress.completed_at ? progress.completed_at.toISOString() : null,
      });
    }

    if (progress && progress.watch_progress > 0) {
      return res.status(200).json({
        Result: "true",
        ResponseMsg: "Training in progress",
        training_required: 1,
        training_status: "IN_PROGRESS",
        video_id: TRAINING_VIDEO_ID,
        video_title: videoTitle,
        video_url: videoUrl,
        watch_progress: progress.watch_progress,
        current_position_seconds: progress.current_position_seconds,
        total_duration_seconds: progress.total_duration_seconds,
        completed_at: null,
      });
    }

    return res.status(200).json({
      Result: "true",
      ResponseMsg: "Training required",
      training_required: 1,
      training_status: "NOT_STARTED",
      video_id: TRAINING_VIDEO_ID,
      video_title: videoTitle,
      video_url: videoUrl,
      watch_progress: 0,
      current_position_seconds: 0,
      total_duration_seconds: 0,
      completed_at: null,
    });
  } catch (err) {
    logger.error("training.getStatus error:", err);
    return res.status(500).json({
      Result: "false",
      ResponseMsg: "Internal server error",
      training_required: 0,
      training_status: "NOT_STARTED",
    });
  }
}

async function saveProgress(req, res) {
  try {
    await ensureTrainingTable();
    const rawRiderId = req.body?.rider_id;
    const riderId = parseInt(rawRiderId, 10);
    const videoUrl = req.body?.video_url || "";
    const watchProgress = parseFloat(req.body?.watch_progress) || 0;
    const currentPosition = parseInt(req.body?.current_position_seconds, 10) || 0;
    const totalDuration = parseInt(req.body?.total_duration_seconds, 10) || 0;

    if (!rawRiderId || isNaN(riderId) || riderId <= 0) {
      return res.status(400).json({
        Result: "false",
        ResponseMsg: "Valid rider_id is required",
      });
    }

    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: watchProgress,
        current_position_seconds: currentPosition,
        total_duration_seconds: totalDuration,
        is_completed: false,
        updated_at: new Date(),
      },
      update: {
        video_url: videoUrl || undefined,
        watch_progress: watchProgress,
        current_position_seconds: currentPosition,
        total_duration_seconds: totalDuration,
        updated_at: new Date(),
      },
    });

    return res.status(200).json({
      Result: "true",
      ResponseMsg: "Progress saved",
    });
  } catch (err) {
    logger.error("training.saveProgress error:", err);
    return res.status(500).json({
      Result: "false",
      ResponseMsg: "Internal server error",
    });
  }
}

async function complete(req, res) {
  try {
    await ensureTrainingTable();
    const rawRiderId = req.body?.rider_id;
    const riderId = parseInt(rawRiderId, 10);
    const videoUrl = req.body?.video_url || "";

    if (!rawRiderId || isNaN(riderId) || riderId <= 0) {
      return res.status(400).json({
        Result: "false",
        ResponseMsg: "Valid rider_id is required",
      });
    }

    const now = new Date();
    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: 100,
        is_completed: true,
        completed_at: now,
        updated_at: now,
      },
      update: {
        watch_progress: 100,
        is_completed: true,
        completed_at: now,
        updated_at: now,
      },
    });

    return res.status(200).json({
      Result: "true",
      ResponseMsg: "Training completed successfully",
    });
  } catch (err) {
    logger.error("training.complete error:", err);
    return res.status(500).json({
      Result: "false",
      ResponseMsg: "Internal server error",
    });
  }
}

module.exports = {
  getStatus,
  saveProgress,
  complete,
  TRAINING_VIDEO_ID,
};
