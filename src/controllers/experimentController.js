const { asyncHandler } = require("../utils/asyncHandler.js");
const experimentService = require("../services/experimentService.js");
const { success } = require("../utils/apiResponse.js");
const { createExperimentSchema } = require("../validations/experimentValidation.js");

const createExperiment = asyncHandler(async (req, res) => {
  const chefId = req.user.id;

  if (req.user.role !== "CHEF" && req.user.role !== "MANAGER") {
    return res.status(403).json({
      success: false,
      message: "Only chefs and managers can create experiments"
    });
  }

  const imageUrls = (req.files || []).map(file => file.path);

  if (imageUrls.length > 3) {
    return res.status(400).json({
      success: false,
      message: "Maximum 3 images allowed"
    });
  }

  // Image upload is currently disabled on the recipe page.
  // if (!req.files || req.files.length === 0) {
  //   return res.status(400).json({
  //     success: false,
  //     message: "At least 1 image is required"
  //   });
  // }
  let ingredients = req.body.ingredients;

  if (typeof ingredients === "string") {
    try {
      ingredients = JSON.parse(ingredients);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: "Invalid ingredients format (must be valid JSON)"
      });
    }
  }

  if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one ingredient is required"
    });
  }

  const payload = {
    ...req.body,
    ingredients,
    imageUrls,
    chefId
  };

  const { error, value } = createExperimentSchema.validate(payload, {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details.map(e => e.message).join(", ")
    });
  }

  const experiment = await experimentService.createExperimentService(value, {
    ipAddress: req.ip,
  });

  return success(res, experiment, "Experiment Created");
});

const getAllExperiments = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;

  let chefId;
  const userRole = req.user.role?.toUpperCase();
  if (userRole === "CHEF") {
    chefId = Number(req.user.id);
  }

  const experiments = await experimentService.getAllExperimentsService({
    search,
    page: Number(page) || 1,
    limit: Number(limit) || 1000,
    chefId
  });

  success(res, experiments, "Experiments retrieved successfully");
});

const getNextVersionController = asyncHandler(async (req, res) => {
  let { name, bump } = req.query;

  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Recipe name is required"
    });
  }


  // ✅ FIX: handle both boolean & string
  const isBump = String(bump) === "true";

  // console.log("Recipe:", name, "| Bump:", isBump);

  let chefId;
  const userRole = req.user.role?.toUpperCase();
  if (userRole === "CHEF") {
    chefId = Number(req.user.id);
  }

  const version = await experimentService.getNextVersion(name, isBump, chefId);

  return res.json({
    success: true,
    version: version || "1.0"
  });
});

const getRecipeHistory = asyncHandler(async (req, res) => {
  const { name, page, limit } = req.query;

  if (!name) {
    return res.status(400).json({ message: "Recipe name is required" });
  }

  let chefId;
  const userRole = req.user.role?.toUpperCase();
  if (userRole === "CHEF") {
    chefId = Number(req.user.id);
  }

  const history = await experimentService.getRecipeHistoryService(name, {
    page: Number(page) || 1,
    limit: Number(limit) || 1000,
    chefId
  });

  success(res, history, "Recipe history fetched successfully");
});

const getRecipeSuggestions = asyncHandler(async (req, res) => {
  const { search, limit } = req.query;
  const suggestions = await experimentService.getRecipeSuggestionsService({
    search: String(search || "").trim(),
    limit: Number(limit) || 5,
  });
  return success(res, suggestions, "Recipe suggestions fetched successfully");
});

const getIngredientSuggestions = asyncHandler(async (req, res) => {
  const { search, limit } = req.query;
  const suggestions = await experimentService.getIngredientSuggestionsService({
    search: String(search || "").trim(),
    limit: Number(limit) || 5,
  });
  return success(res, suggestions, "Ingredient suggestions fetched successfully");
});

const addIngredient = asyncHandler(async (req, res) => {
  const { name, unit } = req.body;
  const ingredientName = String(name || "").trim();
  const ingredientUnit = String(unit || "").trim() || "g";

  if (!ingredientName) {
    return res.status(400).json({
      success: false,
      message: "Ingredient name is required",
    });
  }

  const ingredient = await experimentService.addIngredientToCatalogService(
    ingredientName,
    ingredientUnit,
    req.user?.id ?? null,
    { ipAddress: req.ip },
  );

  return success(res, ingredient, "Ingredient added successfully");
});

const deleteIngredient = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const ingredient = await experimentService.deleteIngredientFromCatalogService(
    Number(id),
    req.user?.id ?? null,
    { ipAddress: req.ip },
  );

  if (!ingredient) {
    return res.status(404).json({
      success: false,
      message: "Ingredient not found",
    });
  }

  return success(res, ingredient, "Ingredient deleted successfully");
});

const getAllIngredients = asyncHandler(async (req, res) => {
  const ingredients = await experimentService.getAllIngredientsFromCatalogService();
  return success(res, ingredients, "All ingredients fetched successfully");
});

const getReviewerDashboard = asyncHandler(async (req, res) => {
  const data = await experimentService.getReviewerDashboardData();
  return success(res, data, "Reviewer dashboard fetched successfully");
});

const getManagerDashboard = asyncHandler(async (req, res) => {
  const data = await experimentService.getManagerDashboardData({
    year: req.query.year,
  });
  return success(res, data, "Manager dashboard fetched successfully");
});

const getAllReviews = asyncHandler(async (req, res) => {
  const { search, status, page, limit } = req.query;
  const data = await experimentService.getAllReviewsService({
    search,
    status,
    page: Number(page) || 1,
    limit: Number(limit) || 1000,
  });
  return success(res, data, "All reviews fetched successfully");
});

const getDashboard = asyncHandler(async (req, res) => {
  let chefId;
  const userRole = req.user.role?.toUpperCase();
  if (userRole === "CHEF") {
    chefId = Number(req.user.id);
  }

  const data = await experimentService.getDashboardData(chefId);

  return success(res, data, "Dashboard fetched successfully");
});

const getAllRecipes = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;

  let chefId;
  const userRole = req.user.role?.toUpperCase();
  if (userRole === "CHEF") {
    chefId = Number(req.user.id);
  }

  const data = await experimentService.getAllRecipesService({
    search,
    page: Number(page) || 1,
    limit: Number(limit) || 1000,
    chefId
  });
  return success(res, data, "All recipes fetched successfully");
});

const approveExperiment = asyncHandler(async (req, res) => {
  const data = await experimentService.approveExperimentService(
    Number(req.params.id),
    req.user?.id ?? null,
    { ipAddress: req.ip },
  );
  return success(res, data, "Experiment approved successfully");
});

const rejectExperiment = asyncHandler(async (req, res) => {
  const data = await experimentService.rejectExperimentService(
    Number(req.params.id),
    req.user?.id ?? null,
    { ipAddress: req.ip },
    req.body?.reason || "",
  );
  return success(res, data, "Experiment rejected successfully");
});

const completeExperiment = asyncHandler(async (req, res) => {
  const data = await experimentService.completeExperimentService(
    Number(req.params.id),
    req.user?.id ?? null,
    { ipAddress: req.ip },
  );
  return success(res, data, "Experiment completed successfully");
});

const updateRemarks = asyncHandler(async (req, res) => {
  const { remarks, reason } = req.body;
  const data = await experimentService.updateRemarksService(
    Number(req.params.id),
    remarks,
    reason,
    req.user?.id ?? null,
    { ipAddress: req.ip }
  );
  return success(res, data, "Remarks updated successfully");
});

module.exports = {
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
  updateRemarks
};
