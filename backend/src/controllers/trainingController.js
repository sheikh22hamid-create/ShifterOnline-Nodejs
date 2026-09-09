const prisma = require("../config/db");
const logger = require("../utils/logger");

const TRAINING_VIDEO_ID = "training_v1";
const DEFAULT_VIDEO_TITLE = "Driver Training";

function statusFromProgress(progress) {
  if (!progress) return "NOT_STARTED";
  return progress.is_completed ? "COMPLETED" : "IN_PROGRESS";
}

async function loadVideoConfig() {
  const rows = await prisma.app_settings.findMany({
    where: { setting_key: { in: ["training_video_url", "training_video_title"] } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  return {
    videoUrl: byKey.training_video_url || "",
    videoTitle: byKey.training_video_title || DEFAULT_VIDEO_TITLE,
  };
}

/** Driver-facing — see TrainingData.java for the exact wire contract this must match. */
async function getStatus(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const [{ videoUrl, videoTitle }, progress] = await Promise.all([
      loadVideoConfig(),
      prisma.driver_training_progress.findUnique({ where: { rider_id: riderId } }),
    ]);

    return res.status(200).json({
      ResponseCode: "1",
      Result: "true",
      ResponseMsg: "Training status fetched",
      rider_id: riderId,
      training_required: videoUrl ? 1 : 0,
      training_status: statusFromProgress(progress),
      video_id: TRAINING_VIDEO_ID,
      video_title: videoTitle,
      video_url: videoUrl,
      watch_progress: progress ? progress.watch_progress : 0,
      current_position_seconds: progress ? progress.current_position_seconds : 0,
      total_duration_seconds: progress ? progress.total_duration_seconds : 0,
      completed_at: progress && progress.completed_at ? progress.completed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error("trainingController.getStatus failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Periodic in-video sync — never sets is_completed (only complete() does that). */
async function saveProgress(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const videoUrl = req.body.video_url || "";
    const watchProgress = Math.min(100, Math.max(0, Number(req.body.watch_progress) || 0));
    const currentPositionSeconds = Math.max(0, Number(req.body.current_position_seconds) || 0);
    const totalDurationSeconds = Math.max(0, Number(req.body.total_duration_seconds) || 0);

    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: watchProgress,
        current_position_seconds: currentPositionSeconds,
        total_duration_seconds: totalDurationSeconds,
      },
      update: {
        video_url: videoUrl,
        watch_progress: watchProgress,
        current_position_seconds: currentPositionSeconds,
        total_duration_seconds: totalDurationSeconds,
      },
    });

    return res.status(200).json({ ResponseCode: "1", Result: "true", ResponseMsg: "Progress saved" });
  } catch (err) {
    logger.error("trainingController.saveProgress failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Fires only when playback genuinely reaches the end (see TrainingVideoActivity.handleTrainingCompleted). */
async function complete(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const videoUrl = req.body.video_url || "";

    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: 100,
        is_completed: true,
        completed_at: new Date(),
      },
      update: {
        video_url: videoUrl,
        watch_progress: 100,
        is_completed: true,
        completed_at: new Date(),
      },
    });

    return res.status(200).json({ ResponseCode: "1", Result: "true", ResponseMsg: "Training marked complete" });
  } catch (err) {
    logger.error("trainingController.complete failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { getStatus, saveProgress, complete, TRAINING_VIDEO_ID };
