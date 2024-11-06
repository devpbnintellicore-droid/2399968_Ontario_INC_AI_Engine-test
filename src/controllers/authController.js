const authService = require("../services/authService");

const createStaff = async (req, res) => {
    try {
        const data = req.body;

        const result = await authService.createStaff(data, req.user?.id ?? null, req.ip);

        res.status(201).json({
            success: true,
            message: "Staff created successfully",
            data: result
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

const login = async (req, res) => {
    try {
        const { email, password, role } = req.body;

        const result = await authService.loginUser(email, password, role);

        res.json({
            success: true,
            message: "Login success",
            data: result
        });

    } catch (err) {
        res.status(err.statusCode || 401).json({
            success: false,
            message: err.message
        });
    }
};

const updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const result = await authService.updateStaff(parseInt(id), data, req.user?.id ?? null, req.ip);

        res.json({
            success: true,
            message: "Staff updated successfully",
            data: result
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

const deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await authService.deleteStaff(
            parseInt(id),
            req.user?.id ?? null,
            req.ip,
            req.body?.deactivationReason || "Staff deactivated by manager"
        );

        res.json({
            success: true,
            message: "Staff deleted successfully",
            data: result
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

const getAllStaff = async (req, res) => {
    try {
        const result = await authService.getAllStaff();

        res.json({
            success: true,
            message: "Staff list retrieved successfully",
            data: result
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

const getStaffStats = async (req, res) => {
    try {
        const result = await authService.getStaffStats();

        res.json({
            success: true,
            message: "Staff statistics retrieved successfully",
            data: result
        });

    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

const changePassword = async (req, res) => {
    try {
        const staffId = req.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "New password and confirm password do not match"
            });
        }

        const result = await authService.changePassword(staffId, currentPassword, newPassword, req.ip);

        res.json({
            success: true,
            message: result.message
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
};

module.exports = {
    createStaff,
    login,
    updateStaff,
    deleteStaff,
    getAllStaff,
    getStaffStats,
    changePassword
};
