const { prisma } = require("../config/db.js");
const { createAuditLog } = require("../utils/auditLogger.js");
const {
  assertWorkflowTransition,
  buildMonthlyExperimentChart,
  buildYearlyMonthlyExperimentChart,
  buildRecipeSnapshot,
  diffRecipeSnapshots,
  formatBatchId,
  formatPublicId,
  formatVersionLabel,
  evaluateTextureAcceptance,
  buildYieldDeviationEvidence,
  getAiScoreState,
  getNextRecipeVersion,
} = require("../utils/auditReadiness.js");

const getExperimentPublicId = (exp) =>
  exp.publicId || formatPublicId("EXP", exp.id, exp.createdAt);

const getExperimentBatchId = (exp) =>
  exp.batchPublicId || formatBatchId(exp.id, exp.createdAt);

const lifecycleSnapshot = (exp) => ({
  status: exp.status,
  submittedAt: exp.submittedAt,
  reviewedAt: exp.reviewedAt,
  approvedAt: exp.approvedAt,
  rejectedAt: exp.rejectedAt,
  completedAt: exp.completedAt,
  submittedById: exp.submittedById,
  reviewedById: exp.reviewedById,
  approvedById: exp.approvedById,
  rejectedById: exp.rejectedById,
});

const calculateAiScore = (evaluation) => {
  if (!evaluation) return null;
  const scores = [
    evaluation.tasteConsistency,
    evaluation.aromaticVolatility,
    evaluation.sodiumProjection,
    evaluation.chromaticAppeal,
    evaluation.structuralIntegrity,
    evaluation.scovillePerception,
    evaluation.lipidSaturation,
    evaluation.cellularFreshness,
    evaluation.palatePersistence,
  ].filter((v) => v != null);
  if (!scores.length) return null;
  return Math.round(
    (scores.reduce((a, b) => a + b, 0) / (scores.length * 10)) * 100,
  );
};

const getNextVersion = async (recipeName, isBump = false, chefId = null) => {
  const last = await prisma.cookingExperiment.findFirst({
    where: {
      recipeName,
      // ...(chefId ? { chefId: Number(chefId) } : {})
    },
    orderBy: { createdAt: "desc" },
  });

  return getNextRecipeVersion(last?.recipeVersion, isBump);
};

const getOrCreateRecipe = async (recipeName, tx) => {
  if (!recipeName || !recipeName.trim()) return null;
  const cleanName = String(recipeName).trim();

  return await tx.recipe.upsert({
    where: { name: cleanName },
    update: {},
    create: { name: cleanName },
  });
};

const upsertIngredientCatalogEntry = async (name, unit, tx) => {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;
  const cleanUnit = String(unit ?? "").trim();

  return await tx.ingredientCatalog.upsert({
    where: { name: cleanName },
    update: cleanUnit ? { unit: cleanUnit } : {},
    create: { name: cleanName, unit: cleanUnit || "g" },
  });
};

const createExperimentService = async (data, auditContext = {}) => {
  const isBump = data.isBump === true;

  const experiment = await prisma.$transaction(async (tx) => {
    const last = await tx.cookingExperiment.findFirst({
      where: {
        recipeName: data.recipeName,
        // ...(data.chefId ? { chefId: Number(data.chefId) } : {})
      },
      orderBy: { createdAt: "desc" },
    });

    const recipeVersion = getNextRecipeVersion(last?.recipeVersion, isBump);

    const recipe = await getOrCreateRecipe(data.recipeName, tx);

    const existingVersion = await tx.cookingExperiment.findFirst({
      where: {
        recipeName: data.recipeName,
        recipeVersion: recipeVersion,
      },
    });

    if (existingVersion) {
      const error = new Error(
        `Version ${recipeVersion} already exists for recipe "${data.recipeName}"`,
      );
      error.statusCode = 400;
      throw error;
    }

    const ingredientMap = new Map();
    (data.ingredients || []).forEach((ing) => {
      const name = String(ing.name || "").trim();
      const unit = String(ing.unit || "").trim() || "g";
      if (!name) return;
      if (!ingredientMap.has(name)) ingredientMap.set(name, unit);
    });

    await Promise.all(
      Array.from(ingredientMap.entries()).map(([name, unit]) =>
        upsertIngredientCatalogEntry(name, unit, tx),
      ),
    );

    const created = await tx.cookingExperiment.create({
      data: {
        recipeId: recipe?.id,
        recipeName: data.recipeName,
        recipeVersion,
        experimentDate: data.experimentDate
          ? new Date(data.experimentDate)
          : null,
        experimentTime: data.experimentTime,
        temperature: data.temperature ? Number(data.temperature) : null,
        duration: data.duration ? Number(data.duration) : null,
        expectedTexture: data.expectedTexture,
        achievedTexture: data.achievedTexture,
        expectedOutput: data.expectedOutput
          ? Number(data.expectedOutput)
          : null,
        actualOutput: data.actualOutput ? Number(data.actualOutput) : null,
        remarks: data.remarks,
        status: "SUBMITTED",
        aiStatus: "PENDING_ANALYSIS",
        textureAcceptanceThreshold: 0,
        textureAcceptanceResult: evaluateTextureAcceptance(
          data.expectedTexture,
          data.achievedTexture,
          0,
        ).result,
        submittedAt: new Date(),
        submittedById: data.chefId,
        chefId: data.chefId,
        ingredients: {
          create: (data.ingredients || []).map((ing) => ({
            name: ing.name,
            quantity: Number(ing.quantity) || 0,
            unit: ing.unit,
          })),
        },
        images: {
          create: (data.imageUrls || []).map((url) => ({ imageUrl: url })),
        },
        ...(data.remarks
          ? {
              ChefNoteHistory: {
                create: {
                  oldValue: null,
                  newValue: data.remarks,
                  reason: "Initial chef note",
                  modifiedBy: data.chefId ?? null,
                },
              },
            }
          : {}),
      },
      include: { ingredients: true, images: true },
    });

    const publicId = formatPublicId("EXP", created.id, created.createdAt);
    const batchPublicId = formatBatchId(created.id, created.createdAt);
    const recipePublicId =
      recipe?.publicId ||
      (recipe ? formatPublicId("REC", recipe.id, recipe.createdAt) : null);

    if (recipe && !recipe.publicId) {
      await tx.recipe.update({
        where: { id: recipe.id },
        data: { publicId: recipePublicId },
      });
    }

    const updated = await tx.cookingExperiment.update({
      where: { id: created.id },
      data: { publicId, batchPublicId },
      include: { ingredients: true, images: true },
    });

    const oldSnapshot = last
      ? buildRecipeSnapshot({
          ...last,
          ingredients: await tx.ingredient.findMany({
            where: { experimentId: last.id },
            select: { name: true, quantity: true, unit: true },
          }),
        })
      : null;
    const newSnapshot = buildRecipeSnapshot(updated);
    const changes = diffRecipeSnapshots(oldSnapshot, newSnapshot);

    await tx.recipeVersion.create({
      data: {
        recipeId: recipe?.id ?? null,
        experimentId: updated.id,
        version: updated.recipeVersion,
        changeSummary: changes.join(", "),
        oldValue: oldSnapshot,
        newValue: newSnapshot,
        modifiedBy: data.chefId ?? null,
        modifiedAt: updated.createdAt,
      },
    });

    return updated;
  });

  await createAuditLog(prisma, {
    action: "CREATED",
    entity: "Experiment",
    entityId: experiment.id,
    entityLabel: experiment.publicId,
    description: `${experiment.publicId} generated automatically for ${experiment.recipeName} ${formatVersionLabel(experiment.recipeVersion)}`,
    userId: data.chefId ?? null,
    oldValue: null,
    newValue: buildRecipeSnapshot(experiment),
    ipAddress: auditContext.ipAddress,
  });

  await createAuditLog(prisma, {
    action: "SUBMITTED",
    entity: "Experiment",
    entityId: experiment.id,
    entityLabel: experiment.publicId,
    description: `${experiment.publicId} submitted for review`,
    userId: data.chefId ?? null,
    oldValue: { status: "DRAFT" },
    newValue: lifecycleSnapshot(experiment),
    ipAddress: auditContext.ipAddress,
  });

  return experiment;
};

const getAllExperimentsService = async ({ search, page, limit, chefId }) => {
  const skip = (page - 1) * limit;

  const where = {
    ...(search
      ? { recipeName: { contains: search, mode: "insensitive" } }
      : {}),
    ...(chefId ? { chefId: Number(chefId) } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.cookingExperiment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        publicId: true,
        batchPublicId: true,
        recipeName: true,
        recipeVersion: true,
        experimentDate: true,
        experimentTime: true,
        temperature: true,
        duration: true,
        expectedTexture: true,
        achievedTexture: true,
        expectedOutput: true,
        actualOutput: true,
        remarks: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        reviewedAt: true,
        approvedAt: true,
        rejectedAt: true,
        completedAt: true,
        aiStatus: true,
        aiAnalysisId: true,
        aiModelVersion: true,
        aiDataSource: true,
        aiConfidenceScore: true,
        aiGeneratedAt: true,
        aiGeneratedBy: true,
        aiResult: true,
        aiReason: true,
        expectedAroma: true,
        actualAroma: true,
        expectedFlavor: true,
        actualFlavor: true,
        expectedAppearance: true,
        actualAppearance: true,
        reviewComments: true,
        approvalDecision: true,
        approvalReason: true,
        aiKeyTakeaways: true,
        aiImprovementAreas: true,
        aiRecommendationStatus: true,
        textureAcceptanceThreshold: true,
        textureAcceptanceResult: true,
        submittedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
        chef: { select: { id: true, name: true, role: true } },
        images: { select: { imageUrl: true } },
        ingredients: { select: { name: true, quantity: true, unit: true } },
        sensoryEvaluations: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            tasteConsistency: true,
            aromaticVolatility: true,
            sodiumProjection: true,
            chromaticAppeal: true,
            structuralIntegrity: true,
            scovillePerception: true,
            lipidSaturation: true,
            cellularFreshness: true,
            palatePersistence: true,
            reviewer: { select: { name: true } },
          },
        },
        _count: {
          select: {
            ingredients: true,
            sensoryEvaluations: true,
            reviewAnswers: true,
          },
        },
        aiAnalysisRecord: {
          include: {
            retries: { orderBy: { retryTime: "asc" } },
            failures: { orderBy: { failureTime: "asc" } },
          },
        },
      },
    }),
    prisma.cookingExperiment.count({ where }),
  ]);

  const mappedData = data.map((exp) => ({
    ...exp,
    publicId: getExperimentPublicId(exp),
    batchPublicId: getExperimentBatchId(exp),
    aiScore: calculateAiScore(exp.sensoryEvaluations?.[0]),
    aiScoreState: getAiScoreState({
      score: calculateAiScore(exp.sensoryEvaluations?.[0]),
      aiStatus: exp.aiStatus,
      status: exp.status,
    }),
    textureAcceptance:
      exp.textureAcceptanceResult ||
      evaluateTextureAcceptance(
        exp.expectedTexture,
        exp.achievedTexture,
        exp.textureAcceptanceThreshold ?? 0,
      ).result,
    yieldDeviation: buildYieldDeviationEvidence(exp.expectedOutput, exp.actualOutput),
  }));

  return {
    data: mappedData,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

const getRecipeSuggestionsService = async ({ search, limit = 15 } = {}) => {
  const where = search
    ? { name: { contains: search, mode: "insensitive" } }
    : {};

  const recipes = await prisma.recipe.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: { name: true },
  });

  if (recipes.length > 0) {
    return recipes.map((recipe) => recipe.name);
  }

  // Fallback for existing data before recipe table migration is fully populated
  const experiments = await prisma.cookingExperiment.findMany({
    where: search
      ? { recipeName: { contains: search, mode: "insensitive" } }
      : {},
    distinct: ["recipeName"],
    take: limit,
    orderBy: { recipeName: "asc" },
    select: { recipeName: true },
  });

  return Array.from(
    new Set(
      experiments
        .map((exp) => String(exp.recipeName || "").trim())
        .filter(Boolean),
    ),
  );
};

const getIngredientSuggestionsService = async ({ search, limit = 15 } = {}) => {
  const where = search
    ? { name: { contains: search, mode: "insensitive" } }
    : {};

  const catalogIngredients = await prisma.ingredientCatalog.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: { name: true, unit: true },
  });

  const experimentIngredients = await prisma.ingredient.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: { name: true, unit: true },
  });

  const suggestions = Array.from(
    new Map(
      [...catalogIngredients, ...experimentIngredients].map((item) => [
        String(item.name || "")
          .trim()
          .toLowerCase(),
        {
          name: String(item.name || "").trim(),
          unit: String(item.unit || "g").trim() || "g",
        },
      ]),
    ).values(),
  );

  return suggestions.slice(0, limit);
};

const getExperimentByIdService = async (id) => {
  return await prisma.cookingExperiment.findUnique({
    where: { id },
    include: {
      chef: { select: { id: true, name: true } },
      ingredients: true,
      images: true,
      reviewAnswers: {
        include: { question: { select: { question: true } } },
      },
      sensoryEvaluations: { orderBy: { createdAt: "desc" } },
    },
  });
};

const transitionExperimentWorkflow = async (
  id,
  nextStatus,
  actorId,
  auditContext = {},
  reason = "",
) => {
  const existing = await prisma.cookingExperiment.findUnique({
    where: { id: Number(id) },
  });
  if (!existing) {
    const error = new Error("Experiment not found");
    error.statusCode = 404;
    throw error;
  }

  assertWorkflowTransition(existing.status, nextStatus);

  const now = new Date();
  const data = { status: nextStatus };
  if (nextStatus === "UNDER_REVIEW") {
    data.reviewedAt = existing.reviewedAt || now;
    data.reviewedById = actorId;
  }
  if (nextStatus === "APPROVED") {
    data.reviewedAt = existing.reviewedAt || now;
    data.reviewedById = existing.reviewedById || actorId;
    data.approvedAt = now;
    data.approvedById = actorId;
  }
  if (nextStatus === "REJECTED") {
    data.reviewedAt = existing.reviewedAt || now;
    data.reviewedById = existing.reviewedById || actorId;
    data.rejectedAt = now;
    data.rejectedById = actorId;
  }
  if (nextStatus === "COMPLETED") {
    data.completedAt = now;
  }

  const updated = await prisma.cookingExperiment.update({
    where: { id: Number(id) },
    data,
  });

  await createAuditLog(prisma, {
    action: nextStatus,
    entity: "Experiment",
    entityId: updated.id,
    entityLabel: getExperimentPublicId(updated),
    description:
      reason || `Experiment moved from ${existing.status} to ${nextStatus}`,
    userId: actorId ?? null,
    oldValue: lifecycleSnapshot(existing),
    newValue: lifecycleSnapshot(updated),
    ipAddress: auditContext.ipAddress,
  });

  return updated;
};

const markExperimentUnderReviewService = async (
  id,
  reviewerId,
  auditContext = {},
) => {
  const existing = await prisma.cookingExperiment.findUnique({
    where: { id: Number(id) },
  });
  if (!existing || existing.status !== "SUBMITTED") return existing;
  return transitionExperimentWorkflow(
    id,
    "UNDER_REVIEW",
    reviewerId,
    auditContext,
    `${getExperimentPublicId(existing)} moved under review`,
  );
};

const approveExperimentService = async (id, actorId, auditContext = {}) => {
  const existing = await prisma.cookingExperiment.findUnique({
    where: { id: Number(id) },
    include: {
      sensoryEvaluations: { select: { id: true } },
      reviewAnswers: { select: { id: true } },
    },
  });

  if (!existing) {
    const error = new Error("Experiment not found");
    error.statusCode = 404;
    throw error;
  }

  if (!existing.sensoryEvaluations.length || !existing.reviewAnswers.length) {
    const error = new Error("Cannot approve without sensory review and compliance answer evidence");
    error.statusCode = 400;
    throw error;
  }

  if (existing?.status === "SUBMITTED") {
    await transitionExperimentWorkflow(
      id,
      "UNDER_REVIEW",
      actorId,
      auditContext,
      `${getExperimentPublicId(existing)} moved under review before approval`,
    );
  }

  return transitionExperimentWorkflow(
    id,
    "APPROVED",
    actorId,
    auditContext,
    `Experiment ${id} approved with reviewer evidence`,
  );
};

const rejectExperimentService = async (
  id,
  actorId,
  auditContext = {},
  reason = "",
) => {
  return transitionExperimentWorkflow(
    id,
    "REJECTED",
    actorId,
    auditContext,
    reason || `Experiment ${id} rejected with reviewer evidence`,
  );
};

const completeExperimentService = async (id, actorId, auditContext = {}) => {
  return transitionExperimentWorkflow(
    id,
    "COMPLETED",
    actorId,
    auditContext,
    `Experiment ${id} completed after approval`,
  );
};

const updateRemarksService = async (
  id,
  newRemarks,
  reason,
  actorId,
  auditContext = {},
) => {
  const existing = await prisma.cookingExperiment.findUnique({
    where: { id: Number(id) },
  });

  if (!existing) {
    const error = new Error("Experiment not found");
    error.statusCode = 404;
    throw error;
  }

  if (existing.status === "APPROVED" || existing.status === "COMPLETED") {
    const error = new Error("Cannot edit remarks after approval or completion");
    error.statusCode = 403;
    throw error;
  }

  const updated = await prisma.cookingExperiment.update({
    where: { id: Number(id) },
    data: {
      remarks: newRemarks,
      ChefNoteHistory: {
        create: {
          oldValue: existing.remarks,
          newValue: newRemarks,
          reason: reason || "No reason provided",
          modifiedBy: actorId ?? null,
        },
      },
    },
  });

  await createAuditLog(prisma, {
    action: "NOTE_EDITED",
    entity: "Experiment",
    entityId: updated.id,
    entityLabel: getExperimentPublicId(updated),
    description: `Chef note edited. Reason: ${reason || "No reason provided"}`,
    userId: actorId ?? null,
    oldValue: { remarks: existing.remarks },
    newValue: { remarks: updated.remarks },
    ipAddress: auditContext.ipAddress,
  });

  return updated;
};

const getRecipeHistoryService = async (
  recipeName,
  { page = 1, limit = 1000, chefId } = {},
) => {
  const skip = (page - 1) * limit;
  const trimmedName = recipeName.trim();

  const where = {
    recipeName: { equals: trimmedName, mode: "insensitive" },
    ...(chefId ? { chefId: Number(chefId) } : {}),
  };

  const [experiments, total] = await Promise.all([
    prisma.cookingExperiment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        reviewAnswers: {
          include: { question: { select: { question: true } } },
        },
        sensoryEvaluations: {
          orderBy: { createdAt: "desc" },
          include: {
            reviewer: {
              select: { name: true },
            },
          },
        },
        chef: { select: { id: true, name: true } },
        submittedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
        ingredients: true,
        images: true,
        RecipeVersion: true,
        ChefNoteHistory: {
          orderBy: { modifiedAt: "desc" },
        },
        ReviewConclusion: true,
      },
    }),
    prisma.cookingExperiment.count({ where }),
  ]);

  const data = experiments.map((exp) => {
    const latestEvaluation = exp.sensoryEvaluations[0];

    let score = null;
    if (latestEvaluation) {
      const fields = [
        latestEvaluation.tasteConsistency,
        latestEvaluation.aromaticVolatility,
        latestEvaluation.sodiumProjection,
        latestEvaluation.chromaticAppeal,
        latestEvaluation.structuralIntegrity,
        latestEvaluation.scovillePerception,
        latestEvaluation.lipidSaturation,
        latestEvaluation.cellularFreshness,
        latestEvaluation.palatePersistence,
      ].filter((v) => v != null);

      if (fields.length > 0) {
        score = Math.round(
          (fields.reduce((a, b) => a + b, 0) / fields.length) * 10,
        );
      }
    }

    return {
      id: exp.id,
      publicId: getExperimentPublicId(exp),
      batchPublicId: getExperimentBatchId(exp),
      recipeName: exp.recipeName,
      recipeVersion: exp.recipeVersion,
      chefName: exp.chef?.name || null,
      submittedBy: exp.submittedBy,
      reviewedBy: exp.reviewedBy,
      approvedBy: exp.approvedBy,
      rejectedBy: exp.rejectedBy,
      createdAt: exp.createdAt,
      temperature: exp.temperature,
      duration: exp.duration,
      expectedOutput: exp.expectedOutput,
      actualOutput: exp.actualOutput,
      yieldDeviation: buildYieldDeviationEvidence(exp.expectedOutput, exp.actualOutput),
      remarks: exp.remarks,
      ingredients: exp.ingredients,
      images: exp.images,
      sensoryEvaluations: exp.sensoryEvaluations,
      reviewAnswers: exp.reviewAnswers,
      status: exp.status,
      score,
      aiScoreState: getAiScoreState({
        score,
        aiStatus: exp.aiStatus,
        status: exp.status,
      }),
      submittedAt: exp.submittedAt,
      reviewedAt: exp.reviewedAt,
      approvedAt: exp.approvedAt,
      rejectedAt: exp.rejectedAt,
      completedAt: exp.completedAt,
      noteHistory: exp.ChefNoteHistory,
      reviewConclusion: exp.ReviewConclusion,
      versionHistory: exp.RecipeVersion
        ? {
            version: formatVersionLabel(exp.RecipeVersion.version),
            changeSummary: exp.RecipeVersion.changeSummary,
            oldValue: exp.RecipeVersion.oldValue,
            newValue: exp.RecipeVersion.newValue,
            modifiedBy: exp.chef?.name || null,
            modifiedAt: exp.RecipeVersion.modifiedAt,
          }
        : null,
    };
  });

  return {
    data,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

const normalizeChartYear = (year) => {
  const parsed = Number.parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > currentYear + 1) {
    return currentYear;
  }
  return parsed;
};

const getChartYearOptions = async (whereCondition = {}) => {
  const [firstExperiment, latestExperiment] = await Promise.all([
    prisma.cookingExperiment.findFirst({
      where: whereCondition,
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cookingExperiment.findFirst({
      where: whereCondition,
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const currentYear = new Date().getFullYear();
  const firstYear = firstExperiment?.createdAt
    ? new Date(firstExperiment.createdAt).getFullYear()
    : currentYear;
  const latestYear = latestExperiment?.createdAt
    ? new Date(latestExperiment.createdAt).getFullYear()
    : currentYear;
  const startYear = Math.min(firstYear, currentYear);
  const endYear = Math.max(latestYear, currentYear);

  return Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => endYear - index,
  );
};

const getMonthlyChartData = async (whereCondition = {}, year = null) => {
  if (year) {
    const chartYear = normalizeChartYear(year);
    const startOfYear = new Date(chartYear, 0, 1);
    const startOfNextYear = new Date(chartYear + 1, 0, 1);

    const experiments = await prisma.cookingExperiment.findMany({
      where: {
        ...whereCondition,
        createdAt: { gte: startOfYear, lt: startOfNextYear },
      },
      select: {
        createdAt: true,
        reviewAnswers: { select: { id: true } },
        sensoryEvaluations: { select: { id: true } },
      },
    });

    return buildYearlyMonthlyExperimentChart(experiments, chartYear);
  }

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const experiments = await prisma.cookingExperiment.findMany({
    where: {
      ...whereCondition,
      createdAt: { gte: sixMonthsAgo },
    },
    select: {
      createdAt: true,
      reviewAnswers: { select: { id: true } },
      sensoryEvaluations: { select: { id: true } },
    },
  });

  return buildMonthlyExperimentChart(experiments);
};

const getDashboardData = async (chefId) => {
  // ✅ apply filter
  const whereCondition = chefId ? { chefId } : {};

  const experiments = await prisma.cookingExperiment.findMany({
    where: whereCondition, // 👈 IMPORTANT
    select: {
      id: true,
      publicId: true,
      batchPublicId: true,
      recipeName: true,
      recipeVersion: true,
      createdAt: true,
      reviewAnswers: { select: { id: true } },
      sensoryEvaluations: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  let completed = 0;
  let pending = 0;

  const mappedExperiments = experiments.map((exp) => {
    const isCompleted = exp.sensoryEvaluations.length > 0;

    if (isCompleted) completed++;
    else pending++;

    return {
      id: exp.id,
      publicId: getExperimentPublicId(exp),
      batchPublicId: getExperimentBatchId(exp),
      recipeName: `${exp.recipeName} ${formatVersionLabel(exp.recipeVersion)}`,
      createdAt: exp.createdAt,
      status: exp.status,
    };
  });

  const recentExperiments = mappedExperiments.slice(0, 50);
  const chartData = await getMonthlyChartData(whereCondition);

  return {
    stats: {
      totalExperiments: experiments.length,
      qualityApproved: completed,
      pendingReview: pending,
    },
    recentExperiments,
    chartData,
  };
};

const addIngredientToCatalogService = async (
  name,
  unit = "g",
  performedById = null,
  auditContext = {},
) => {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  const cleanUnit = String(unit || "").trim() || "g";

  const ingredient = await prisma.ingredientCatalog.upsert({
    where: { name: cleanName },
    update: { unit: cleanUnit },
    create: { name: cleanName, unit: cleanUnit },
  });

  await createAuditLog(prisma, {
    action: "ADDED",
    entity: "Ingredient",
    entityId: ingredient.id,
    entityLabel: cleanName,
    description: `Ingredient "${cleanName}" added to catalog with unit: ${cleanUnit}`,
    userId: performedById,
    oldValue: null,
    newValue: ingredient,
    ipAddress: auditContext.ipAddress,
  });

  return ingredient;
};

const deleteIngredientFromCatalogService = async (
  id,
  performedById = null,
  auditContext = {},
) => {
  const ingredient = await prisma.ingredientCatalog
    .delete({
      where: { id },
    })
    .catch(() => null);

  if (ingredient) {
    await createAuditLog(prisma, {
      action: "DELETED",
      entity: "Ingredient",
      entityId: id,
      entityLabel: ingredient.name,
      description: `Ingredient "${ingredient.name}" removed from catalog`,
      userId: performedById,
      oldValue: ingredient,
      newValue: null,
      ipAddress: auditContext.ipAddress,
    });
  }

  return ingredient;
};

const getAllIngredientsFromCatalogService = async () => {
  return await prisma.ingredientCatalog.findMany({
    orderBy: { name: "asc" },
  });
};

const _test = {
  transitionExperimentWorkflow,
};

const getReviewerDashboardData = async () => {
  const [experiments, totalReviews, approvedCount] = await Promise.all([
    prisma.cookingExperiment.findMany({
      select: {
        id: true,
        publicId: true,
        batchPublicId: true,
        recipeName: true,
        recipeVersion: true,
        createdAt: true,
        experimentDate: true,
        status: true,
        chef: {
          select: { name: true },
        },
        sensoryEvaluations: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.cookingExperiment.count(),
    prisma.cookingExperiment.count({
      where: { sensoryEvaluations: { some: {} } },
    }),
  ]);

  const mappedExperiments = experiments.map((exp) => {
    const isCompleted = exp.sensoryEvaluations.length > 0;

    return {
      id: getExperimentPublicId(exp),
      publicId: getExperimentPublicId(exp),
      batchPublicId: getExperimentBatchId(exp),
      dbId: exp.id,
      recipe: `${exp.recipeName} ${formatVersionLabel(exp.recipeVersion)}`,
      recipeName: exp.recipeName,
      version: exp.recipeVersion,
      chef: exp.chef?.name || "System",
      date: exp.experimentDate
        ? new Date(exp.experimentDate).toISOString().split("T")[0]
        : "",
      status: exp.status,
    };
  });

  return {
    stats: {
      totalReviews,
      approved: approvedCount,
      awaitingAudit: totalReviews - approvedCount,
    },
    pipeline: mappedExperiments,
  };
};

const getManagerDashboardData = async ({ year } = {}) => {
  const chartYear = normalizeChartYear(year);
  const [
    totalExperiments,
    qualityApproved,
    totalChefs,
    totalReviewers,
    totalCras,
    totalManagers,
    activeStaff,
    inactiveStaff,
  ] = await Promise.all([
    prisma.cookingExperiment.count(),
    prisma.cookingExperiment.count({
      where: {
        sensoryEvaluations: {
          some: {},
        },
      },
    }),
    prisma.staff.count({ where: { role: "CHEF" } }),
    prisma.staff.count({ where: { role: "REVIEWER" } }),
    prisma.staff.count({ where: { role: "CRA" } }),
    prisma.staff.count({ where: { role: "MANAGER" } }),
    prisma.staff.count({ where: { status: "ACTIVE" } }),
    prisma.staff.count({ where: { status: "INACTIVE" } }),
  ]);

  const pendingReview = totalExperiments - qualityApproved;

  const recentExperiments = await prisma.cookingExperiment.findMany({
    take: 10,
    select: {
      id: true,
      publicId: true,
      batchPublicId: true,
      recipeName: true,
      recipeVersion: true,
      createdAt: true,
      experimentDate: true,
      status: true,
      aiStatus: true,
      chef: {
        select: { name: true },
      },
      sensoryEvaluations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mappedPipeline = recentExperiments.map((exp) => {
    const latestEval = exp.sensoryEvaluations[0];

    let aiScore = null;

    if (latestEval) {
      const scores = [
        latestEval.tasteConsistency,
        latestEval.aromaticVolatility,
        latestEval.sodiumProjection,
        latestEval.chromaticAppeal,
        latestEval.structuralIntegrity,
        latestEval.scovillePerception,
        latestEval.lipidSaturation,
        latestEval.cellularFreshness,
        latestEval.palatePersistence,
      ].filter((v) => v != null);

      if (scores.length > 0) {
        aiScore = Math.round(
          (scores.reduce((a, b) => a + b, 0) / (scores.length * 10)) * 100,
        );
      }
    }

    return {
      id: getExperimentPublicId(exp),
      dbId: exp.id,
      publicId: getExperimentPublicId(exp),
      batchPublicId: getExperimentBatchId(exp),
      recipe: `${exp.recipeName} ${formatVersionLabel(exp.recipeVersion)}`,
      recipeName: exp.recipeName,
      version: exp.recipeVersion,
      chef: exp.chef?.name || "System",
      date: exp.experimentDate
        ? new Date(exp.experimentDate).toLocaleDateString("en-CA")
        : new Date(exp.createdAt).toLocaleDateString("en-CA"),
      status: exp.status,
      aiScore,
      aiScoreState: getAiScoreState({ score: aiScore, aiStatus: exp.aiStatus, status: exp.status }),
    };
  });

  const [chartData, chartYears] = await Promise.all([
    getMonthlyChartData({}, chartYear),
    getChartYearOptions(),
  ]);

  return {
    stats: {
      totalExperiments,
      qualityApproved,
      pendingReview,
      totalChefs,
      totalReviewers,
      totalCras,
      totalManagers,
      activeStaff,
      inactiveStaff,
      totalStaff: activeStaff + inactiveStaff,
    },
    pipeline: mappedPipeline,
    chartData,
    chartYear,
    chartYears,
  };
};

const getAllReviewsService = async ({
  search,
  status,
  page = 1,
  limit = 10,
} = {}) => {
  const skip = (page - 1) * limit;

  const where = {
    ...(search
      ? {
          OR: [
            { recipeName: { contains: search, mode: "insensitive" } },
            { chef: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(status === "completed" ? { sensoryEvaluations: { some: {} } } : {}),
    ...(status === "pending" ? { sensoryEvaluations: { none: {} } } : {}),
  };

  const [experiments, totalCount, pendingCount, completedCount] =
    await Promise.all([
      prisma.cookingExperiment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          chef: { select: { name: true } },
          ingredients: { select: { name: true } },
          sensoryEvaluations: {
            orderBy: { createdAt: "desc" },
            include: { reviewer: { select: { name: true } } },
          },
          reviewAnswers: {
            include: {
              question: { select: { id: true, question: true, type: true } },
            },
          },
          submittedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          rejectedBy: { select: { id: true, name: true } },
          aiAnalysisRecord: {
            include: {
              retries: { orderBy: { retryTime: "asc" } },
              failures: { orderBy: { failureTime: "asc" } },
            },
          },
        },
      }),
      // Fetch statistics based on search but ignoring status filter
      prisma.cookingExperiment.count({
        where: search
          ? {
              OR: [
                { recipeName: { contains: search, mode: "insensitive" } },
                { chef: { name: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {},
      }),
      prisma.cookingExperiment.count({
        where: {
          ...(search
            ? {
                OR: [
                  { recipeName: { contains: search, mode: "insensitive" } },
                  { chef: { name: { contains: search, mode: "insensitive" } } },
                ],
              }
            : {}),
          sensoryEvaluations: { none: {} },
        },
      }),
      prisma.cookingExperiment.count({
        where: {
          ...(search
            ? {
                OR: [
                  { recipeName: { contains: search, mode: "insensitive" } },
                  { chef: { name: { contains: search, mode: "insensitive" } } },
                ],
              }
            : {}),
          sensoryEvaluations: { some: {} },
        },
      }),
    ]);

  const mappedData = experiments.map((exp) => {
    const isCompleted = exp.sensoryEvaluations.length > 0;
    const latestEval = exp.sensoryEvaluations[0];

    let aiScore = null;
    if (latestEval) {
      const scores = [
        latestEval.tasteConsistency,
        latestEval.aromaticVolatility,
        latestEval.sodiumProjection,
        latestEval.chromaticAppeal,
        latestEval.structuralIntegrity,
        latestEval.scovillePerception,
        latestEval.lipidSaturation,
        latestEval.cellularFreshness,
        latestEval.palatePersistence,
      ].filter((v) => v != null);
      if (scores.length > 0) {
        aiScore = Math.round(
          (scores.reduce((a, b) => a + b, 0) / (scores.length * 10)) * 100,
        );
      }
    }

    return {
      id: getExperimentPublicId(exp),
      dbId: exp.id,
      publicId: getExperimentPublicId(exp),

      recipe: `${exp.recipeName} ${formatVersionLabel(exp.recipeVersion)}`,
      recipeName: exp.recipeName,
      version: exp.recipeVersion,
      batchNo: getExperimentBatchId(exp),
      chef: exp.chef?.name || "System",
      date: exp.submittedAt
        ? new Date(exp.submittedAt).toLocaleDateString("en-CA")
        : exp.experimentDate
          ? new Date(exp.experimentDate).toLocaleDateString("en-CA")
          : new Date(exp.createdAt).toLocaleDateString("en-CA"),
      time: exp.submittedAt
        ? new Date(exp.submittedAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : exp.experimentTime ||
          new Date(exp.createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
      status: exp.status,
      aiScore,
      aiScoreState: getAiScoreState({
        score: aiScore,
        aiStatus: exp.aiStatus,
        status: exp.status,
      }),
      submittedAt: exp.submittedAt,
      reviewedAt: exp.reviewedAt,
      approvedAt: exp.approvedAt,
      rejectedAt: exp.rejectedAt,
      completedAt: exp.completedAt,
      aiAnalysisRecord: exp.aiAnalysisRecord,
      submittedBy: exp.submittedBy,
      reviewedBy: exp.reviewedBy,
      approvedBy: exp.approvedBy,
      rejectedBy: exp.rejectedBy,
      temp: exp.temperature,
      timing: exp.duration,
      expectedOutput: exp.expectedOutput,
      actualOutput: exp.actualOutput,
      yieldDeviation: buildYieldDeviationEvidence(exp.expectedOutput, exp.actualOutput),
      ingredients: exp.ingredients,
      reviewData: latestEval
        ? {
            reviewedBy: latestEval.reviewer?.name || "Reviewer",
            reviewedDate: latestEval.createdAt.toLocaleDateString("en-CA"),
            sensoryScores: {
              taste: latestEval.tasteConsistency,
              aroma: latestEval.aromaticVolatility,
              saltiness: latestEval.sodiumProjection,
              visual: latestEval.chromaticAppeal,
              consistency: latestEval.structuralIntegrity,
              spiciness: latestEval.scovillePerception,
              oiliness: latestEval.lipidSaturation,
              freshness: latestEval.cellularFreshness,
              aftertaste: latestEval.palatePersistence,
            },
            answers: exp.reviewAnswers.reduce((acc, ans) => {
              acc[ans.question.id] = ans.answerValue;
              return acc;
            }, {}),
            remarks: latestEval.finalExpertNote,
          }
        : null,
      staticQuestions: exp.reviewAnswers.map((ans) => ({
        id: ans.question.id,
        question: ans.question.question,
        type: ans.question.type,
        answer: ans.answerValue,
      })),
    };
  });

  return {
    data: mappedData,
    stats: {
      total: totalCount,
      pending: pendingCount,
      completed: completedCount,
    },
  };
};

const getAllRecipesService = async ({
  search,
  page = 1,
  limit = 12,
  chefId,
} = {}) => {
  const skip = (page - 1) * limit;

  const where = {
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    ...(chefId ? { experiments: { some: { chefId: Number(chefId) } } } : {}),
  };

  const [recipes, total] = await Promise.all([
    prisma.recipe.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
      include: {
        experiments: {
          where: chefId ? { chefId: Number(chefId) } : {},
          orderBy: { createdAt: "desc" },
          include: {
            chef: { select: { id: true, name: true } },
            images: { select: { imageUrl: true } },
            ingredients: { select: { name: true, quantity: true, unit: true } },
            sensoryEvaluations: { orderBy: { createdAt: "desc" }, take: 1 },
            reviewAnswers: {
              include: { question: { select: { question: true } } },
            },
          },
        },
      },
    }),
    prisma.recipe.count({ where }),
  ]);

  const data = recipes.map((recipe) => {
    const sortedExperiments = [...recipe.experiments].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
    const latest = sortedExperiments[0];

    if (!latest)
      return {
        baseName: recipe.name,
        latest: null,
        versions: [],
        status: "Pending",
      };

    const latestEval = latest.sensoryEvaluations[0];
    let aiScore = null;
    if (latestEval) {
      const scores = [
        latestEval.tasteConsistency,
        latestEval.aromaticVolatility,
        latestEval.sodiumProjection,
        latestEval.chromaticAppeal,
        latestEval.structuralIntegrity,
        latestEval.scovillePerception,
        latestEval.lipidSaturation,
        latestEval.cellularFreshness,
        latestEval.palatePersistence,
      ].filter((v) => v != null);
      if (scores.length > 0) {
        aiScore = Math.round(
          (scores.reduce((a, b) => a + b, 0) / (scores.length * 10)) * 100,
        );
      }
    }

    const mappedLatest = {
      ...latest,
      id: getExperimentPublicId(latest),
      dbId: latest.id,
      publicId: getExperimentPublicId(latest),
      recipe: latest.recipeName,
      chef: latest.chef?.name || "Unknown Chef",
      timing: latest.duration || 0,
      temp: latest.temperature || 0,
      aiScore,
      aiScoreState: getAiScoreState({ score: aiScore, aiStatus: latest.aiStatus, status: latest.status }),
      date: new Date(latest.createdAt).toLocaleDateString("en-CA"),
      version: latest.recipeVersion,
      batchNo: getExperimentBatchId(latest),
      status: latest.status,
      expOutputValue: latest.expectedOutput,
      expOutputUnit: "g",
      actOutputValue: latest.actualOutput,
      actOutputUnit: "g",
      remarks: latest.remarks || "",
      image: latest.images?.[0]?.imageUrl || "",
      ingredients: latest.ingredients || [],
      sensoryScores: latestEval
        ? {
            taste: latestEval.tasteConsistency,
            aroma: latestEval.aromaticVolatility,
            saltiness: latestEval.sodiumProjection,
            visual: latestEval.chromaticAppeal,
            consistency: latestEval.structuralIntegrity,
            spiciness: latestEval.scovillePerception,
            oiliness: latestEval.lipidSaturation,
            freshness: latestEval.cellularFreshness,
            aftertaste: latestEval.palatePersistence,
          }
        : null,
      reviewAnswers: latest.reviewAnswers || [],
    };

    return {
      baseName: recipe.name,
      latest: mappedLatest,
      versions: sortedExperiments,
      status: mappedLatest.status,
    };
  });

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

module.exports = {
  createExperimentService,
  getAllExperimentsService,
  getAllReviewsService,
  getExperimentByIdService,
  getNextVersion,
  getRecipeHistoryService,
  getDashboardData,
  getReviewerDashboardData,
  getManagerDashboardData,
  getRecipeSuggestionsService,
  getIngredientSuggestionsService,
  addIngredientToCatalogService,
  deleteIngredientFromCatalogService,
  getAllIngredientsFromCatalogService,
  getAllRecipesService,
  approveExperimentService,
  rejectExperimentService,
  completeExperimentService,
  updateRemarksService,
  markExperimentUnderReviewService,
  _test,
};
