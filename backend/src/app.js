const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/user.routes");
const orderRoutes = require("./routes/orderRoutes");
const riderRoutes = require("./routes/riderRoutes");
const logger = require("./utils/logger");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/users", userRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/rider", riderRoutes);

// Safety net beyond each controller's own try/catch — never leak stack traces.
app.use((err, req, res, next) => {
  logger.error("Unhandled Express error:", err);
  res.status(500).json({ Result: false, msg: "Internal server error" });
});

module.exports = app;
