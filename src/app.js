const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const experimentRoutes = require("./routes/experimentRoutes.js");
const questionRoutes = require("./routes/questionRoutes.js");
const aiRoutes = require("./routes/aiRoutes.js");
const sensoryRoutes = require("./routes/sensoryRoutes.js");
const authRoutes = require("./routes/authRoutes.js");
const auditRoutes = require("./routes/auditRoutes.js");
const cors = require("cors");

const app = express();

const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://168.231.69.231:9000",
  "http://192.168.137.1:5173",
  "http://192.168.1.3:5173",
];

// CLIENT_ORIGINS may contain a comma-separated list. Keep the defaults too,
// so adding a deployed frontend does not accidentally disable local access.
const allowedOrigins = [
  ...defaultOrigins,
  ...(process.env.CLIENT_ORIGINS || "").split(","),
]
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean)
  .filter((origin, index, origins) => origins.indexOf(origin) === index);

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser requests do not send an Origin header.
      const normalizedOrigin = origin?.replace(/\/$/, "");
      if (!origin || allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

console.log("CORS allowed origins:", allowedOrigins);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/experiment", experimentRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/sensory", sensoryRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);

// Global error handler — must be AFTER all routes
app.use((err, req, res, next) => {
  console.error("[Global Error]:", err);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

module.exports = app;
