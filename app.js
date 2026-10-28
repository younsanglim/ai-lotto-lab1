
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

  if (typeof numbers === "string") {
    numbers = numbers.match(/\d+/g)?.map(Number);
  }

  if (!Array.isArray(numbers) || numbers.length !== 6) {
    throw new Error("분석 API에서 올바른 번호 6개를 받지 못했습니다.");
  }

  const sorted = numbers.map(Number).sort((a, b) => a - b);

  if (
    !sorted.every((n) => Number.isInteger(n) && n >= 1 && n <= 45) ||
    new Set(sorted).size !== 6
  ) {
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
    container.innerHTML =
      '<p class="empty-text">출현 빈도 데이터가 없습니다. API 통계 응답을 확인해 주세요.</p>';
    return;
  }

  const max = Math.max(
    ...items.map((item) => Number(item.count) || 0),
    1
  );

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
    container.innerHTML =
      '<p class="empty-text">통계 데이터가 API에서 전달되지 않았습니다.</p>';
    return;
  }

  const total = items.reduce(
    (sum, item) => sum + (Number(item.count) || 0),
    0
  );

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

function renderExplanation(explanation, data) {
  const container = document.getElementById("explanationContent");

  // API가 해설 하나만 보내는 경우와 항목별 객체를 보내는 경우 모두 처리
  const isObject =
    explanation && typeof explanation === "object" &&
    !Array.isArray(explanation);

  const singleText = typeof explanation === "string"
    ? explanation
    : (
        data.aiExplanation ||
        data.analysis ||
        ""
      );

  const sections = [
    {
      title: "전체 데이터 요약",
      icon: "◈",
      text: isObject
        ? explanation.summary
        : `분석한 유효 회차는 ${Number(
            data.statistics?.roundCount ??
            data.stats?.totalDraws ??
            data.totalDraws ??
            0
          ).toLocaleString("ko-KR")}회입니다. ${singleText}`
    },
    {
      title: "출현 빈도 해설",
      icon: "↗",
      text: isObject
        ? explanation.frequency
        : "과거 출현 빈도는 기록된 결과를 요약한 통계이며, 다음 회차의 당첨 확률을 알려 주지는 않습니다."
    },
    {
      title: "번호 분포 해설",
      icon: "▤",
      text: isObject
        ? explanation.distribution
        : "홀짝과 번호 구간 분포는 실제 당첨 데이터에서 계산한 통계가 제공되어야 정확히 해설할 수 있습니다."
    },
    {
      title: "분석 조합 해설",
      icon: "✳",
      text: isObject
        ? explanation.combination
        : `생성된 번호 조합은 ${(data.numbers || data.recommendedNumbers || []).join(", ")}입니다. 참고용 무작위 조합이며 당첨을 예측하지 않습니다.`
    }
  ];

  const cards = sections.map((section) => `
    <article class="insight-card">
      <h3><span>${section.icon}</span>${escapeHTML(section.title)}</h3>
      <p>${escapeHTML(section.text || "이 항목의 해설이 제공되지 않았습니다.")}</p>
    </article>
  `).join("");

  container.innerHTML = `
    <div class="insight-grid">
      ${cards}
      <article class="insight-card wide">
        <h3><span>ⓘ</span>분석 결과를 해석할 때 주의할 점</h3>
        <p>${escapeHTML(
          (isObject && explanation.caution) ||
          "과거 통계와 AI 해설은 기록을 이해하기 위한 참고 자료입니다. 로또 추첨은 무작위이므로 과거 출현 빈도가 미래 당첨을 보장하지 않습니다."
        )}</p>
      </article>
    </div>
  `;
}

function renderDashboard(data) {
  renderNumbers(data.numbers || data.recommendedNumbers);

  // API가 보내는 두 가지 통계 형식을 모두 지원
  const stats = data.statistics || data.stats || {};
  const roundCount = Number(
    stats.roundCount ?? stats.totalDraws ?? data.totalDraws ?? 0
  );

  document.getElementById("roundCount").textContent =
    roundCount.toLocaleString("ko-KR");

  document.getElementById("latestRound").textContent =
    stats.latestRound
      ? `${stats.latestRound}회`
      : "-";

  document.getElementById("dataStatus").textContent =
    `분석 완료 · ${roundCount.toLocaleString("ko-KR")}개 회차`;

  renderFrequency(
    stats.frequency ||
    stats.hotNumbers ||
    []
  );

  renderDistribution("oddEvenStats", stats.oddEven || []);
  renderDistribution("rangeStats", stats.ranges || []);

  renderExplanation(data.explanation, data);
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
        data.message ||
        data.error ||
        "분석에 실패했습니다. 잠시 후 다시 시도해 주세요."
      );
    }

    renderDashboard(data);

    if (data.aiUsed === false && data.aiError) {
      console.warn("AI 해설 대신 기본 해설 표시:", data.aiError);
    }
  } catch (error) {
    console.error("AI analysis error:", error);
    showError(error.message || "서버 연결에 실패했습니다.");
  } finally {
    analyzeBtn.disabled = false;
    loading.classList.add("hidden");
  }
});
