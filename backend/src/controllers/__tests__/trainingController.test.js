jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
  driver_training_progress: { findUnique: jest.fn(), upsert: jest.fn() },
}));

const prisma = require("../../config/db");
const { getStatus, saveProgress, complete } = require("../trainingController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("trainingController.getStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports training_required = 0 when no video URL is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { body: { rider_id: "5" } };
    const res = makeRes();
    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.training_required).toBe(0);
    expect(payload.training_status).toBe("NOT_STARTED");
    expect(payload.Result).toBe("true");
  });

  it("stays COMPLETED for a driver who already finished, even after the video link changes", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "training_video_url", setting_value: "https://cdn.example.com/new-video.mp4" },
      { setting_key: "training_video_title", setting_value: "New Training" },
    ]);
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      rider_id: 5,
      video_url: "https://cdn.example.com/old-video.mp4",
      watch_progress: 100,
      current_position_seconds: 300,
      total_duration_seconds: 300,
      is_completed: true,
      completed_at: new Date("2026-08-01T00:00:00.000Z"),
    });

    const req = { body: { rider_id: "5" } };
    const res = makeRes();
    await getStatus(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.training_required).toBe(1);
    expect(payload.training_status).toBe("COMPLETED");
    expect(payload.video_url).toBe("https://cdn.example.com/new-video.mp4");
  });

  it("rejects a request with no rider_id", async () => {
    const req = { body: {} };
    const res = makeRes();
    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("trainingController.saveProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("upserts progress without ever touching is_completed", async () => {
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = {
      body: {
        rider_id: "5",
        video_id: "training_v1",
        video_url: "https://cdn.example.com/video.mp4",
        watch_progress: 42.5,
        current_position_seconds: 120,
        total_duration_seconds: 300,
      },
    };
    const res = makeRes();
    await saveProgress(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.create).not.toHaveProperty("is_completed");
    expect(call.update).not.toHaveProperty("is_completed");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not downgrade watch_progress/is_completed for an already-completed driver's rewatch", async () => {
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      rider_id: 5,
      is_completed: true,
      watch_progress: 100,
      current_position_seconds: 300,
      total_duration_seconds: 300,
      completed_at: new Date("2026-08-01T00:00:00.000Z"),
    });
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = {
      body: {
        rider_id: "5",
        video_id: "training_v1",
        video_url: "https://cdn.example.com/video.mp4",
        watch_progress: 12,
        current_position_seconds: 30,
        total_duration_seconds: 300,
      },
    };
    const res = makeRes();
    await saveProgress(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.update).not.toHaveProperty("watch_progress");
    expect(call.update).not.toHaveProperty("current_position_seconds");
    expect(call.update).not.toHaveProperty("total_duration_seconds");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("trainingController.complete", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks the driver completed with a completed_at timestamp", async () => {
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = { body: { rider_id: "5", video_id: "training_v1", video_url: "https://cdn.example.com/video.mp4" } };
    const res = makeRes();
    await complete(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.update).toMatchObject({ is_completed: true, watch_progress: 100 });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("preserves the original completed_at on a repeat call for an already-completed driver", async () => {
    const originalCompletedAt = new Date("2026-08-01T00:00:00.000Z");
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      rider_id: 5,
      is_completed: true,
      watch_progress: 100,
      completed_at: originalCompletedAt,
    });
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = { body: { rider_id: "5", video_id: "training_v1", video_url: "https://cdn.example.com/video.mp4" } };
    const res = makeRes();
    await complete(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.update).not.toHaveProperty("completed_at");
    expect(call.update).toMatchObject({ is_completed: true, watch_progress: 100 });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
