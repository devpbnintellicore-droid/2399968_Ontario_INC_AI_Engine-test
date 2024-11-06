const express = require("express");
const {
  createExperiment,
  getAllExperiments,
  getNextVersionController,
  getRecipeHistory,
  getDashboard,
  getReviewerDashboard,
  getManagerDashboard,
  getAllReviews,
  getRecipeSuggestions,
  getIngredientSuggestions,
  addIngredient,
  deleteIngredient,
  getAllIngredients,
  getAllRecipes,
  approveExperiment,
  rejectExperiment,
  completeExperiment,
  updateRemarks,
} = require("../controllers/experimentController.js");

const verifyToken = require("../middleware/authMiddleware.js");
const allowRoles = require("../middleware/roleMiddleware.js");
const upload = require("../middleware/uploadMiddleware.js");

const router = express.Router();

router.post(
  "/",
  verifyToken,
  allowRoles("CHEF", "MANAGER"),
  upload.array("images", 3),
  createExperiment,
);
router.get("/", verifyToken, getAllExperiments);
router.get("/version", verifyToken, getNextVersionController);
router.get("/history", verifyToken, getRecipeHistory);
router.get("/recipe-suggestions", verifyToken, getRecipeSuggestions);
router.get("/ingredient-suggestions", verifyToken, getIngredientSuggestions);
router.post("/ingredients", verifyToken, addIngredient);
router.delete("/ingredients/:id", verifyToken, deleteIngredient);
router.get("/ingredients", verifyToken, getAllIngredients);
router.get("/dashboard", verifyToken, getDashboard);
router.get(
  "/reviewer-dashboard",
  verifyToken,
  allowRoles("REVIEWER", "MANAGER"),
  getReviewerDashboard,
);
router.get(
  "/manager-dashboard",
  verifyToken,
  // CRA has read-only compliance visibility on the dashboard. Keep all
  // manager-only mutations and administration routes protected separately.
  allowRoles("MANAGER", "CRA"),
  getManagerDashboard,
);
router.get(
  "/reviews",
  verifyToken,
  allowRoles("REVIEWER", "MANAGER"),
  getAllReviews,
);
router.get("/all-recipes", verifyToken, getAllRecipes);
router.post(
  "/:id/approve",
  verifyToken,
  allowRoles("REVIEWER", "MANAGER"),
  approveExperiment,
);
router.post(
  "/:id/reject",
  verifyToken,
  allowRoles("REVIEWER", "MANAGER"),
  rejectExperiment,
);
router.post(
  "/:id/complete",
  verifyToken,
  allowRoles("MANAGER"),
  completeExperiment,
);
router.put(
  "/:id/remarks",
  verifyToken,
  allowRoles("CHEF", "MANAGER"),
  updateRemarks,
);
// router.get("/:id", verifyToken, getExperimentById);

module.exports = router;
