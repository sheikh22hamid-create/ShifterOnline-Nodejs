jest.mock("../../services/receiverTrackMessage", () => ({ trackLine: jest.fn(), syncReceiverPhone: jest.fn() }));

const notifications = require("../notifications");
const { handleTrackingQuery } = require("../handlers/customerHandler");
const prisma = require("../../config/db");
const { trackLine } = require("../../services/receiverTrackMessage");

const LINE = "📍 *Live track karein*: https://api.example.com/track/tok\n\n";
let sent;
const client = {
  onWhatsApp: jest.fn().mockImplementation((p) => Promise.resolve([{ jid: `${p}@s.whatsapp.net` }])),
  sendMessage: jest.fn().mockImplementation((jid, msg) => { sent.push({ jid, text: msg.text }); return Promise.resolve(true); }),
};
let oid = 7770; // the milestone de-duplication cache is per order id, so every test uses its own order
const order = (o = {}) => ({
  id: oid, uid: 301, rid: 701, order_status: 3, o_status: "On_Route", category: 1,
  pmobile: "9811111111", dmobile: "9822222222", pick_name: "Amit", drop_name: "Rahul",
  paddress: "Vijay Nagar", daddress: "Bhawarkua", total_dcharge: 350, otp: 4321, ...o,
});
const to = (digits) => sent.find((m) => m.jid.includes(digits));

beforeEach(() => {
  oid += 1;
  sent = [];
  notifications.setWhatsAppClient(client);
  trackLine.mockResolvedValue(LINE);
  jest.spyOn(prisma.pkg_order, "findUnique").mockResolvedValue(order());
  jest.spyOn(prisma.tbl_user, "findUnique").mockResolvedValue({ id: 301, name: "Amit", mobile: "9811111111" });
  jest.spyOn(prisma.tbl_rider, "findUnique").mockResolvedValue({ id: 701, first_name: "Suresh", last_name: "Patel", fmobile: "9109114515", vehicle_no: "MP09CD5678" });
  jest.spyOn(prisma.pkg_category, "findUnique").mockResolvedValue({ title: "Tata Ace" });
  jest.spyOn(prisma.pkg_order_stops, "findMany").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe("receiver tracking link in the receiver's messages only", () => {
  it("driver assigned: the receiver gets a new message with the link, the sender's message is unchanged", async () => {
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(2);
    expect(to("9822222222").text).toContain(LINE.trim());
    expect(to("9822222222").text).toContain("Suresh Patel");
    expect(to("9811111111").text).not.toContain("Live track");
  });
  it("driver assigned: no extra message when there is no link (flag off, no base URL, error)", async () => {
    trackLine.mockResolvedValue("");
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(1);
    expect(to("9811111111")).toBeDefined();
  });
  it("reached pickup, trip started and reached drop: link only for the receiver", async () => {
    for (const fn of ["notifyDriverArrived", "notifyTripStarted", "notifyDriverArrivedDrop"]) {
      sent = [];
      await notifications[fn](oid);
      expect(to("9822222222").text).toContain(LINE.trim());
      expect(to("9811111111").text).not.toContain("Live track");
    }
  });
  it("delivery complete carries no tracking link", async () => {
    await notifications.notifyTripCompleted(oid);
    for (const m of sent) expect(m.text).not.toContain("Live track");
  });
  it("same number for sender and receiver: no link and no duplicate message", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9811111111" }));
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Live track");
  });
});

describe("Track <id> reply", () => {
  it("includes the link for the receiver's number only, never for the sender", async () => {
    expect(await handleTrackingQuery(String(oid), "9822222222")).toContain(LINE.trim());
    expect(await handleTrackingQuery(String(oid), "9811111111")).not.toContain("Live track");
  });
  it("adds no link once the order is delivered or cancelled", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed" }));
    expect(await handleTrackingQuery(String(oid), "9822222222")).not.toContain("Live track");
  });
});
