const { generatePhotoFilename, buildUploadResponse } = require("../uploadController");

describe("uploadController.generatePhotoFilename", () => {
  it("preserves an allowed image extension", () => {
    const name = generatePhotoFilename("my-package.png");
    expect(name.endsWith(".png")).toBe(true);
  });

  it("falls back to .jpg for a disallowed or missing extension", () => {
    expect(generatePhotoFilename("payload.exe").endsWith(".jpg")).toBe(true);
    expect(generatePhotoFilename("").endsWith(".jpg")).toBe(true);
  });

  it("generates a different name on each call for the same input", () => {
    const a = generatePhotoFilename("photo.jpg");
    const b = generatePhotoFilename("photo.jpg");
    expect(a).not.toBe(b);
  });
});

describe("uploadController.buildUploadResponse", () => {
  it("returns a 400 with no file", () => {
    const { status, body } = buildUploadResponse(undefined);
    expect(status).toBe(400);
    expect(body.Result).toBe(false);
  });

  it("returns the relative order_photos path with a file", () => {
    const { status, body } = buildUploadResponse({ filename: "123_abc.jpg" });
    expect(status).toBe(200);
    expect(body).toEqual({ Result: true, path: "images/order_photos/123_abc.jpg" });
  });
});
