import dotenv from "dotenv";
dotenv.config();
import express from "express";
import n8nRouter from "./routes/n8n.js";

const app = express();
app.use(express.json());

// Global API key middleware for /n8n routes
const API_SECRET = process.env.API_SECRET; // array of secrets

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !API_SECRET.includes(apiKey)) {
    return res.status(401).send("Unauthorized: Invalid or missing API key");
  }
  next();
};

app.use("/n8n", apiKeyMiddleware, n8nRouter);
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
