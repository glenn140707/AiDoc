const form = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("請先選擇檔案", "error");
    return;
  }

  setStatus("上傳並抽取中，請稍候…");
  renderRows([]);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const resp = await fetch("/api/document-extraction/dates", {
      method: "POST",
      body: formData,
    });

    const payload = await resp.json();
    if (!resp.ok || payload.success === false) {
      const msg = payload.errorMessage || payload.error || "伺服器錯誤";
      throw new Error(msg);
    }

    const items = payload?.data?.items || [];
    renderRows(items);
    setStatus("完成，若無結果則 items 為空陣列");
  } catch (err) {
    setStatus(err.message || "無法完成請求", "error");
  }
});

function renderRows(items) {
  if (!items.length) {
    resultsBody.innerHTML =
      '<tr><td class="empty" colspan="7">沒有找到日期或尚未抽取</td></tr>';
    return;
  }

  const rows = items
    .map((item) => {
      return `
        <tr>
          <td>${escapeHtml(item.type || "")}</td>
          <td>${escapeHtml(item.date_text || "")}</td>
          <td>${escapeHtml(item.date_iso ?? "")}</td>
          <td>${escapeHtml(item.summary || "")}</td>
          <td>${item.page ?? ""}</td>
          <td>${escapeHtml(item.section || "")}</td>
          <td>${item.confidence ?? ""}</td>
        </tr>
      `;
    })
    .join("");

  resultsBody.innerHTML = rows;
}

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = type === "error" ? "status error" : "status";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
