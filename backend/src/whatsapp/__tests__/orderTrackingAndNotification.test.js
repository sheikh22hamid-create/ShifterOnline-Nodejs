const { handleTrackingQuery } = require("../handlers/customerHandler");
const notifications = require("../notifications");
const prisma = require("../../config/db");

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

  it("notifyOrderBooked sends confirmation to both Sender and Receiver", async () => {
    await notifications.notifyOrderBooked(8881);

    expect(sentMessages.length).toBe(2);
    // Sender message
    const sender = sentMessages.find((m) => m.jid.includes("9811111111"));
    expect(sender).toBeDefined();
    expect(sender.text).toContain("Your booking has been confirmed");
    expect(sender.text).toContain("Tata Ace");
    expect(sender.text).toContain("Order ID*: #8881");
    expect(sender.text).toContain("Vijay Nagar, Indore");
    expect(sender.text).toContain("Bhawarkua, Indore");

    // Receiver message
    const receiver = sentMessages.find((m) => m.jid.includes("9822222222"));
    expect(receiver).toBeDefined();
    expect(receiver.text).toContain("Aapke liye ek parcel/delivery book ki gayi hai");
    expect(receiver.text).toContain("Order ID*: #8881");
  });

  it("notifyDriverArrived sends arrival notification to both Sender and Receiver", async () => {
    await notifications.notifyDriverArrived(8881);

    expect(sentMessages.length).toBe(2);
    const sender = sentMessages.find((m) => m.jid.includes("9811111111"));
    expect(sender.text).toContain("Driver Arrived at Pickup Location");
    expect(sender.text).toContain("Suresh Patel");
    expect(sender.text).toContain("Pickup OTP*: *4321*");

    const receiver = sentMessages.find((m) => m.jid.includes("9822222222"));
    expect(receiver.text).toContain("Driver Arrived at Pickup Point");
    expect(receiver.text).toContain("Suresh Patel");
  });

  it("notifyTripStarted sends in-transit notification to both Sender and Receiver", async () => {
    await notifications.notifyTripStarted(8881);

    expect(sentMessages.length).toBe(2);
    const sender = sentMessages.find((m) => m.jid.includes("9811111111"));
    expect(sender.text).toContain("Pickup Completed — Parcel In Transit");
    expect(sender.text).toContain("Order ID*: #8881");
  });

  it("notifyTripCompleted sends delivery completed notification to both Sender and Receiver", async () => {
    await notifications.notifyTripCompleted(8881);

    expect(sentMessages.length).toBe(2);
    const sender = sentMessages.find((m) => m.jid.includes("9811111111"));
    expect(sender.text).toContain("Order Delivered Successfully");
    expect(sender.text).toContain("₹350");
  });
});
