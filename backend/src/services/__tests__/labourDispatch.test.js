const { labourLevelOf, driverCanTakeLabourOrder } = require("../labourDispatch");

describe("labourLevelOf", () => {
  test("no labour -> none", () => {
    expect(labourLevelOf({ labour_opted: false, labour_status: "none" })).toBe("none");
    expect(labourLevelOf({ labour_opted: true, labour_status: "released" })).toBe("none");
  });

  test("home small+ground only -> light", () => {
    const order = {
      labour_opted: true, labour_status: "held",
      labour_declared_json: JSON.stringify({ mode: "home", legs: [{ size: "small", floor: "ground" }] }),
    };
    expect(labourLevelOf(order)).toBe("light");
  });

  test("home medium or upper floor -> normal", () => {
    const order = {
      labour_opted: true, labour_status: "held",
      labour_declared_json: JSON.stringify({ mode: "home", legs: [{ size: "medium", floor: "f1_2" }] }),
    };
    expect(labourLevelOf(order)).toBe("normal");
  });

  test("shop q15+shutter -> light; bigger -> normal", () => {
    const light = { labour_opted: true, labour_status: "held", labour_declared_json: JSON.stringify({ mode: "shop", legs: [{ qty: "q15", access: "shutter" }] }) };
    const normal = { labour_opted: true, labour_status: "held", labour_declared_json: JSON.stringify({ mode: "shop", legs: [{ qty: "q15_40", access: "stack_inside" }] }) };
    expect(labourLevelOf(light)).toBe("light");
    expect(labourLevelOf(normal)).toBe("normal");
  });
});

describe("driverCanTakeLabourOrder", () => {
  test("no-labour order: everyone, including drive_only", () => {
    expect(driverCanTakeLabourOrder("drive_only", "none")).toBe(true);
    expect(driverCanTakeLabourOrder("light_only", "none")).toBe(true);
    expect(driverCanTakeLabourOrder("full_loader", "none")).toBe(true);
  });

  test("light labour: light_only and full_loader, never drive_only", () => {
    expect(driverCanTakeLabourOrder("drive_only", "light")).toBe(false);
    expect(driverCanTakeLabourOrder("light_only", "light")).toBe(true);
    expect(driverCanTakeLabourOrder("full_loader", "light")).toBe(true);
  });

  test("normal labour: only full_loader", () => {
    expect(driverCanTakeLabourOrder("drive_only", "normal")).toBe(false);
    expect(driverCanTakeLabourOrder("light_only", "normal")).toBe(false);
    expect(driverCanTakeLabourOrder("full_loader", "normal")).toBe(true);
  });

  test("unknown/missing driver mode defaults to drive_only (safe)", () => {
    expect(driverCanTakeLabourOrder(undefined, "light")).toBe(false);
    expect(driverCanTakeLabourOrder(null, "none")).toBe(true);
  });
});
