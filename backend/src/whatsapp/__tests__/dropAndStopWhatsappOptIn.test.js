// "Send booking info & OTP on this WhatsApp number" for the drop contact and for each extra stop.
jest.mock("../../services/receiverTrackMessage", () => ({ trackUrl: jest.fn(), trackLine: jest.fn(), syncReceiverPhone: jest.fn() }));
jest.mock("../../services/dropOtp", () => ({ isRequired: jest.fn() }));

const notifications = require("../notifications");
const prisma = require("../../config/db");
const { trackLine } = require("../../services/receiverTrackMessage");
const dropOtp = require("../../services/dropOtp");

const LINE = "📍 *Live track karein*: https://api.example.com/track/tok\n\n";
let sent;
const client = {
  onWhatsApp: jest.fn().mockImplementation((p) => Promise.resolve([{ jid: `${p}@s.whatsapp.net` }])),
  sendMessage: jest.fn().mockImplementation((jid, msg) => { sent.push({ jid, text: msg.text }); return Promise.resolve(true); }),
};
let oid = 8880; // the milestone de-duplication cache is per order id, so every test uses its own order
const order = (o = {}) => ({
  id: oid, uid: 301, rid: 701, order_status: 1, o_status: "Processing", category: 1,
  pmobile: "9811111111", dmobile: "9822222222", pick_name: "Amit", drop_name: "Rahul",
  paddress: "Vijay Nagar", daddress: "Bhawarkua", total_dcharge: 350, otp: 4321,
  drop_otp: 6789, send_receiver_whatsapp: false, send_sender_whatsapp: false, ...o,
});
const stop = (o = {}) => ({ id: 1, order_id: oid, sequence: 1, address: "Palasia Square", contact_number: "9833333333", send_whatsapp: true, ...o });
const to = (digits) => sent.filter((m) => m.jid.includes(digits));

beforeEach(() => {
  oid += 1;
  sent = [];
  notifications.setWhatsAppClient(client);
  trackLine.mockResolvedValue(LINE);
  dropOtp.isRequired.mockResolvedValue(true);
  jest.spyOn(prisma.pkg_order, "findUnique").mockResolvedValue(order());
  jest.spyOn(prisma.tbl_user, "findUnique").mockResolvedValue({ id: 301, name: "Amit", mobile: "9811111111" });
  jest.spyOn(prisma.tbl_rider, "findUnique").mockResolvedValue({ id: 701, first_name: "Suresh", last_name: "Patel", fmobile: "9109114515", vehicle_no: "MP09CD5678" });
  jest.spyOn(prisma.pkg_category, "findUnique").mockResolvedValue({ title: "Tata Ace" });
  jest.spyOn(prisma.pkg_order_stops, "findMany").mockResolvedValue([]);
  jest.spyOn(prisma.order_receiver_pay, "findFirst").mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe("drop contact opt-in", () => {
  it("opted in: the driver-assigned message to the drop number carries the drop OTP", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ send_receiver_whatsapp: true }));
    await notifications.notifyDriverAssigned(oid);
    const msgs = to("9822222222");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("Drop OTP");
    expect(msgs[0].text).toContain("6789");
    expect(msgs[0].text).not.toContain("4321"); // never the pickup OTP
  });

  it("not opted in: the message is the existing one and carries no OTP", async () => {
    await notifications.notifyDriverAssigned(oid);
    const msgs = to("9822222222");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).not.toContain("Drop OTP");
    expect(msgs[0].text).not.toContain("6789");
  });

  it("opted in but the order has no drop OTP (feature off): no OTP is sent", async () => {
    dropOtp.isRequired.mockResolvedValue(false);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ send_receiver_whatsapp: true, drop_otp: null }));
    await notifications.notifyDriverAssigned(oid);
    for (const m of sent) expect(m.text).not.toContain("Drop OTP");
  });

  it("opted in and there is no tracking link: the OTP message is still sent", async () => {
    trackLine.mockResolvedValue("");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ send_receiver_whatsapp: true }));
    await notifications.notifyDriverAssigned(oid);
    const msgs = to("9822222222");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("6789");
    expect(msgs[0].text).not.toContain("live map");
  });

  it("the drop contact is the booker's own number: they still get the drop OTP once", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9811111111", send_receiver_whatsapp: true }));
    await notifications.notifyDriverAssigned(oid);
    await notifications.notifyDriverAssigned(oid); // a repeat must not message again
    const msgs = to("9811111111");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("6789");
  });

  it("the sender's own message carries the drop OTP when sender and drop contact are the same opted-in number", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9811111111", send_receiver_whatsapp: true, send_sender_whatsapp: true }));
    await notifications.notifyDriverAssigned(oid);
    const msgs = to("9811111111");
    expect(msgs).toHaveLength(1); // one combined message, not two
    expect(msgs[0].text).toContain("Pickup OTP");
    expect(msgs[0].text).toContain("6789");
  });
});

describe("extra stop opt-in", () => {
  it("booking: an opted-in stop contact gets the booking info (and no OTP)", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([stop()]);
    await notifications.notifyOrderBooked(oid);
    const msgs = to("9833333333");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain(`#${oid}`);
    expect(msgs[0].text).toContain("Palasia Square");
    expect(msgs[0].text).not.toContain("OTP");
  });

  it("a stop that did not opt in gets nothing", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([stop({ send_whatsapp: false })]);
    await notifications.notifyOrderBooked(oid);
    expect(to("9833333333")).toHaveLength(0);
  });

  it("the same number on two stops, or the receiver's number, is messaged only once", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([
      stop({ sequence: 1 }), stop({ id: 2, sequence: 2 }), stop({ id: 3, sequence: 3, contact_number: "9822222222" }),
    ]);
    await notifications.notifyOrderBooked(oid);
    expect(to("9833333333")).toHaveLength(1);
    expect(to("9822222222")).toHaveLength(1); // only the receiver's own booking message
  });

  it("driver assigned: the opted-in stop contact gets the driver details", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([stop()]);
    await notifications.notifyDriverAssigned(oid);
    const msgs = to("9833333333");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("Suresh Patel");
    expect(msgs[0].text).toContain("Palasia Square");
  });
});
