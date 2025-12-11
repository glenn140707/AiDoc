const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const DOC_CHAR_LIMIT = Number(process.env.DOC_CHAR_LIMIT || 12000);
const PROMPT_PATH = path.join(__dirname, "../prompts/date_extraction.prompt.md");

let datePrompt = "";
try {
  datePrompt = fs.readFileSync(PROMPT_PATH, "utf8");
} catch (err) {
  console.warn("無法載入日期抽取提示詞，請確認檔案存在於 prompts/：", err.message);
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../frontend/public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post(
  "/api/document-extraction/dates",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, errorMessage: "缺少檔案" });
      }

      const { buffer, originalname, mimetype } = req.file;

      let parsed;
      try {
        parsed = await extractText(buffer, originalname, mimetype);
      } catch (err) {
        return res.status(400).json({
          success: false,
          errorMessage: `檔案解析失敗：${err.message || "未知錯誤"}`,
        });
      }

      const result = await runLLMWithRepair({
        text: parsed.text,
        pages: parsed.pages,
        sourceFile: originalname,
      });

      return res.json({
        success: true,
        data: { source_file: originalname, items: result },
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        errorMessage: `LLM 服務失敗：${err.message || "未知錯誤"}`,
      });
    }
  }
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AiDoc server listening on http://localhost:${PORT}`);
  });
}

async function extractText(buffer, filename, mimetype) {
  const ext = path.extname(filename || "").toLowerCase();

  if (ext === ".pdf" || mimetype === "application/pdf") {
    return parsePdf(buffer);
  }
  if (ext === ".docx") {
    return parseDocx(buffer);
  }
  if (ext === ".txt" || mimetype === "text/plain") {
    return {
      text: buffer.toString("utf8"),
      pages: [],
    };
  }

  throw new Error("目前僅支援 PDF / DOCX / TXT");
}

async function parsePdf(buffer) {
  const pages = [];
  const data = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((item) => item.str).join(" ");
      pages.push(text);
      return text;
    },
  });

  return {
    text: pages.join("\n\n"),
    pages,
    info: { numpages: data.numpages || pages.length },
  };
}

async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value || "",
    pages: [],
  };
}

async function runLLMWithRepair({ text, pages, sourceFile }) {
  const callResult = await callLLM({ text, pages, sourceFile });
  let items = validateItems(callResult.raw, sourceFile);

  if (items) {
    return items;
  }

  // 安全修正：僅輸入模型的原始輸出與 schema，避免加入新資訊
  const repaired = await repairLLMOutput({
    raw: callResult.raw,
    schema: callResult.schemaDescription,
  });

  items = validateItems(repaired, sourceFile);
  if (items) {
    return items;
  }

  // 無法修正則回空陣列，符合「找不到就回 []」且避免臆測
  return [];
}

async function callLLM({ text, pages, sourceFile }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY");
  }

  const endpoint =
    process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const trimmedText = text.slice(0, DOC_CHAR_LIMIT);
  const pageHints = pages
    .slice(0, 8)
    .map((p, idx) => `頁碼 ${idx + 1}: ${p.slice(0, 800)}`)
    .join("\n---\n");

  const schemaDescription = `{"items":[{"date_text":"string","date_iso":"string|null","type":"start|end|deadline|sign|payment|other","summary":"string","source_file":"string","page":number|null,"section":"string|null","confidence":number|null}]}`;

  const prompt = [
    datePrompt ||
      "請僅依據文件內容輸出符合 schema 的 JSON，找不到日期請輸出 {\"items\":[] }，勿回解釋。",
    `Schema: ${schemaDescription}`,
    `檔名: ${sourceFile}`,
    `內容長度: ${trimmedText.length} / ${text.length} (可能已截斷)`,
    "文件正文：",
    trimmedText,
  ];

  if (pageHints) {
    prompt.push("頁面提示（僅供參考，可忽略重複片段）：", pageHints);
  }

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是文件關鍵日期抽取助手，僅輸出 JSON 物件，遵守指定 schema，禁止多餘解釋。",
      },
      { role: "user", content: prompt.join("\n\n") },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`LLM 回應錯誤：${resp.status} ${errorText}`);
  }

  const data = await resp.json();
  const raw =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.message?.json ||
    "";

  return { raw, schemaDescription };
}

async function repairLLMOutput({ raw, schema }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const endpoint =
    process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是 JSON 修復助手，僅輸出符合指定 schema 的 JSON，禁止加入新資訊，無法修復時請輸出 {\"items\":[]}",
      },
      {
        role: "user",
        content: [
          "以下是模型剛才的輸出，可能不是合法 JSON，請修復為合法且符合 schema 的 JSON。",
          "不得臆測或新增原本沒有的事件，無法修復就回 {\"items\":[]}",
          `Schema: ${schema}`,
          "原始輸出：",
          String(raw || ""),
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    return "";
  }
  const data = await resp.json();
  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.message?.json ||
    ""
  );
}

function normalizeItems(raw, sourceFile) {
  const cleaned = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : parsed.items;
  return Array.isArray(items) ? items : null;
}

function sanitizeItems(items, sourceFile) {
  const allowedTypes = new Set([
    "start",
    "end",
    "deadline",
    "sign",
    "payment",
    "other",
  ]);

  return items.map((item) => {
    const type = allowedTypes.has(item?.type) ? item.type : "other";
    return {
      date_text: typeof item?.date_text === "string" ? item.date_text : "",
      date_iso:
        typeof item?.date_iso === "string" && item.date_iso.trim()
          ? item.date_iso.trim()
          : null,
      type,
      summary: typeof item?.summary === "string" ? item.summary : "",
      source_file:
        typeof item?.source_file === "string" && item.source_file.trim()
          ? item.source_file.trim()
          : sourceFile || "",
      page:
        typeof item?.page === "number"
          ? item.page
          : item?.page === null
          ? null
          : null,
      section:
        typeof item?.section === "string" && item.section.trim()
          ? item.section.trim()
          : null,
      confidence:
        typeof item?.confidence === "number" ? item.confidence : null,
    };
  });
}

function validateItems(items, sourceFile) {
  let normalized = null;
  if (Array.isArray(items)) {
    normalized = items;
  } else {
    const maybe = normalizeItems(items, sourceFile);
    normalized = Array.isArray(maybe) ? maybe : null;
  }

  if (!normalized) return null;

  const sanitized = sanitizeItems(normalized, sourceFile);
  return sanitized.map((item) => ({
    date_text: item.date_text || "",
    date_iso: item.date_iso ?? null,
    type: item.type,
    summary: item.summary || "",
    source_file: item.source_file || sourceFile || "",
    page: typeof item.page === "number" ? item.page : null,
    section: item.section ?? null,
    confidence:
      typeof item.confidence === "number" ? item.confidence : null,
  }));
}

module.exports = {
  app,
  extractText,
  validateItems,
  sanitizeItems,
  normalizeItems,
  runLLMWithRepair,
};
