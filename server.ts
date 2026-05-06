import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

  // AI Analysis Route
  app.post("/api/analyze", async (req, res) => {
    try {
      const { prompt, reports } = req.body;
      
      const parts: any[] = [{ text: prompt }];
      
      if (reports && Array.isArray(reports)) {
        reports.forEach((report: any) => {
          if (report.content) {
             const [header, data] = report.content.split(';base64,');
             const mimeType = header.split(':')[1];
             parts.push({
               inlineData: {
                 mimeType: mimeType,
                 data: data
               }
             });
          }
        });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
        }
      });

      res.json(JSON.parse(response.text || '{}'));
    } catch (error) {
      console.error("AI Analysis Error:", error);
      res.status(500).json({ error: "Failed to perform analysis" });
    }
  });

  // AI Chat Route
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      
      // Map history to parts if necessary, or just pass parts
      const contents = messages.map((m: any) => ({
        role: m.role,
        parts: m.parts
      }));

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents
      });

      res.json({ text: response.text });
    } catch (error) {
      console.error("AI Chat Error:", error);
      res.status(500).json({ error: "Failed to chat" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
