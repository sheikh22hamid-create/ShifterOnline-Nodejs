jest.mock("../../config/db", () => ({}));

const { buildRegistrationStatus } = require("../registrationCompletionService");

const byKey = (s) => Object.fromEntries(s.items.map((i) => [i.key, i.status]));
const fullDoc = { aadhar_id: "1234", aadhar_status: 1, lic_id: "DL1", lic_status: 1, residence_id: "RC1", residence_status: 1 };
const normalRider = { trial_status: "none", verification_status: "approved", profile_picture: "p.jpg", email: "", account_number: "", ifsc: "" };

describe("buildRegistrationStatus", () => {
  it("lists the skipped optional items for a normal driver, with the right labels", () => {
    const s = buildRegistrationStatus(normalRider, { ...fullDoc, pan_id: "", pan_status: 0 });
    expect(s.flow).toBe("remaining_documents");
    expect(s.is_trial).toBe(false);
    expect(byKey(s)).toEqual({
      pan: "pending", insurance: "not_uploaded", puc: "not_uploaded", bank: "pending", email: "pending",
    });
    expect(s.is_complete).toBe(false);
    expect(s.pending_count).toBe(5);
  });

  it("never asks a normal driver for eKYC documents, e.g. one an admin approved manually", () => {
    const s = buildRegistrationStatus({ ...normalRider, profile_picture: "" }, null);
    expect(Object.keys(byKey(s))).toEqual(["pan", "insurance", "puc", "bank", "email"]);
  });

  it("is complete once every item is filled", () => {
    const s = buildRegistrationStatus(
      { ...normalRider, email: "a@b.co", account_number: "123456789", ifsc: "SBIN0000466" },
      { ...fullDoc, pan_id: "ABCDE1234F", pan_status: 1, bima_image: "b.jpg", puc_image: "p.jpg" },
    );
    expect(s.is_complete).toBe(true);
    expect(s.pending_count).toBe(0);
  });

  it("shows a submitted-but-unapproved PAN as under review, not pending", () => {
    const s = buildRegistrationStatus(normalRider, { ...fullDoc, pan_id: "ABCDE1234F", pan_status: 0 });
    expect(byKey(s).pan).toBe("under_review");
  });

  it("treats an admin-created trial driver as needing the full registration flow", () => {
    const s = buildRegistrationStatus({ trial_status: "active", verification_status: "pending", profile_picture: "", email: "", account_number: "", ifsc: "" }, null);
    expect(s.is_trial).toBe(true);
    expect(s.flow).toBe("full_registration");
    expect(byKey(s)).toMatchObject({ aadhaar: "required_pending", dl: "required_pending", rc: "required_pending", photo: "required_pending" });
  });

  it("keeps an exhausted or blocked trial driver on the full flow too, but not an upgraded one", () => {
    const base = { verification_status: "pending", profile_picture: "", email: "", account_number: "", ifsc: "" };
    expect(buildRegistrationStatus({ ...base, trial_status: "exhausted" }, null).is_trial).toBe(true);
    expect(buildRegistrationStatus({ ...base, trial_status: "blocked" }, null).is_trial).toBe(true);
    expect(buildRegistrationStatus({ ...base, trial_status: "upgraded", verification_status: "approved" }, null).is_trial).toBe(false);
  });

  it("does not require a driving licence from a bicycle-rider trial driver", () => {
    const s = buildRegistrationStatus({ ...normalRider, trial_status: "active", verification_status: "pending" }, { ...fullDoc, lic_id: "", is_bycle: 1 });
    expect(byKey(s).dl).toBeUndefined();
    expect(byKey(s).aadhaar).toBe("done");
  });
});
