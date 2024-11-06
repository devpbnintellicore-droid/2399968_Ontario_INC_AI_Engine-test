const { prisma } = require("../config/db");
const { createAuditLog } = require("../utils/auditLogger.js");

const formatPublicId = (prefix, id, date = new Date()) => {
  const d = new Date(date);
  const yr = String(d.getFullYear()).slice(-2);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const num = String(id).padStart(4, "0");
  return `${prefix}-${yr}${mo}-${num}`;
};

const createSensory = async (payload, reviewerId, auditContext = {}) => {
  // Validate sensory scores are between 1 and 10
  const sensoryFields = [
    "tasteConsistency",
    "aromaticVolatility",
    "sodiumProjection",
    "chromaticAppeal",
    "structuralIntegrity",
    "scovillePerception",
    "lipidSaturation",
    "cellularFreshness",
    "palatePersistence",
  ];

  for (const field of sensoryFields) {
    const score = payload[field];
    if (score === undefined || score === null || score < 1 || score > 10) {
      throw new Error(`Invalid score for ${field}. Must be between 1 and 10.`);
    }
  }

  if (
    !payload.finalExpertNote ||
    typeof payload.finalExpertNote !== "string" ||
    payload.finalExpertNote.trim().length <= 10
  ) {
    throw new Error(
      "finalExpertNote must be a string with a length greater than 10 characters.",
    );
  }

  // Prevent duplicate evaluations
  const existing = await prisma.sensoryEvaluation.findFirst({
    where: { cookingExperimentId: payload.cookingExperimentId },
  });

  if (existing) {
    throw new Error(
      `Sensory evaluation already exists for experiment ID ${payload.cookingExperimentId}`,
    );
  }

  const experimentBefore = await prisma.cookingExperiment.findUnique({
    where: { id: Number(payload.cookingExperimentId) },
  });

  const evaluation = await prisma.$transaction(async (tx) => {
    const created = await tx.sensoryEvaluation.create({
      data: {
        cookingExperimentId: payload.cookingExperimentId,
        reviewerId: reviewerId,

        tasteConsistency: payload.tasteConsistency,
        aromaticVolatility: payload.aromaticVolatility,
        sodiumProjection: payload.sodiumProjection,
        chromaticAppeal: payload.chromaticAppeal,
        structuralIntegrity: payload.structuralIntegrity,
        scovillePerception: payload.scovillePerception,
        lipidSaturation: payload.lipidSaturation,
        cellularFreshness: payload.cellularFreshness,
        palatePersistence: payload.palatePersistence,

        finalExpertNote: payload.finalExpertNote,
      },
    });

    if (experimentBefore?.status === "SUBMITTED") {
      await tx.cookingExperiment.update({
        where: { id: Number(payload.cookingExperimentId) },
        data: {
          status: "UNDER_REVIEW",
          reviewedAt: new Date(),
          reviewedById: reviewerId,
        },
      });
    }

    const reviewer = await tx.staff.findUnique({
      where: { id: reviewerId },
      select: { name: true },
    });

    // Store conclusion tracking evidence
    if (payload.finalExpertNote) {
      await tx.reviewConclusion.upsert({
        where: { experimentId: payload.cookingExperimentId },
        update: {
          source: "Human Reviewer",
          writtenBy: reviewer?.name || "Unknown Reviewer",
          writtenAt: new Date(),
          updatedAt: new Date(),
        },
        create: {
          experimentId: payload.cookingExperimentId,
          source: "Human Reviewer",
          writtenBy: reviewer?.name || "Unknown Reviewer",
          writtenAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    return created;
  });

  const expLabel =
    experimentBefore?.publicId ||
    formatPublicId(
      "EXP",
      payload.cookingExperimentId,
      experimentBefore?.createdAt,
    );
  await createAuditLog(prisma, {
    action: "REVIEW",
    entity: "Review",
    entityId: payload.cookingExperimentId,
    entityLabel: expLabel,
    description: `Sensory evaluation submitted for ${expLabel}`,
    userId: reviewerId,
    oldValue: { status: experimentBefore?.status || "SUBMITTED" },
    newValue: { status: "UNDER_REVIEW", evaluation },
    ipAddress: auditContext.ipAddress,
  });

  return evaluation;
};

module.exports = {
  createSensory,
};
