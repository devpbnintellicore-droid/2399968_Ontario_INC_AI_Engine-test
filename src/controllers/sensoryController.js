const sensoryService = require("../services/sensoryService");

const createSensory = async (req, res) => {
    try {
        const reviewerId = req.user.id;

        if (req.user.role !== "REVIEWER") {
            return res.status(403).json({
                success: false,
                message: "Only reviewers can create sensory evaluations"
            });
        }

        const data = await sensoryService.createSensory(req.body, reviewerId, {
            ipAddress: req.ip,
        });

        return res.status(201).json({
            success: true,
            message: "Sensory Evaluation Created",
            data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createSensory
};
