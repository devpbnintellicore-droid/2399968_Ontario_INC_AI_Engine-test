const success = (res, data, message = "Success") => {
    res.json({ success: true, message, data });
};

const error = (res, message = "Error", code = 500) => {
    res.status(code).json({ success: false, message });
};

module.exports = { success, error };