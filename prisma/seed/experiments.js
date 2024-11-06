const {
  REVIEW_SEED_SOURCE,
  answerValueForType,
  buildAiEvidence,
  buildBatchPublicId,
  buildExperimentPublicId,
  buildRecipePublicId,
  buildRecipeSnapshot,
  inferExperimentState,
  parseDate,
  parseNumber,
} = require("./helpers");
const { getStaffForExperiment } = require("./staff");

const defaultSensory = {
  tasteConsistency: 0,
  aromaticVolatility: 0,
  sodiumProjection: 0,
  chromaticAppeal: 0,
  structuralIntegrity: 0,
  scovillePerception: 0,
  lipidSaturation: 0,
  cellularFreshness: 0,
  palatePersistence: 0,
};

const upsertRecipe = async (tx, experiment) => {
  const recipe = await tx.recipe.upsert({
    where: { name: experiment.recipeName },
    update: {
      publicId: buildRecipePublicId(experiment.recipeName),
    },
    create: {
      name: experiment.recipeName,
      publicId: buildRecipePublicId(experiment.recipeName),
    },
  });
  return recipe;
};

const clearExperimentChildren = async (tx, experimentId) => {
  const analysis = await tx.aIAnalysis.findUnique({ where: { experimentId } });
  if (analysis) {
    await tx.aIAnalysisRetry.deleteMany({ where: { aiAnalysisId: analysis.id } });
    await tx.aIAnalysisFailure.deleteMany({ where: { aiAnalysisId: analysis.id } });
    await tx.aIAnalysis.delete({ where: { id: analysis.id } });
  }

  await tx.reviewAnswer.deleteMany({ where: { experimentId } });
  await tx.sensoryEvaluation.deleteMany({ where: { cookingExperimentId: experimentId } });
  await tx.reviewConclusion.deleteMany({ where: { experimentId } });
  await tx.recipeVersion.deleteMany({ where: { experimentId } });
  await tx.ingredient.deleteMany({ where: { experimentId } });
  await tx.chefNoteHistory.deleteMany({ where: { experimentId } });
};

const removeStaleSeedExperiments = async (prisma, currentPublicIds) => {
  const staleExperiments = await prisma.cookingExperiment.findMany({
    where: {
      aiDataSource: REVIEW_SEED_SOURCE,
      publicId: { notIn: currentPublicIds },
    },
    select: { id: true },
  });

  for (const experiment of staleExperiments) {
    await prisma.$transaction(async (tx) => {
      await clearExperimentChildren(tx, experiment.id);
      await tx.auditLog.deleteMany({
        where: { entity: "CookingExperiment", entityId: experiment.id },
      });
      await tx.cookingExperiment.delete({ where: { id: experiment.id } });
    });
  }

  return staleExperiments.length;
};

const seedExperiment = async (prisma, experiment, seededStaff, questionMap) => {
  const staff = await getStaffForExperiment(prisma, experiment, seededStaff);
  const state = inferExperimentState(experiment);
  const ai = buildAiEvidence(experiment);
  const publicId = buildExperimentPublicId(experiment);
  const batchPublicId = buildBatchPublicId(experiment);
  const experimentDate = parseDate(experiment.experimentDate);
  const seedTimestamp = experimentDate || new Date();
  const generatedAt = seedTimestamp;

  return prisma.$transaction(async (tx) => {
    const recipe = await upsertRecipe(tx, experiment);

    for (const ingredient of experiment.ingredients) {
      await tx.ingredientCatalog.upsert({
        where: { name: ingredient.name },
        update: { unit: ingredient.unit || "g" },
        create: { name: ingredient.name, unit: ingredient.unit || "g" },
      });
    }

    const existing = await tx.cookingExperiment.findUnique({ where: { publicId } });
    if (existing) {
      await clearExperimentChildren(tx, existing.id);
    }

    const lifecycleDates =
      state.status === "REJECTED"
        ? {
            submittedAt: experimentDate,
            reviewedAt: experimentDate,
            rejectedAt: experimentDate,
            submittedById: staff.chef.id,
            reviewedById: staff.reviewer.id,
            rejectedById: staff.manager.id,
          }
        : state.status === "UNDER_REVIEW"
          ? {
              submittedAt: experimentDate,
              reviewedAt: experimentDate,
              submittedById: staff.chef.id,
              reviewedById: staff.reviewer.id,
            }
          : {
              submittedAt: experimentDate,
              reviewedAt: experimentDate,
              approvedAt: experimentDate,
              completedAt: experimentDate,
              submittedById: staff.chef.id,
              reviewedById: staff.reviewer.id,
              approvedById: staff.manager.id,
            };

    const saved = await tx.cookingExperiment.upsert({
      where: { publicId },
      update: {
        recipeId: recipe.id,
        recipeName: experiment.recipeName,
        recipeVersion: experiment.version,
        experimentDate,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
        experimentTime: experiment.experimentTime || null,
        temperature: parseNumber(experiment.temperature, null),
        duration: parseNumber(experiment.duration, null),
        expectedTexture: experiment.expectedTexture || null,
        achievedTexture: experiment.achievedTexture || null,
        expectedOutput: parseNumber(experiment.expectedOutput, null),
        actualOutput: parseNumber(experiment.actualOutput, null),
        remarks: experiment.remarks || null,
        status: state.status,
        chefId: staff.chef.id,
        batchPublicId,
        actualAppearance: "Captured from month-wise restaurant review sheet",
        actualAroma: "Reviewer sensory notes available",
        actualFlavor: "Reviewer sensory notes available",
        expectedAppearance: "Restaurant plating standard",
        expectedAroma: "Recipe-specific aroma profile",
        expectedFlavor: "Balanced recipe flavor profile",
        reviewComments: experiment.finalReviewerNote || null,
        aiStatus: state.aiStatus,
        aiAnalysisId: `${publicId}-AI`,
        aiConfidenceScore: ai.confidenceScore,
        aiDataSource: REVIEW_SEED_SOURCE,
        aiGeneratedAt: generatedAt,
        aiGeneratedBy: "Prisma CSV seed",
        aiModelVersion: "seeded-v1",
        aiReason: ai.failureReason || state.approvalReason,
        aiResult: state.approvalDecision,
        aiKeyTakeaways: ai.keyTakeaways,
        aiImprovementAreas: ai.improvementAreas,
        aiRecommendationStatus: ai.recommendationStatus,
        approvalDecision: state.approvalDecision,
        approvalReason: state.approvalReason,
        textureAcceptanceThreshold: 0,
        textureAcceptanceResult:
          experiment.expectedTexture && experiment.achievedTexture
            ? experiment.achievedTexture.includes(experiment.expectedTexture)
              ? "PASS"
              : "REVIEW"
            : null,
        ...lifecycleDates,
      },
      create: {
        publicId,
        batchPublicId,
        recipeId: recipe.id,
        recipeName: experiment.recipeName,
        recipeVersion: experiment.version,
        experimentDate,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
        experimentTime: experiment.experimentTime || null,
        temperature: parseNumber(experiment.temperature, null),
        duration: parseNumber(experiment.duration, null),
        expectedTexture: experiment.expectedTexture || null,
        achievedTexture: experiment.achievedTexture || null,
        expectedOutput: parseNumber(experiment.expectedOutput, null),
        actualOutput: parseNumber(experiment.actualOutput, null),
        remarks: experiment.remarks || null,
        status: state.status,
        chefId: staff.chef.id,
        actualAppearance: "Captured from month-wise restaurant review sheet",
        actualAroma: "Reviewer sensory notes available",
        actualFlavor: "Reviewer sensory notes available",
        expectedAppearance: "Restaurant plating standard",
        expectedAroma: "Recipe-specific aroma profile",
        expectedFlavor: "Balanced recipe flavor profile",
        reviewComments: experiment.finalReviewerNote || null,
        aiStatus: state.aiStatus,
        aiAnalysisId: `${publicId}-AI`,
        aiConfidenceScore: ai.confidenceScore,
        aiDataSource: REVIEW_SEED_SOURCE,
        aiGeneratedAt: generatedAt,
        aiGeneratedBy: "Prisma CSV seed",
        aiModelVersion: "seeded-v1",
        aiReason: ai.failureReason || state.approvalReason,
        aiResult: state.approvalDecision,
        aiKeyTakeaways: ai.keyTakeaways,
        aiImprovementAreas: ai.improvementAreas,
        aiRecommendationStatus: ai.recommendationStatus,
        approvalDecision: state.approvalDecision,
        approvalReason: state.approvalReason,
        textureAcceptanceThreshold: 0,
        textureAcceptanceResult:
          experiment.expectedTexture && experiment.achievedTexture
            ? experiment.achievedTexture.includes(experiment.expectedTexture)
              ? "PASS"
              : "REVIEW"
            : null,
        ...lifecycleDates,
      },
    });

    await tx.ingredient.createMany({
      data: experiment.ingredients.map((ingredient) => ({
        experimentId: saved.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit || "g",
      })),
    });

    await tx.chefNoteHistory.create({
      data: {
        experimentId: saved.id,
        oldValue: null,
        newValue: experiment.remarks || null,
        reason: "Seeded from month-wise CSV review data",
        modifiedBy: staff.chef.id,
        modifiedAt: seedTimestamp,
      },
    });

    await tx.recipeVersion.create({
      data: {
        recipeId: recipe.id,
        experimentId: saved.id,
        version: experiment.version,
        changeSummary: `Seeded ${experiment.month} 2024 batch ${experiment.batchCode}`,
        oldValue: null,
        newValue: buildRecipeSnapshot(experiment),
        modifiedBy: staff.chef.id,
        modifiedAt: seedTimestamp,
      },
    });

    for (const answer of experiment.reviewAnswers) {
      const question = questionMap.get(answer.question);
      if (!question) continue;
      await tx.reviewAnswer.create({
        data: {
          questionId: question.question.id,
          questionVersionId: question.version.id,
          experimentId: saved.id,
          reviewerId: staff.reviewer.id,
          answerValue: answerValueForType(answer.type, answer.answer),
          questionStatus: answer.answer ? "Answered" : "Optional",
          createdAt: seedTimestamp,
        },
      });
    }

    await tx.sensoryEvaluation.create({
      data: {
        cookingExperimentId: saved.id,
        reviewerId: staff.reviewer.id,
        ...defaultSensory,
        ...experiment.sensory,
        finalExpertNote: experiment.finalReviewerNote || null,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
      },
    });

    await tx.reviewConclusion.create({
      data: {
        experimentId: saved.id,
        source: "Human Reviewer",
        writtenBy: staff.reviewer.name,
        writtenAt: experimentDate,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
      },
    });

    const analysis = await tx.aIAnalysis.create({
      data: {
        experimentId: saved.id,
        status: state.aiStatus,
        failureReason: ai.failureReason,
        failureTime: ai.failureReason ? generatedAt : null,
        retryCount: ai.failureReason ? 1 : 0,
        lastRetry: ai.failureReason ? generatedAt : null,
        modelVersion: "seeded-v1",
        generatedBy: "Prisma CSV seed",
        generatedAt,
        dataSource: REVIEW_SEED_SOURCE,
        fallbackMethod: ai.failureReason ? "Manual reviewer evidence" : null,
        fallbackReviewer: ai.failureReason ? staff.reviewer.name : null,
        fallbackDate: ai.failureReason ? generatedAt : null,
        keyTakeaways: ai.keyTakeaways,
        improvementAreas: ai.improvementAreas,
        recommendationStatus: ai.recommendationStatus,
        confidenceScore: ai.confidenceScore,
        createdAt: seedTimestamp,
        updatedAt: seedTimestamp,
      },
    });

    if (ai.failureReason) {
      await tx.aIAnalysisRetry.create({
        data: {
          aiAnalysisId: analysis.id,
          retryNumber: 1,
          status: "FAILED",
          retryResult: "Manual review fallback required",
          retryTime: seedTimestamp,
        },
      });
      await tx.aIAnalysisFailure.create({
        data: {
          aiAnalysisId: analysis.id,
          reason: ai.failureReason,
          failureTime: seedTimestamp,
        },
      });
    }

    await tx.auditLog.deleteMany({
      where: {
        entity: "CookingExperiment",
        entityId: saved.id,
        action: { startsWith: "SEED_" },
      },
    });
    await tx.auditLog.create({
      data: {
        action: "SEED_UPSERT",
        entity: "CookingExperiment",
        entityId: saved.id,
        entityLabel: saved.publicId,
        description: `Seeded ${experiment.month} 2024 recipe review batch ${experiment.batchCode}`,
        userId: staff.manager.id,
        createdAt: seedTimestamp,
        newValue: {
          source: REVIEW_SEED_SOURCE,
          batchPublicId,
          status: state.status,
          aiStatus: state.aiStatus,
        },
      },
    });

    return saved;
  });
};

const seedExperiments = async (prisma, experiments, seededStaff, questionMap) => {
  const currentPublicIds = experiments.map((experiment) => buildExperimentPublicId(experiment));
  const staleCount = await removeStaleSeedExperiments(prisma, currentPublicIds);
  const saved = [];
  for (const experiment of experiments) {
    saved.push(await seedExperiment(prisma, experiment, seededStaff, questionMap));
  }
  return { saved, staleCount };
};

module.exports = {
  seedExperiments,
};
