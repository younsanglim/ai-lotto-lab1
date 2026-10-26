
const analyzeBtn = document.getElementById("analyzeBtn");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function renderNumbers(numbers) {
  const container = document.getElementById("numberBalls");

  if (!Array.isArray(numbers) || numbers.length !== 6) {
    throw new Error("분석 API에서 올바른 번호 6개를 받지 못했습니다.");
  }

  const valid = numbers.every(
    (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 45
  );

  const sorted = numbers.map(Number).sort((a, b) => a - b);

  if (!valid || new Set(sorted).size !== 6) {
    throw new Error("추천 번호 형식이 올바르지 않습니다.");
  }

  container.innerHTML = sorted.map((number, index) => `
    <span class="ball" style="animation-delay:${index * 60}ms">
      ${number}
    </span>
  `).join("");

  document.getElementById("numberCaption").textContent =
    "분석용 참고 조합 · 당첨 예측이나 보장 기능이 아닙니다.";
}

function renderFrequency(items) {
  const container = document.getElementById("frequencyChart");

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<p class="empty-text">출현 빈도 데이터가 없습니다.</p>';
    return;
  }

  const max = Math.max(...items.map((item) => Number(item.count) || 0), 1);

  container.innerHTML = items.slice(0, 5).map((item) => {
    const number = Number(item.number);
    const count = Number(item.count) || 0;
    const width = Math.max(0, Math.min(100, count / max * 100));

    return `
      <div class="frequency-row">
        <span class="frequency-num">${escapeHTML(number)}</span>
        <div class="frequency-track">
          <div class="frequency-fill" style="width:${width}%"></div>
        </div>
        <span class="frequency-count">${escapeHTML(count)}회</span>
      </div>
    `;
  }).join("");
}

function renderDistribution(elementId, items) {
  const container = document.getElementById(elementId);

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = '<p class="empty-text">분포 데이터가 없습니다.</p>';
    return;
  }

  const total = items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);

  container.innerHTML = items.map((item) => {
    const count = Number(item.count) || 0;
    const percent = total ? count / total * 100 : 0;

    return `
      <div class="distribution-row">
        <div class="distribution-label">
          <span>${escapeHTML(item.label)}</span>
          <strong>${count}회 (${percent.toFixed(1)}%)</strong>
        </div>
        <div class="distribution-track">
          <div class="distribution-fill" style="width:${percent}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderExplanation(explanation) {
  const container = document.getElementById("explanationContent");

  const sections = [
    {
      title: "전체 데이터 요약",
      icon: "◈",
      text: explanation?.summary
    },
    {
      title: "출현 빈도 해설",
      icon: "↗",
      text: explanation?.frequency
    },
    {
      title: "번호 분포 해설",
      icon: "▤",
      text: explanation?.distribution
    },
    {
      title: "분석 조합 해설",
      icon: "✳",
      text: explanation?.combination
    }
  ];

  const cards = sections.map((section) => `
    <article class="insight-card">
      <h3><span>${section.icon}</span>${section.title}</h3>
      <p>${escapeHTML(section.text || "이 항목의 해설이 제공되지 않았습니다.")}</p>
    </article>
  `).join("");

  container.innerHTML = `
    <div class="insight-grid">
      ${cards}
      <article class="insight-card wide">
        <h3><span>ⓘ</span>분석 결과를 해석할 때 주의할 점</h3>
        <p>${escapeHTML(
          explanation?.caution ||
          "과거 통계는 기록된 결과를 요약할 뿐, 미래 당첨 번호를 예측하지 않습니다."
        )}</p>
      </article>
    </div>
  `;
}

function renderDashboard(data) {
  renderNumbers(data.numbers);

  const stats = data.statistics || {};
  const explanation = data.explanation || {};

  document.getElementById("roundCount").textContent =
    Number(stats.roundCount || 0).toLocaleString("ko-KR");

  document.getElementById("latestRound").textContent =
    stats.latestRound ? `${stats.latestRound}회` : "-";

  document.getElementById("dataStatus").textContent =
    `분석 완료 · ${Number(stats.roundCount || 0).toLocaleString("ko-KR")}개 회차`;

  renderFrequency(stats.frequency);
  renderDistribution("oddEvenStats", stats.oddEven);
  renderDistribution("rangeStats", stats.ranges);
  renderExplanation(explanation);
}

analyzeBtn.addEventListener("click", async () => {
  analyzeBtn.disabled = true;
  loading.classList.remove("hidden");
  errorBox.classList.add("hidden");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(
        data.message || "분석에 실패했습니다. 잠시 후 다시 시도해 주세요."
      );
    }

    renderDashboard(data);
  } catch (error) {
    console.error("AI analysis error:", error);
    showError(error.message || "서버 연결에 실패했습니다.");
  } finally {
    analyzeBtn.disabled = false;
    loading.classList.add("hidden");
  }
});
