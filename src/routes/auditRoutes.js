const express = require("express");
const router = express.Router();
const { getAuditLogs } = require("../controllers/auditController.js");
const verifyToken = require("../middleware/authMiddleware.js");
const allowRoles = require("../middleware/roleMiddleware.js");

router.get("/", verifyToken, allowRoles("MANAGER"), getAuditLogs);

module.exports = router;
