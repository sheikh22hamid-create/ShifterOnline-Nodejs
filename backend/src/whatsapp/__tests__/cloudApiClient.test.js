const cloudApiClient = require("../cloudApiClient");
const cloudinaryStorage = require("../../utils/cloudinaryStorage");

jest.mock("../../utils/cloudinaryStorage", () => ({
  uploadBuffer: jest.fn().mockResolvedValue("images/whatsapp_inbound/test.jpg"),
  urlForRelativePath: jest.fn().mockReturnValue("https://res.cloudinary.com/test/images/whatsapp_inbound/test.jpg"),
}));

describe("cloudApiClient media methods", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("getMediaUrl", () => {
    it("fetches metadata and returns download URL from Meta", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
          mime_type: "image/jpeg",
          sha256: "abc123hash",
          file_size: 54321,
          id: "123",
        }),
      });

      const media = await cloudApiClient.getMediaUrl("123");
      expect(media.url).toBe("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123");
      expect(media.mime_type).toBe("image/jpeg");
    });

    it("throws error if Meta returns an error object", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { message: "Media not found", code: 100 },
        }),
      });

      await expect(cloudApiClient.getMediaUrl("bad_id")).rejects.toThrow("Media not found");
    });
  });

  describe("downloadMediaBuffer", () => {
    it("downloads binary buffer with Authorization and User-Agent headers", async () => {
      global.fetch = jest
        .fn()
        // 1st call: getMediaUrl
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            url: "https://lookaside.fbsbx.com/media/file.jpg",
            mime_type: "image/jpeg",
            file_size: 10,
            id: "123",
          }),
        })
        // 2nd call: download binary
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        });

      const result = await cloudApiClient.downloadMediaBuffer("123");
      expect(result.mimeType).toBe("image/jpeg");
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.buffer.length).toBe(4);
    });
  });

  describe("fetchAndStoreMedia", () => {
    it("downloads and uploads to Cloudinary storage, returning delivery URL", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            url: "https://lookaside.fbsbx.com/media/file.jpg",
            mime_type: "image/jpeg",
            file_size: 10,
            id: "media_img_999",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([10, 20, 30]).buffer,
        });

      const res = await cloudApiClient.fetchAndStoreMedia({
        mediaId: "media_img_999",
        mimeType: "image/jpeg",
        messageType: "image",
      });

      expect(cloudinaryStorage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^images\/whatsapp_inbound\/\d+_media_img_999\.jpg$/)
      );
      expect(res.url).toBe("https://res.cloudinary.com/test/images/whatsapp_inbound/test.jpg");
      expect(res.mimeType).toBe("image/jpeg");
    });

    it("handles video media with video subfolder and .mp4 extension", async () => {
      cloudinaryStorage.urlForRelativePath.mockReturnValueOnce("https://res.cloudinary.com/test/videos/whatsapp_inbound/test.mp4");

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            url: "https://lookaside.fbsbx.com/media/video.mp4",
            mime_type: "video/mp4",
            file_size: 100,
            id: "media_vid_888",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([50, 60]).buffer,
        });

      const res = await cloudApiClient.fetchAndStoreMedia({
        mediaId: "media_vid_888",
        mimeType: "video/mp4",
        messageType: "video",
      });

      expect(cloudinaryStorage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringMatching(/^videos\/whatsapp_inbound\/\d+_media_vid_888\.mp4$/)
      );
      expect(res.url).toBe("https://res.cloudinary.com/test/videos/whatsapp_inbound/test.mp4");
      expect(res.mimeType).toBe("video/mp4");
    });
  });
});
