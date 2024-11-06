const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const {
  clean,
  monthNumber,
  parseNumber,
  sensoryFieldByQuestion,
  stableHash,
} = require("./helpers");

const CSV_FILE_NAME = "full_menu_recipe_reviews_2024_march_to_october_updated.csv";
const LEGACY_CSV_FILE_NAME = "restaurant_recipe_reviews_2024_march_to_october_updated.csv";

const resolveCsvPath = () => {
  const candidates = [
    path.join(__dirname, "..", "data", CSV_FILE_NAME),
    path.join(__dirname, "..", "..", "google-sheet-data", CSV_FILE_NAME),
    path.join(__dirname, "..", "data", LEGACY_CSV_FILE_NAME),
    path.join(__dirname, "..", "..", "google-sheet-data", LEGACY_CSV_FILE_NAME),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`CSV file not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
};

const parseCsvRows = () => {
  const csvPath = resolveCsvPath();
  const content = fs.readFileSync(csvPath, "utf8");
  return parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: false,
    relax_column_count: true,
    trim: true,
  }).filter((row) => Object.values(row).some((value) => clean(value)));
};

const getGroupKey = (context) =>
  [
    context.month,
    context.recipeName,
    context.version,
    context.experimentDate,
    context.batchCode,
  ].join("|");

const normalizeIngredient = (row) => {
  const name = clean(row["Ingredient name"]);
  if (!name) return null;
  return {
    name,
    quantity: parseNumber(row["Ingredient Quantity"], 0),
    unit: clean(row["Ingredient Unit"]) || "g",
  };
};

const parseExperimentsFromCsv = () => {
  const rows = parseCsvRows();
  const groups = new Map();
  let context = null;

  for (const row of rows) {
    const recipeName = clean(row["Recipe Name"]);
    if (recipeName) {
      context = {
        month: clean(row.Month),
        recipeName,
        version: clean(row.Version) || "v1.0",
        experimentDate: clean(row["Experiment Date"]),
        experimentTime: clean(row["Experiment Time"]),
        batchCode: clean(row["Batch Code"]),
        chefName: clean(row.Chef),
        reviewerName: clean(row.Reviewer),
        temperature: clean(row["Target Temperature (C) *"]),
        duration: clean(row["Cooking Duration (mins) *"]),
        expectedTexture: clean(row["Expected Texture"]),
        achievedTexture: clean(row["Achieved Texture"]),
        expectedOutput: clean(row["Expected Output"]),
        actualOutput: clean(row["Actual Output"]),
        remarks: clean(row["Chef Observations & Remarks"]),
        finalReviewerNote: clean(row["Final Reviewer Note"]),
      };
    }

    if (!context) continue;

    const key = getGroupKey(context);
    if (!groups.has(key)) {
      groups.set(key, {
        ...context,
        monthNumber: monthNumber(context.month),
        ingredients: [],
        sensory: {},
        reviewAnswers: [],
        sourceRowIds: [],
      });
    }

    const group = groups.get(key);
    group.sourceRowIds.push(stableHash(JSON.stringify(row), 10));

    const ingredient = normalizeIngredient(row);
    if (ingredient && !group.ingredients.some((item) => item.name === ingredient.name)) {
      group.ingredients.push(ingredient);
    }

    const sensoryQuestion = clean(row["Sensory Evaluation - Questions"]);
    const sensoryField = sensoryFieldByQuestion[sensoryQuestion];
    if (sensoryField) {
      group.sensory[sensoryField] = parseNumber(row["Sensory Evaluation - Answer"], 0);
    }

    const question = clean(row.Question);
    if (question) {
      group.reviewAnswers.push({
        question,
        type: clean(row["Question Type"]) || "short_text",
        answer: clean(row["Question Answer"]),
      });
    }

    const finalReviewerNote = clean(row["Final Reviewer Note"]);
    if (finalReviewerNote) group.finalReviewerNote = finalReviewerNote;
  }

  return Array.from(groups.values()).sort((a, b) => {
    const dateA = clean(a.experimentDate);
    const dateB = clean(b.experimentDate);
    return dateA.localeCompare(dateB) || clean(a.batchCode).localeCompare(clean(b.batchCode));
  });
};

module.exports = {
  CSV_FILE_NAME,
  parseExperimentsFromCsv,
  resolveCsvPath,
};
