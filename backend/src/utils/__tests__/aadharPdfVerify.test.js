// verifyAadharPdf brute-forces UIDAI's e-Aadhaar PDF password scheme
// (first-4-letters-of-name + birth-year) and checks the decrypted content
// for the given name. `mupdf` is mocked here so these tests don't depend on
// a real encrypted PDF fixture or the native/WASM module - the actual
// unlock+extract mechanics were verified manually against a real
// pypdf-generated encrypted PDF during development (see PR/commit notes).

function makeFakeDoc({ correctPassword, pageText }) {
  let authenticated = false;
  return {
    needsPassword: () => true,
    authenticatePassword: (pwd) => {
      authenticated = pwd === correctPassword;
      return authenticated;
    },
    countPages: () => 1,
    loadPage: () => ({
      toStructuredText: () => ({ asText: () => (authenticated ? pageText : "") }),
    }),
    destroy: jest.fn(),
  };
}

describe("aadharPdfVerify", () => {
  const { namePrefix, normalizeForMatch } = require("../aadharPdfVerify");

  describe("namePrefix", () => {
    it("takes the first 4 letters, uppercased, stripping spaces/punctuation", () => {
      expect(namePrefix("Rahul Sharma")).toBe("RAHU");
    });
    it("handles short names without padding", () => {
      expect(namePrefix("Om")).toBe("OM");
    });
    it("returns empty string for empty/missing input", () => {
      expect(namePrefix("")).toBe("");
      expect(namePrefix(undefined)).toBe("");
    });
  });

  describe("normalizeForMatch", () => {
    it("uppercases and collapses whitespace/punctuation", () => {
      expect(normalizeForMatch("  Rahul   Sharma, S/O Ramesh! ")).toBe("RAHUL SHARMA S O RAMESH");
    });
  });

  describe("verifyAadharPdf", () => {
    // Dynamic import() isn't reliably interceptable via jest.mock in this
    // CommonJS setup, so aadharPdfVerify.js calls `exports.loadMupdf()`
    // internally specifically so it can be swapped out here.
    const aadharPdfVerify = require("../aadharPdfVerify");
    let mupdfMock;
    let loadMupdfSpy;

    beforeEach(() => {
      mupdfMock = { Document: { openDocument: jest.fn() } };
      loadMupdfSpy = jest.spyOn(aadharPdfVerify, "loadMupdf").mockResolvedValue(mupdfMock);
    });

    afterEach(() => {
      loadMupdfSpy.mockRestore();
    });

    it("rejects when aadhar_base64 or full_name is missing", async () => {
      expect(await aadharPdfVerify.verifyAadharPdf({ aadharBase64: "", fullName: "Rahul Sharma" })).toEqual({
        ok: false,
        reason: "aadhar_base64 and full_name are required.",
      });
      expect(await aadharPdfVerify.verifyAadharPdf({ aadharBase64: "abc", fullName: "" })).toEqual({
        ok: false,
        reason: "aadhar_base64 and full_name are required.",
      });
      expect(mupdfMock.Document.openDocument).not.toHaveBeenCalled();
    });

    it("rejects invalid base64 without attempting to open a document", async () => {
      // A lone "=" is not decodable to any bytes, so the resulting buffer is empty.
      const result = await aadharPdfVerify.verifyAadharPdf({ aadharBase64: "=", fullName: "Rahul Sharma" });
      expect(result).toEqual({ ok: false, reason: "Invalid base64 PDF data." });
    });

    it("succeeds once the correct year unlocks the PDF and the full name is found in its text", async () => {
      const fakeDoc = makeFakeDoc({ correctPassword: "RAHU1990", pageText: "Government of India To Rahul Sharma DOB: 15/08/1990" });
      mupdfMock.Document.openDocument.mockImplementation(() => fakeDoc);

      const result = await aadharPdfVerify.verifyAadharPdf({ aadharBase64: Buffer.from("pdfbytes").toString("base64"), fullName: "Rahul Sharma" });

      expect(result.ok).toBe(true);
      expect(result.matchedYear).toBe(1990);
      expect(fakeDoc.destroy).toHaveBeenCalled();
    });

    it("fails when no password in range unlocks the document", async () => {
      mupdfMock.Document.openDocument.mockImplementation(() => makeFakeDoc({ correctPassword: "NEVER0000", pageText: "" }));

      const result = await aadharPdfVerify.verifyAadharPdf({ aadharBase64: Buffer.from("pdfbytes").toString("base64"), fullName: "Rahul Sharma" });

      expect(result).toEqual({ ok: false, reason: "Name Mismatch. The name entered does not match your Aadhaar.", field: "name" });
    });

    it("fails when the PDF unlocks (right prefix+year) but the full name isn't actually in the text", async () => {
      // Simulates a different person who happens to share first-4-letters+birth-year.
      const fakeDoc = makeFakeDoc({ correctPassword: "RAHU1990", pageText: "Government of India To Rahul Verma DOB: 15/08/1990" });
      mupdfMock.Document.openDocument.mockImplementation(() => fakeDoc);

      const result = await aadharPdfVerify.verifyAadharPdf({ aadharBase64: Buffer.from("pdfbytes").toString("base64"), fullName: "Rahul Sharma" });

      expect(result).toEqual({ ok: false, reason: "Name Mismatch. The name entered does not match your Aadhaar.", field: "name" });
    });

    it("fails with a DOB-specific reason when the name matches but the entered DOB year doesn't", async () => {
      const fakeDoc = makeFakeDoc({ correctPassword: "RAHU1990", pageText: "Government of India To Rahul Sharma DOB: 15/08/1990" });
      mupdfMock.Document.openDocument.mockImplementation(() => fakeDoc);

      const result = await aadharPdfVerify.verifyAadharPdf({
        aadharBase64: Buffer.from("pdfbytes").toString("base64"),
        fullName: "Rahul Sharma",
        dob: "15/08/1992",
      });

      expect(result).toEqual({ ok: false, reason: "DOB Mismatch. The date of birth entered does not match your Aadhaar.", field: "dob" });
      expect(fakeDoc.destroy).toHaveBeenCalled();
    });

    it("succeeds when both name and dob (year) match", async () => {
      const fakeDoc = makeFakeDoc({ correctPassword: "RAHU1990", pageText: "Government of India To Rahul Sharma DOB: 15/08/1990" });
      mupdfMock.Document.openDocument.mockImplementation(() => fakeDoc);

      const result = await aadharPdfVerify.verifyAadharPdf({
        aadharBase64: Buffer.from("pdfbytes").toString("base64"),
        fullName: "Rahul Sharma",
        dob: "15/08/1990",
      });

      expect(result.ok).toBe(true);
      expect(result.matchedYear).toBe(1990);
    });

    it("handles a corrupt/unreadable PDF without throwing", async () => {
      mupdfMock.Document.openDocument.mockImplementation(() => {
        throw new Error("no objects found");
      });

      const result = await aadharPdfVerify.verifyAadharPdf({ aadharBase64: Buffer.from("garbage").toString("base64"), fullName: "Rahul Sharma" });

      expect(result).toEqual({ ok: false, reason: "Could not read the Aadhar PDF." });
    });
  });
});
