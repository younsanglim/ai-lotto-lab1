```javascript
// 과거 당첨 번호 통계 기능
const loadStatsButton = document.getElementById("loadStatsButton");
const statsMessage = document.getElementById("statsMessage");
const statsResults = document.getElementById("statsResults");

loadStatsButton.addEventListener("click", async () => {
  loadStatsButton.disabled = true;
  statsMessage.textContent = "당첨 데이터를 불러오는 중이에요...";
  statsResults.innerHTML = "";

  try {
    const response = await fetch(
      "https://api.lotto-haru.kr/win/analysis.json"
    );

    if (!response.ok) {
      throw new Error("데이터 요청 실패");
    }

    const rawData = await response.json();
    const draws = Array.isArray(rawData)
      ? rawData
      : [rawData];

    const validDraws = draws
      .map((draw) => ({
        round: Number(draw.chasu ?? draw.draw_no ?? draw.round),
        date: draw.date ?? "",
        numbers: draw.ball ?? draw.numbers,
      }))
      .filter(
        (draw) =>
          Number.isFinite(draw.round) &&
          Array.isArray(draw.numbers) &&
          draw.numbers.length === 6 &&
          draw.numbers.every(
            (number) =>
              Number.isInteger(Number(number)) &&
              Number(number) >= 1 &&
              Number(number) <= 45
          )
      )
      .sort((a, b) => a.round - b.round);

    if (validDraws.length === 0) {
      throw new Error("분석할 수 있는 데이터가 없어요.");
    }

    const frequency = Array(46).fill(0);

    validDraws.forEach((draw) => {
      draw.numbers.forEach((number) => {
        frequency[Number(number)]++;
      });
    });

    const recentDraws = validDraws.slice(-5).reverse();

    const mostFrequent = Array.from(
      { length: 45 },
      (_, index) => index + 1
    )
      .sort(
        (a, b) =>
          frequency[b] - frequency[a] || a - b
      )
      .slice(0, 10);

    statsResults.innerHTML = `
      <div class="stat-card">
        <h3>분석한 회차</h3>
        <p>${validDraws.length.toLocaleString()}회</p>
      </div>

      <div class="stat-card">
        <h3>가장 자주 나온 번호</h3>
        <p>
          ${mostFrequent
            .map(
              (number) =>
                `${number}번 (${frequency[number]}회)`
            )
            .join("<br>")}
        </p>
      </div>

      <div class="stat-card">
        <h3>최근 당첨 번호</h3>
        <p>
          ${recentDraws
            .map(
              (draw) =>
                `${draw.round}회: ${draw.numbers.join(", ")}`
            )
            .join("<br>")}
        </p>
      </div>
    `;

    statsMessage.textContent =
      "통계 데이터를 불러왔어요. 과거 출현 빈도가 다음 회차의 당첨 확률을 높여 주지는 않습니다.";
  } catch (error) {
    console.error(error);
    statsMessage.textContent =
      "데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
  } finally {
    loadStatsButton.disabled = false;
  }
});
```
