// 簡易驗證測試，確保 schema 檢查與清洗邏輯運作
// 執行：node scripts/test-validators.js

const { validateItems } = require("../backend/server");

const source = "sample.pdf";

function runCase(name, raw) {
  const result = validateItems(raw, source);
  console.log(`\n[${name}]`);
  console.log("輸入：", raw);
  console.log("輸出：", result);
}

// 測試 1：合法 JSON，含多餘欄位與 type 誤值，應被清洗成 allowed type / 移除多餘欄位
const case1 = `\`\`\`json
{
  "items": [
    {
      "date_text": "2024年3月1日",
      "date_iso": "2024-03-01",
      "type": "deadline",
      "summary": "繳交合約截止日",
      "source_file": "",
      "page": 2,
      "section": "付款條款",
      "confidence": 0.9,
      "extra": "should be ignored"
    }
  ]
}
\`\`\``;

// 測試 2：不合法 JSON/結構，validateItems 會回 null（在實際流程會觸發 LLM 修正，若仍失敗則回空陣列）
const case2 = `{"foo":"bar","items":"not-array"}`;

runCase("合法 JSON 應被清洗", case1);
runCase("不合法結構應為 null", case2);
