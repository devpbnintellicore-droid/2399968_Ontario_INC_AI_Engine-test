const Joi = require("joi");

const createExperimentSchema = Joi.object({
    recipeName: Joi.string().trim().required(),
    experimentDate: Joi.date().max("now").optional().allow(null).messages({
        "date.max": "Experiment date cannot be in the future."
    }),
    experimentTime: Joi.string().optional().allow("", null),
    temperature: Joi.number()
        .min(50)
        .max(300)
        .required()
        .messages({
            "number.base": "Please enter a valid numeric temperature.",
            "number.min": "Temperature must be at least 50°C.",
            "number.max": "Temperature cannot exceed 300°C.",
            "any.required": "Target temperature is required.",
        }),
    duration: Joi.number()
        .integer()
        .min(1)
        .max(480)
        .required()
        .messages({
            "number.base": "Please enter a valid duration in minutes.",
            "number.min": "Duration must be at least 1 minute.",
            "number.max": "Duration cannot exceed 480 minutes.",
            "number.integer": "Duration must be a whole number.",
            "any.required": "Cooking duration is required.",
        }),
    expectedTexture: Joi.string().optional().allow("", null),
    achievedTexture: Joi.string().optional().allow("", null),
    expectedOutput: Joi.number().optional().allow(null),
    actualOutput: Joi.number().optional().allow(null),
    remarks: Joi.string().optional().allow("", null),
    chefId: Joi.number().required(),
    ingredients: Joi.array()
        .items(
            Joi.object({
                name: Joi.string().required(),
                quantity: Joi.number().required(),
                unit: Joi.string().required()
            })
        )
        .min(1)
        .required()
        .messages({
            "array.min": "At least one ingredient is required.",
            "any.required": "Ingredients are required."
        }),
    imageUrls: Joi.array().items(Joi.string().uri()).optional().default([]),
    isBump: Joi.boolean().optional().default(false)
});

module.exports = { createExperimentSchema };
