const crypto = require("crypto");

const REVIEW_SEED_SOURCE = "csv-seed:restaurant-recipe-reviews-2024";

const clean = (value) => String(value ?? "").trim();

const slugify = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const stableHash = (value, length = 8) =>
  crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, length);

const parseNumber = (value, fallback = null) => {
  const match = clean(value).match(/-?\d+(\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value) => {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toTitleCase = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const normalizeEmailName = (name, fallback) => {
  const base = slugify(name || fallback).replace(/-/g, ".");
  return `${base || slugify(fallback)}@example.com`;
};

const monthNumber = (month) => {
  const date = new Date(`${clean(month)} 1, 2024`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getMonth() + 1;
};

const buildRecipePublicId = (recipeName) =>
  `REC-${slugify(recipeName).toUpperCase()}-${stableHash(recipeName, 6).toUpperCase()}`;

const buildExperimentPublicId = (experiment) => {
  const datePart = clean(experiment.experimentDate).replace(/-/g, "") || "NO-DATE";
  const batchPart = slugify(experiment.batchCode || experiment.recipeName).toUpperCase();
  const hash = stableHash(
    `${experiment.recipeName}|${experiment.version}|${experiment.experimentDate}|${experiment.batchCode}`,
    6,
  ).toUpperCase();
  return `EXP-${datePart}-${batchPart}-${hash}`;
};

const buildBatchPublicId = (experiment) => {
  const batch = slugify(experiment.batchCode);
  if (batch) return `BATCH-${batch.toUpperCase()}`;
  return `BATCH-${stableHash(`${experiment.recipeName}|${experiment.version}`, 10).toUpperCase()}`;
};

const answerValueForType = (type, value) => {
  const raw = clean(value);
  switch (clean(type)) {
    case "rating_stars":
      return parseNumber(raw, null);
    case "yes_no":
      return /^yes$/i.test(raw) ? "Yes" : "No";
    case "ranking":
      return raw
        .split(">")
        .map((item) => clean(item))
        .filter(Boolean);
    case "long_text":
    case "short_text":
    default:
      return raw || null;
  }
};

const sensoryFieldByQuestion = {
  "Taste Consistency (1-10)": "tasteConsistency",
  "Aromatic Volatility (1-10)": "aromaticVolatility",
  "Sodium Projection (1-10)": "sodiumProjection",
  "Chromatic Appeal (1-10)": "chromaticAppeal",
  "Structural Integrity (1-10)": "structuralIntegrity",
  "Scoville Perception (1-10)": "scovillePerception",
  "Lipid Saturation (1-10)": "lipidSaturation",
  "Cellular Freshness (1-10)": "cellularFreshness",
  "Palate Persistence (1-10)": "palatePersistence",
};

const average = (values) => {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const inferExperimentState = (experiment) => {
  const scores = Object.values(experiment.sensory || {});
  const scoreAverage = average(scores) ?? 0;
  const finalNote = clean(experiment.finalReviewerNote).toLowerCase();
  const actualOutput = parseNumber(experiment.actualOutput, null);
  const expectedOutput = parseNumber(experiment.expectedOutput, null);
  const yieldDelta =
    actualOutput != null && expectedOutput ? Math.abs(actualOutput - expectedOutput) / expectedOutput : 0;

  if (finalNote.includes("does not authorize") || scoreAverage < 7 || yieldDelta > 0.15) {
    return {
      status: "REJECTED",
      aiStatus: "ANALYSIS_FAILED",
      approvalDecision: "Rejected",
      approvalReason: experiment.finalReviewerNote || "Sensory score or yield variance requires repeat experiment.",
    };
  }

  if (finalNote.includes("continuation only after") || finalNote.includes("conditionally")) {
    return {
      status: "UNDER_REVIEW",
      aiStatus: "ANALYSIS_COMPLETED",
      approvalDecision: "Conditional Approval",
      approvalReason: experiment.finalReviewerNote || "Reviewer requested controlled correction.",
    };
  }

  return {
    status: "APPROVED",
    aiStatus: "ANALYSIS_COMPLETED",
    approvalDecision: "Approved",
    approvalReason: experiment.finalReviewerNote || "Reviewer authorized controlled service trial.",
  };
};

const buildAiEvidence = (experiment) => {
  const state = inferExperimentState(experiment);
  const scores = Object.values(experiment.sensory || {});
  const scoreAverage = average(scores);
  const confidenceScore = scoreAverage == null ? 72 : Math.round((scoreAverage / 10) * 100);
  const failed = state.aiStatus === "ANALYSIS_FAILED";

  return {
    state,
    confidenceScore,
    keyTakeaways: [
      `${experiment.recipeName} ${experiment.version} was reviewed from ${experiment.month} 2024 CSV evidence.`,
      `Reviewer note: ${experiment.finalReviewerNote || "No final reviewer note supplied."}`,
      `Yield moved from ${experiment.expectedOutput || "unknown"} expected to ${experiment.actualOutput || "unknown"} actual.`,
    ],
    improvementAreas:
      state.status === "APPROVED"
        ? ["Maintain process controls", "Continue month-wise verification"]
        : ["Tighten sensory consistency", "Document chef correction", "Repeat approval review before service release"],
    recommendationStatus: state.approvalDecision,
    failureReason: failed
      ? "Seeded AI analysis marks this batch as failed because reviewer evidence requires repeat experiment."
      : null,
  };
};

const buildRecipeSnapshot = (experiment) => ({
  recipeName: experiment.recipeName,
  recipeVersion: experiment.version,
  batchCode: experiment.batchCode,
  month: experiment.month,
  experimentDate: experiment.experimentDate,
  temperature: parseNumber(experiment.temperature, null),
  duration: parseNumber(experiment.duration, null),
  expectedOutput: parseNumber(experiment.expectedOutput, null),
  actualOutput: parseNumber(experiment.actualOutput, null),
  ingredients: experiment.ingredients,
  sensory: experiment.sensory,
});

module.exports = {
  REVIEW_SEED_SOURCE,
  answerValueForType,
  buildAiEvidence,
  buildBatchPublicId,
  buildExperimentPublicId,
  buildRecipePublicId,
  buildRecipeSnapshot,
  clean,
  inferExperimentState,
  monthNumber,
  normalizeEmailName,
  parseDate,
  parseNumber,
  sensoryFieldByQuestion,
  slugify,
  stableHash,
  toTitleCase,
};
