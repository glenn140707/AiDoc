# AiDoc - 文件關鍵日期抽取 MVP

最小化「非對話型」文件日期抽取工具：使用者上傳 PDF / DOCX / TXT，後端呼叫 LLM 並僅回傳固定 JSON schema 的 `items`，不回聊天或解釋。

## 目錄結構（骨架）

- `backend/`：後端 API（Express）、檔案解析、LLM 呼叫
- `frontend/`：前端靜態頁（上傳 + 結果表格）
- `prompts/`：提示詞草稿或調優素材
- `notes/`：開發紀錄、研究筆記
- `docs/`：規格/流程說明
- 其他：`data/`、`outputs/` 等可放測試資料或輸出

## 專案目標

- 非對話模式：使用者僅上傳文件，系統直接回 JSON。
- 固定 Schema（items 陣列）：`date_text`, `date_iso`, `type ("start"|"end"|"deadline"|"sign"|"payment"|"other")`, `summary`, `source_file`, `page`, `section`, `confidence`。
- 找不到日期時必須回 `[]`；不可臆測，盡可能提供可回溯來源（page/section）。

## MVP 範圍

- 支援可選取文字的 PDF、DOCX、TXT 基本解析。
- 後端提供最小 API 供前端呼叫；前端提供檔案上傳與結果表格。
- 不做聊天介面，不做 RAG/相似度推薦。
- PDF 掃描/OCR 視為 Phase 2。

## 非目標（本階段不做）

- 多模型對比、進階 prompt chain、評估指標儀表板。
- 權限/帳號系統。
- 大量併發、長文件切片與快取優化。

## 後端啟動方式

1) 安裝依賴  
```bash
npm install
```
2) 設定環境變數（可放 `.env`，位於專案根目錄）  
- `OPENAI_API_KEY`（必填）  
- `OPENAI_API_URL`（選填，預設 `https://api.openai.com/v1/chat/completions`）  
- `OPENAI_MODEL`（選填，預設 `gpt-4o-mini`）  
- `DOC_CHAR_LIMIT`（選填，預設 12000，限制送入 LLM 的字數）
3) 啟動伺服器  
```bash
npm start
# 伺服器預設在 http://localhost:3000
```

### 基本驗證測試
```bash
npm test
```
（使用簡易腳本檢查 schema 清洗與不合法結構行為）

### 環境變數

- `OPENAI_API_KEY`（必填）：LLM API Key。  
- `OPENAI_API_URL`（選填）：預設 `https://api.openai.com/v1/chat/completions`。  
- `OPENAI_MODEL`（選填）：預設 `gpt-4o-mini`。  
- `PORT`（選填）：預設 `3000`。  
- `DOC_CHAR_LIMIT`（選填）：預設 `12000`，送入 LLM 的字數上限。

本地設定建議：
- 複製 `.env.example` 為 `.env`，填入上述變數。  
- `.gitignore` 已忽略 `.env`，避免 API Key 被提交。  
- 在 CI/CD 或雲端環境則改用系統層環境變數注入。

## 後端 API（MVP）

- Endpoint：`POST /api/document-extraction/dates`
- 請求：`multipart/form-data`，欄位 `file`，支援 PDF（可選取文字）/ DOCX / TXT，大小上限 20MB。
- 回應 envelope：`{ success: boolean, data?: {...}, errorMessage?: string }`
- `data` 結構範例：  
```json
{
  "source_file": "sample.pdf",
  "items": [
    {
      "date_text": "2024年3月1日",
      "date_iso": "2024-03-01",
      "type": "deadline",
      "summary": "繳交合約截止日",
      "source_file": "sample.pdf",
      "page": 2,
      "section": "付款條款",
      "confidence": 0.82
    }
  ]
}
```
- 找不到日期時：`{ "success": true, "data": { "source_file": "<檔名>", "items": [] } }`
- 失敗範例：`{ "success": false, "errorMessage": "檔案解析失敗：..." }`

### cURL 範例
```bash
curl -X POST http://localhost:3000/api/document-extraction/dates \
  -F "file=@/path/to/sample.pdf"
```

## 前端啟動方式

- MVP 為靜態頁，已由後端 Express 直接服務，啟動後端即可。  
- 若要獨立開發前端，可在 `frontend/` 內建立自有工具鏈（例如 Vite/Next），並調整後端靜態檔案路徑。

## 示例流程（MVP）

1. 使用者在前端上傳 `sample.pdf`。  
2. 後端解析文字並呼叫 LLM。  
3. 回傳固定 JSON：  
```json
{
  "items": [
    {
      "date_text": "2024年3月1日",
      "date_iso": "2024-03-01",
      "type": "deadline",
      "summary": "繳交合約截止日",
      "source_file": "sample.pdf",
      "page": 2,
      "section": "付款條款",
      "confidence": 0.82
    }
  ]
}
```
4. 前端表格僅顯示這些欄位，不附加解釋或聊天內容。

## 待辦與延伸

- Phase 2：掃描 PDF / OCR、長文切片、重試與評分機制。  
- 前端美化與打包流程。  
- 加入自動化測試與 CI。

## 已知限制與下一步

- LLM 修正重試僅做一次且依賴相同模型，若兩次均非合法 JSON，將回空陣列避免臆測。
- 未對極長文件做切片與分頁定位強化，長文本會被截斷至 `DOC_CHAR_LIMIT`。
- 目前未加入權限/流量管控，實務上需增加 API Key 管理與速率限制。
- 前端為靜態 MVP，尚未導入框架/打包與錯誤遙測。
- 建議後續加入單元測試/contract test、記錄 LLM 失敗案例以便提示詞迭代。

## 部署/資安注意事項（MVP）

- 請勿將 `.env` 提交至版本庫，API Key 應以環境變數注入並啟用最小權限/速率限制。  
- 若對外服務，建議在反向代理層加入 HTTPS、基本驗證或 IP 白名單，並設定檔案大小/請求率限制。  
- 紀錄 LLM 失敗案例時請避免長期保留原文檔內容，必要時做脫敏或到期清除。
