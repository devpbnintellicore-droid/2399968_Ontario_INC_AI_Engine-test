const { asyncHandler } = require("../utils/asyncHandler.js");
const { getAuditLogsService } = require("../services/auditService.js");
const { success } = require("../utils/apiResponse.js");

const getAuditLogs = asyncHandler(async (req, res) => {
    const { role, entity, search, page = 1, limit = 50 } = req.query;

    const result = await getAuditLogsService({
        role,
        entity,
        search,
        page:  Number(page),
        limit: Number(limit),
    });

    success(res, result, "Audit logs fetched");
});

module.exports = { getAuditLogs };
