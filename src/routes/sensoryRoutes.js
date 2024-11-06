const express = require("express");
const router = express.Router();

const sensoryController = require("../controllers/sensoryController");
const verifyToken = require("../middleware/authMiddleware.js");

router.post("/", verifyToken, sensoryController.createSensory);

module.exports = router;