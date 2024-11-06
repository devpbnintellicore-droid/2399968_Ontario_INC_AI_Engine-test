const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const verifyToken = require('../middleware/authMiddleware');
const allowRoles = require("../middleware/roleMiddleware");

router.post("/analyze", verifyToken, allowRoles("MANAGER", "REVIEWER"), aiController.analyzeExperimentAI);

router.post("/analyze-recipe", verifyToken, allowRoles("MANAGER", "REVIEWER"), aiController.analyzeRecipeAI);
router.get("/generate-report/:recipeName", verifyToken, allowRoles("MANAGER", "REVIEWER"), aiController.generateRecipeReport);
router.post("/generate-report/:recipeName", verifyToken, allowRoles("MANAGER", "REVIEWER"), aiController.generateRecipeReport);
router.post("/compare-versions", verifyToken, allowRoles("MANAGER", "REVIEWER"), aiController.compareVersionsAI);
router.get("/portfolio-report", verifyToken, allowRoles("MANAGER"), aiController.portfolioAnalytics);

module.exports = router;
