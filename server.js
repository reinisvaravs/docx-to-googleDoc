import dotenv from "dotenv";
dotenv.config();
import express from "express";
import n8nRouter from "./routes/n8n.js";

const app = express();
app.use(express.json());
app.use("/n8n", n8nRouter);
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
