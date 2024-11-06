const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");
const allowRoles = require("../middleware/roleMiddleware");

router.post("/create-staff", verifyToken, allowRoles("MANAGER"), authController.createStaff);
router.post("/login", authController.login);
router.put("/staff/:id", verifyToken, allowRoles("MANAGER"), authController.updateStaff);
router.delete("/staff/:id", verifyToken, allowRoles("MANAGER"), authController.deleteStaff);
router.get("/staff", verifyToken, allowRoles("MANAGER"), authController.getAllStaff);
router.get("/check-status", verifyToken, (req, res) => res.json({ success: true, status: "ACTIVE" }));
router.get("/stats", verifyToken, allowRoles("MANAGER"), authController.getStaffStats);
router.post("/change-password", verifyToken, authController.changePassword);

module.exports = router;
