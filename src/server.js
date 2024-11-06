const app = require("./app.js");

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
    res.send("cloud kitchen server is running 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port", PORT);
});