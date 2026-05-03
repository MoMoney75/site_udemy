require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CHAT_MODEL = "openai/gpt-oss-120b:free";

const DIGITAL_TWIN_SYSTEM = `You are the "digital twin" of Mauricio Silva — answer as him, in first person, professionally and concisely. You only speak about his career, skills, background, and goals as described below. If asked something outside that scope, say you do not have that information and suggest emailing maudysi12@gmail.com or LinkedIn.

Facts about Mauricio (use only these; do not invent employers, dates, or credentials):

- Name: Mauricio Silva
- Title / focus: Software Engineer | JavaScript | Node | React | Python; interest in football (personal interest)
- Location: Miami–Fort Lauderdale Area
- Contact: maudysi12@gmail.com
- LinkedIn: https://www.linkedin.com/in/mauricio-silva-dazarola
- GitHub: https://github.com/MoMoney75
- Summary: Software engineering graduate from Springboard's bootcamp, transitioning from the automotive industry into web development. 10+ years as an Audi/Porsche technician; strong critical thinking and problem-solving. Open to being contacted by email.

Top skills (from profile): Axios, Git, Database Systems
Languages: English (full professional), Spanish (professional working)

Experience:
- Braman Porsche West Palm — Automotive Technician — March 2023 – Present — West Palm Beach, FL
- Springboard — Software Engineer Trainee — Dec 2022 – Apr 2024 — Full-stack training: front-end and back-end, databases, data structures and algorithms; Flask, SQLAlchemy, RESTful routing, SQL DB, Jinja with Flask, responsive apps with CSS and Bootstrap, OOP backends, REST APIs with Express (GET, POST, PATCH, DELETE)
- Champion Porsche — Automotive Technician — May 2022 – Mar 2023
- PAUL MILLER PORSCHE — Automotive Technician — Feb 2020 – May 2022 — Parsippany, NJ
- DCH Millburn Audi — Automotive Technician — Nov 2016 – Feb 2020 — Millburn, NJ

Education:
- Springboard — Software Engineering Career Track Certificate — Dec 2022 – Apr 2024
- Lincoln Tech — Automotive Technician — Jan 2015 – Jan 2016

Tone: confident, clear, "enterprise meets edgy" — polished, direct, no fluff. Keep answers short unless the user asks for detail.`;

const MAX_MESSAGES = 24;
const MAX_CONTENT_LENGTH = 6000;

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" || m.role === "user" ? m.role : null;
    if (!role) continue;
    let content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }
    out.push({ role, content });
    if (out.length >= MAX_MESSAGES) break;
  }
  return out.length ? out : null;
}

function pickOpenRouterErrorMessage(data, httpStatus) {
  const fallback = `OpenRouter request failed (${httpStatus ?? "unknown"}).`;
  if (!data || typeof data !== "object") return fallback;

  const top = data.error;
  if (typeof top === "string" && top.trim()) return top.trim();
  if (top && typeof top.message === "string" && top.message.trim()) return top.message.trim();

  if (typeof data.message === "string" && data.message.trim()) return data.message.trim();

  const choiceErr = data.choices?.[0]?.error;
  if (choiceErr && typeof choiceErr.message === "string" && choiceErr.message.trim()) {
    return choiceErr.message.trim();
  }

  return fallback;
}

function extractAssistantReply(data) {
  const choice = data?.choices?.[0];
  if (!choice) {
    return { kind: "empty" };
  }

  if (choice.error?.message) {
    return { kind: "error", message: String(choice.error.message) };
  }
  if (choice.finish_reason === "error" && choice.error?.message) {
    return { kind: "error", message: String(choice.error.message) };
  }

  if (typeof choice.text === "string" && choice.text.trim()) {
    return { kind: "ok", text: choice.text.trim() };
  }

  const msg = choice.message;
  if (!msg) {
    return { kind: "empty" };
  }

  let c = msg.content;
  if (typeof c === "string" && c.trim()) {
    return { kind: "ok", text: c.trim() };
  }

  if (Array.isArray(c)) {
    const textParts = c
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        if (typeof part.text === "string") return part.text;
        if (part.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean);
    const joined = textParts.join("\n").trim();
    if (joined) {
      return { kind: "ok", text: joined };
    }
  }

  return { kind: "empty" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOpenRouter(openRouterMessages, apiKey) {
  const referer = process.env.SITE_URL || `http://localhost:${PORT}`;
  const body = JSON.stringify({
    model: CHAT_MODEL,
    messages: openRouterMessages,
  });

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": "Mauricio Silva - Digital Twin",
        "X-OpenRouter-Title": "Mauricio Silva - Digital Twin",
      },
      body,
    });

    const rawText = await upstream.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }

    if (upstream.status === 429 && attempt < maxAttempts - 1) {
      const retryAfterMs = 2000 * (attempt + 1);
      console.warn(
        `[chat] OpenRouter 429, retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${maxAttempts})`
      );
      await sleep(retryAfterMs);
      attempt += 1;
      continue;
    }

    return { upstream, rawText, data };
  }

  return null;
}

/** Lets the browser chat UI call the API from another dev origin (e.g. Live Server). */
function apiCors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
}

app.use("/api", apiCors);

app.use(express.json({ limit: "120kb" }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, chat: true, endpoint: "/api/chat" });
});

app.post("/api/chat", async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return res.status(503).json({
      error: "Chat is not configured. Set OPENROUTER_API_KEY in .env and restart the server.",
    });
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (!messages) {
    return res.status(400).json({ error: "Send a non-empty messages array with user/assistant roles." });
  }

  const openRouterMessages = [{ role: "system", content: DIGITAL_TWIN_SYSTEM }, ...messages];

  try {
    const result = await callOpenRouter(openRouterMessages, apiKey);
    if (!result) {
      return res.status(502).json({ error: "Could not complete request after retries." });
    }

    const { upstream, rawText, data } = result;

    if (!upstream.ok) {
      const msg = pickOpenRouterErrorMessage(data, upstream.status);
      console.error("[chat] OpenRouter HTTP error", upstream.status, rawText.slice(0, 600));
      return res.status(502).json({ error: msg });
    }

    const reply = extractAssistantReply(data);
    if (reply.kind === "error") {
      console.error("[chat] Choice-level error", reply.message);
      return res.status(502).json({ error: reply.message });
    }
    if (reply.kind !== "ok" || !reply.text) {
      const hint = pickOpenRouterErrorMessage(data, upstream.status);
      console.error("[chat] Unexpected completion shape", rawText.slice(0, 800));
      return res.status(502).json({
        error:
          hint && hint !== `OpenRouter request failed (${upstream.status}).`
            ? hint
            : "Unexpected response from the model. The free tier may be rate-limited — try again shortly.",
      });
    }

    return res.json({ message: reply.text });
  } catch (err) {
    console.error("OpenRouter request failed:", err);
    return res.status(502).json({ error: "Could not reach the AI service. Try again later." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Site running at http://localhost:${PORT}`);
  console.log(`Chat API: POST http://localhost:${PORT}/api/chat (health: GET /api/health)`);
});
