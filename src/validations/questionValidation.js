const Joi = require("joi");

const VALID_TYPES = [
    "rating_stars", "nps", "slider", "single_choice", "multi_choice",
    "dropdown", "short_text", "long_text", "yes_no", "emoji_reaction",
    "date", "number", "ranking", "matrix", "image_choice", "linear_scale"
];

const createQuestionSchema = Joi.object({
    question: Joi.string().trim().min(3).required().label("Question"),
    type: Joi.string().valid(...VALID_TYPES).required().label("Question Type"),
    config: Joi.object().optional().allow(null).label("Config")
});

const answerQuestionSchema = Joi.object({
    questionId: Joi.number().required(),
    experimentId: Joi.number().required(),
    answerValue: Joi.any().required()
});

const updateQuestionSchema = Joi.object({
    question: Joi.string().trim().min(3).optional().label("Question"),
    type: Joi.string().valid(...VALID_TYPES).optional().label("Question Type"),
    config: Joi.object().optional().allow(null).label("Config")
});

const batchAnswerSchema = Joi.object({
    answers: Joi.array().items(answerQuestionSchema).min(1).required()
});

module.exports = {
    createQuestionSchema,
    answerQuestionSchema,
    batchAnswerSchema,
    updateQuestionSchema
};
