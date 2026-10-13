jest.mock("../../services/receiverTrackMessage", () => ({ trackUrl: jest.fn(), trackLine: jest.fn(), syncReceiverPhone: jest.fn() }));

const { handleTrackingQuery } = require("../handlers/customerHandler");
const notifications = require("../notifications");
const prisma = require("../../config/db");
const { trackUrl, trackLine } = require("../../services/receiverTrackMessage");

describe("WhatsApp Order Tracking & Privacy Security", () => {
  const mockOrder = {
    id: 9991,
    uid: 101,
    rid: 501,
    order_status: 2,
    o_status: "Pickup",
    pmobile: "9876543210",
    dmobile: "8765432109",
    paddress: "123 MG Road, Indore",
    daddress: "456 Palasia, Indore",
    total_dcharge: 450,
    otp: 7890,
  };

  const mockUser = {
    id: 101,
    name: "Faizan Khan",
    mobile: "9876543210",
  };

  const mockRider = {
    id: 501,
    first_name: "Ramesh",
    last_name: "Kumar",
    fmobile: "9123456789",
    vehicle_no: "MP09AB1234",
  };

  beforeEach(() => {
    jest.spyOn(prisma.pkg_order, "findUnique").mockResolvedValue(mockOrder);
    jest.spyOn(prisma.tbl_user, "findUnique").mockResolvedValue(mockUser);
    jest.spyOn(prisma.tbl_rider, "findUnique").mockResolvedValue(mockRider);
    jest.spyOn(prisma.pkg_order_stops, "findMany").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should BLOCK unauthorized user and show security privacy message", async () => {
    // Calling from an unrelated phone: 9999999999
    const response = await handleTrackingQuery("9991", "9999999999");
    expect(response).toContain("This order was not booked using your WhatsApp number");
    expect(response).not.toContain("123 MG Road");
    expect(response).not.toContain("7890"); // OTP never leaked
  });

  it("should ALLOW Sender (pmobile) to track order and display OTP", async () => {
    // Calling from sender phone: 9876543210
    const response = await handleTrackingQuery("9991", "9876543210");
    expect(response).toContain("Order #9991 Tracking Status");
    expect(response).toContain("Driver Arrived at Pickup Point");
    expect(response).toContain("123 MG Road, Indore");
    expect(response).toContain("456 Palasia, Indore");
    expect(response).toContain("Ramesh Kumar");
    expect(response).toContain("🔑 *Pickup OTP*: *7890*");
  });

  it("should ALLOW Receiver (dmobile) to track order but NOT reveal pickup OTP", async () => {
    // Calling from receiver phone: 8765432109
    const response = await handleTrackingQuery("9991", "8765432109");
    expect(response).toContain("Order #9991 Tracking Status");
    expect(response).toContain("123 MG Road, Indore");
    expect(response).toContain("456 Palasia, Indore");
    expect(response).toContain("Ramesh Kumar");
    // Receiver should NOT see pickup OTP (it belongs to the sender handing over goods)
    expect(response).not.toContain("Pickup OTP");
  });
});

describe("Automated WhatsApp Lifecycle Notifications", () => {
  let sentMessages = [];

  const mockClient = {
    onWhatsApp: jest.fn().mockImplementation((phone) => Promise.resolve([{ jid: `${phone}@s.whatsapp.net` }])),
    sendMessage: jest.fn().mockImplementation((jid, msg) => {
      sentMessages.push({ jid, text: msg.text });
      return Promise.resolve(true);
    }),
  };

  beforeEach(() => {
    sentMessages = [];
    notifications.setWhatsAppClient(mockClient);
    trackUrl.mockResolvedValue("");
    trackLine.mockResolvedValue("");

    jest.spyOn(prisma.pkg_order, "findUnique").mockResolvedValue({
      id: 8881,
      uid: 201,
      rid: 601,
      category: 1,
      pmobile: "9811111111",
      dmobile: "9822222222",
      pick_name: "Amit Sharma",
      drop_name: "Rahul Verma",
      paddress: "Vijay Nagar, Indore",
      daddress: "Bhawarkua, Indore",
      total_dcharge: 350,
      otp: 4321,
    });

    jest.spyOn(prisma.tbl_user, "findUnique").mockResolvedValue({
      id: 201,
      name: "Amit Sharma",
      mobile: "9811111111",
    });

    jest.spyOn(prisma.tbl_rider, "findUnique").mockResolvedValue({
      id: 601,
      first_name: "Suresh",
      last_name: "Patel",
      fmobile: "9109114515",
      vehicle_no: "MP09CD5678",
    });

    jest.spyOn(prisma.pkg_category, "findUnique").mockResolvedValue({
      title: "Tata Ace",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const orderRow = (o = {}) => ({
    id: 8881, uid: 201, rid: 601, category: 1, pmobile: "9811111111", dmobile: "9822222222",
    pick_name: "Amit Sharma", drop_name: "Rahul Verma", paddress: "Vijay Nagar, Indore",
    daddress: "Bhawarkua, Indore", total_dcharge: 350, otp: 4321, send_sender_whatsapp: false, ...o,
  });
  const to = (digits) => sentMessages.filter((m) => m.jid.includes(digits));
  let seq = 8900; // the milestone de-duplication cache is per order id
  const useOrder = (o) => {
    seq += 1;
    prisma.pkg_order.findUnique.mockResolvedValue(orderRow({ id: seq, ...o }));
    return seq;
  };

  describe("sender opted OUT (default)", () => {
    it("sends the sender nothing at any milestone", async () => {
      const id = useOrder({});
      for (const fn of ["notifyOrderBooked", "notifyDriverAssigned", "notifyDriverArrived", "notifyTripStarted", "notifyDriverArrivedDrop", "notifyTripCompleted", "notifyOrderCancelled"]) {
        await notifications[fn](id);
      }
      expect(to("9811111111")).toHaveLength(0);
      expect(to("9822222222").length).toBeGreaterThan(0); // receiver messages are unaffected
    });
  });

  describe("sender opted IN", () => {
    it("driver assigned: message 1 has driver, vehicle number, OTP, pickup, drop and receiver", async () => {
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyDriverAssigned(id);
      const [msg] = to("9811111111");
      expect(msg.text).toContain("Your Shifter Online delivery has been confirmed");
      expect(msg.text).toContain("Suresh Patel");
      expect(msg.text).toContain("MP09CD5678");
      expect(msg.text).toContain("Pickup OTP*: *4321*");
      expect(msg.text).toContain("Vijay Nagar, Indore");
      expect(msg.text).toContain("Bhawarkua, Indore");
      expect(msg.text).toContain("Rahul Verma");
      expect(msg.text).toContain("Tata Ace");
    });

    it("driver assigned: includes the live tracking link when there is one", async () => {
      trackUrl.mockResolvedValue("https://api.example.com/track/tok");
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyDriverAssigned(id);
      expect(to("9811111111")[0].text).toContain("https://api.example.com/track/tok");
    });

    it("a reassigned driver re-sends message 1 with the new driver", async () => {
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyDriverAssigned(id);
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 602, first_name: "Dinesh", last_name: "Rao", fmobile: "9000000000", vehicle_no: "MP09ZZ0001" });
      await notifications.notifyDriverAssigned(id);
      expect(to("9811111111")).toHaveLength(2);
      expect(to("9811111111")[1].text).toContain("Dinesh Rao");
    });

    it("sends no sender message for arrived, pickup, drop-arrived, booked or cancelled", async () => {
      const id = useOrder({ send_sender_whatsapp: true });
      for (const fn of ["notifyOrderBooked", "notifyDriverArrived", "notifyTripStarted", "notifyDriverArrivedDrop", "notifyOrderCancelled"]) {
        await notifications[fn](id);
      }
      expect(to("9811111111")).toHaveLength(0);
    });

    it("trip completed (sender pays): message 2 has fare, payment note and the app link", async () => {
      jest.spyOn(prisma.order_receiver_pay, "findFirst").mockResolvedValue(null);
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyTripCompleted(id);
      const [msg] = to("9811111111");
      expect(msg.text).toContain(`Your delivery for Order #${id} has been successfully completed`);
      expect(msg.text).toContain("₹350");
      expect(msg.text).toContain("Shifter Online app");
      expect(msg.text).toContain("play.google.com/store/apps/details?id=com.shifter.online");
      expect(msg.text).not.toContain("sent to the Receiver");
    });

    it("trip completed (receiver pays): sender is told the link went to the receiver, receiver gets no generic note", async () => {
      jest.spyOn(prisma.order_receiver_pay, "findFirst").mockResolvedValue({ status: "active" });
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyTripCompleted(id);
      expect(to("9811111111")[0].text).toContain("Payment link has been sent to the Receiver");
      expect(to("9822222222")).toHaveLength(0);
    });

    it("trip completed twice sends the sender only one message", async () => {
      jest.spyOn(prisma.order_receiver_pay, "findFirst").mockResolvedValue(null);
      const id = useOrder({ send_sender_whatsapp: true });
      await notifications.notifyTripCompleted(id);
      await notifications.notifyTripCompleted(id);
      expect(to("9811111111")).toHaveLength(1);
    });
  });

  describe("receiver messages", () => {
    it("booked / arrived / pickup / completed still reach the receiver", async () => {
      jest.spyOn(prisma.order_receiver_pay, "findFirst").mockResolvedValue(null);
      const id = useOrder({});
      await notifications.notifyOrderBooked(id);
      await notifications.notifyDriverArrived(id);
      await notifications.notifyTripStarted(id);
      await notifications.notifyTripCompleted(id);
      const texts = to("9822222222").map((m) => m.text);
      expect(texts).toHaveLength(4);
      expect(texts[0]).toContain("Aapke liye ek parcel/delivery book ki gayi hai");
      expect(texts[1]).toContain("Driver Arrived at Pickup Point");
      expect(texts[3]).toContain("Order Delivered Successfully");
    });
  });
});
