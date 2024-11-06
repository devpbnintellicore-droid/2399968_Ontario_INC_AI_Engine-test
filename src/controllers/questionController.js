const { asyncHandler } = require("../utils/asyncHandler.js");
const questionService = require("../services/questionService.js");
const { success } = require("../utils/apiResponse.js");

const {
  createQuestionSchema,
  answerQuestionSchema,
  batchAnswerSchema,
  updateQuestionSchema,
} = require("../validations/questionValidation.js");

const createQuestion = asyncHandler(async (req, res) => {
  const { error, value } = createQuestionSchema.validate(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message.replace(/"/g, ""),
    });
  }

  const question = await questionService.createQuestionService(
    value,
    req.user?.id ?? null,
    req.ip,
  );

  success(res, question, "Question created successfully");
});

const submitAnswer = asyncHandler(async (req, res) => {
  const { error, value } = answerQuestionSchema.validate(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message.replace(/"/g, ""),
    });
  }

  const reviewerId = req.user.id;

  if (req.user.role !== "REVIEWER") {
    return res.status(403).json({
      success: false,
      message: "Only reviewers can submit answers",
    });
  }

  const answer = await questionService.answerQuestionService(
    value,
    reviewerId,
    req.ip,
  );

  success(res, answer, "Answer submitted");
});

const submitBatchAnswers = asyncHandler(async (req, res) => {
  const { error, value } = batchAnswerSchema.validate(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message.replace(/"/g, ""),
    });
  }

  const reviewerId = req.user.id;

  if (req.user.role !== "REVIEWER") {
    return res.status(403).json({
      success: false,
      message: "Only reviewers can submit answers",
    });
  }

  const results = await questionService.batchAnswerQuestionsService(
    value.answers,
    reviewerId,
  );

  success(res, results, `${results.length} answers submitted successfully`);
});

const getAllQuestions = asyncHandler(async (req, res) => {
  const questions = await questionService.getAllQuestionsService();

  success(res, questions, "Questions retrieved successfully");
});

const updateQuestion = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID",
    });
  }

  const { error, value } = updateQuestionSchema.validate(req.body);

  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message.replace(/"/g, ""),
    });
  }

  if (Object.keys(value).length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one field is required",
    });
  }

  const updated = await questionService.updateQuestionService(
    id,
    value,
    req.user?.id,
    req.ip,
  );

  success(res, updated, "Question updated successfully");
});

// const deleteQuestion = asyncHandler(async (req, res) => {
//     const id = Number(req.params.id);

//     if (isNaN(id)) {
//         return res.status(400).json({
//             success: false,
//             message: "Invalid ID"
//         });
//     }

// success(res, updated, "Question updated successfully");
// });

const deleteQuestion = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid ID",
    });
  }

  await questionService.deleteQuestionService(id, req.user?.id ?? null, req.ip);

  success(res, null, "Question deleted successfully");
});

const snapshotQuestionnaire = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  const result = await questionService.snapshotQuestionnaireService(userId, req.ip);
  success(res, result, "Questionnaire snapshot created");
});

const getQuestionnaireVersions = asyncHandler(async (req, res) => {
  const versions = await questionService.getQuestionnaireVersionsService();
  success(res, versions, "Questionnaire versions retrieved");
});

const getQuestionChangeLogs = asyncHandler(async (req, res) => {
  const questionId = Number(req.params.id);
  if (isNaN(questionId)) {
    return res.status(400).json({ success: false, message: "Invalid ID" });
  }
  const logs = await questionService.getQuestionChangeLogsService(questionId);
  success(res, logs, "Question change logs retrieved");
});

module.exports = {
  createQuestion,
  submitAnswer,
  submitBatchAnswers,
  getAllQuestions,
  updateQuestion,
  deleteQuestion,
  snapshotQuestionnaire,
  getQuestionnaireVersions,
  getQuestionChangeLogs,
};
