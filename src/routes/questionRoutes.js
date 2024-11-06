const express = require("express");
const {
    createQuestion,
    submitAnswer,
    submitBatchAnswers,
    getAllQuestions,
    updateQuestion,
    deleteQuestion,
    snapshotQuestionnaire,
    getQuestionnaireVersions,
    getQuestionChangeLogs
} = require("../controllers/questionController.js");
const verifyToken = require("../middleware/authMiddleware.js");
const allowRoles = require("../middleware/roleMiddleware.js");

const router = express.Router();

router.get("/", verifyToken, getAllQuestions);
router.post("/", verifyToken, allowRoles("MANAGER"), createQuestion);
router.post("/answer", verifyToken, submitAnswer);
router.post("/batch-answer", verifyToken, submitBatchAnswers);
router.put("/:id", verifyToken, allowRoles("MANAGER"), updateQuestion);
router.delete("/:id", verifyToken, allowRoles("MANAGER"), deleteQuestion);

router.get("/questionnaires/versions", verifyToken, allowRoles("MANAGER"), getQuestionnaireVersions);
router.post("/questionnaires/snapshot", verifyToken, allowRoles("MANAGER"), snapshotQuestionnaire);
router.get("/:id/history", verifyToken, allowRoles("MANAGER"), getQuestionChangeLogs);

module.exports = router;
