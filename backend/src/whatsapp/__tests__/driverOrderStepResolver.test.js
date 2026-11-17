const { resolveStep } = require("../driverOrder/stepResolver");

const TWO_STOPS = [{ id: 1 }, { id: 2 }];
const base = (order, extra = {}) => ({ order, progress: null, stops: [], timer: null, dropOtpRequired: false, settlement: null, ...extra });

describe("stepResolver.resolveStep", () => {
  it("cancelled order -> cancelled", () => {
    expect(resolveStep(base({ o_status: "Cancelled", order_status: 4 }))).toEqual({ key: "cancelled" });
  });

  it("an order that is no longer active and not completed (e.g. back to Pending) -> cancelled", () => {
    expect(resolveStep(base({ o_status: "Pending", order_status: 0 }))).toEqual({ key: "cancelled" });
  });

  it("completed with a pending cash settlement -> await_cash", () => {
    expect(resolveStep(base({ o_status: "Completed", order_status: 5 }, { settlement: { status: "pending", method: null } })))
      .toEqual({ key: "await_cash" });
  });

  it("completed with a settled payment -> done", () => {
    expect(resolveStep(base({ o_status: "Completed", order_status: 5 }, { settlement: { status: "cash_received", method: "cash" } })))
      .toEqual({ key: "done" });
  });

  it("completed with no settlement (online / wallet paid) -> done", () => {
    expect(resolveStep(base({ o_status: "Completed", order_status: 5 }))).toEqual({ key: "done" });
  });

  it("completed, pending settlement already marked online -> done", () => {
    expect(resolveStep(base({ o_status: "Completed", order_status: 5 }, { settlement: { status: "pending", method: "online" } })))
      .toEqual({ key: "done" });
  });

  it("order_status 1 -> go_pickup", () => {
    expect(resolveStep(base({ o_status: "Processing", order_status: 1 }))).toEqual({ key: "go_pickup" });
  });

  it("order_status 2, OTP not verified -> pickup_otp", () => {
    expect(resolveStep(base({ o_status: "Pickup", order_status: 2 }, { progress: { otp_verified_at: null } }))).toEqual({ key: "pickup_otp" });
  });

  it("order_status 2, OTP verified -> loading", () => {
    expect(resolveStep(base({ o_status: "Pickup", order_status: 2 }, { progress: { otp_verified_at: new Date() } }))).toEqual({ key: "loading" });
  });

  it("order_status 3, no stops, step 0 -> go_drop", () => {
    expect(resolveStep(base({ o_status: "On_Route", order_status: 3 }, { progress: { stop_step: 0 } }))).toEqual({ key: "go_drop" });
  });

  it("order_status 3, no stops, step 1 -> at_drop", () => {
    expect(resolveStep(base({ o_status: "On_Route", order_status: 3 }, { progress: { stop_step: 1 } }))).toEqual({ key: "at_drop" });
  });

  it("order_status 3, no stops, step 1 with drop OTP -> drop_otp", () => {
    expect(resolveStep(base({ o_status: "On_Route", order_status: 3 }, { progress: { stop_step: 1 }, dropOtpRequired: true })))
      .toEqual({ key: "drop_otp" });
  });

  describe("two stops", () => {
    const at = (step, extra = {}) => resolveStep(base({ o_status: "On_Route", order_status: 3 }, { progress: { stop_step: step }, stops: TWO_STOPS, ...extra }));
    it("stop_step 0 -> go_stop 1", () => expect(at(0)).toEqual({ key: "go_stop", stopNumber: 1 }));
    it("stop_step 1 -> at_stop 1", () => expect(at(1)).toEqual({ key: "at_stop", stopNumber: 1 }));
    it("stop_step 2 -> go_stop 2", () => expect(at(2)).toEqual({ key: "go_stop", stopNumber: 2 }));
    it("stop_step 3 -> at_stop 2", () => expect(at(3)).toEqual({ key: "at_stop", stopNumber: 2 }));
    it("stop_step 4 -> go_drop", () => expect(at(4)).toEqual({ key: "go_drop" }));
    it("stop_step 5 + drop OTP -> drop_otp", () => expect(at(5, { dropOtpRequired: true })).toEqual({ key: "drop_otp" }));
    it("stop_step 5 without drop OTP -> at_drop", () => expect(at(5)).toEqual({ key: "at_drop" }));
  });

  it("missing progress on order_status 3 is treated as stop_step 0", () => {
    expect(resolveStep(base({ o_status: "On_Route", order_status: 3 }, { stops: TWO_STOPS }))).toEqual({ key: "go_stop", stopNumber: 1 });
  });
});
