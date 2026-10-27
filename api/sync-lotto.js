
const { createClient } = require("@supabase/supabase-js");

const LOTTO_API =
  "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";

async function getDraw(round) {
  const response = await fetch(LOTTO_API + round);

  if (!response.ok) {
    throw new Error(`로또 API 응답 오류: HTTP ${response.status}`);
  }

  return response.json();
}

async function findLatestRound() {
  let low = 1;
  let high = 2000;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const data = await getDraw(mid);

    if (data.returnValue === "success") {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const latest = await getDraw(low);

  if (latest.returnValue !== "success") {
    throw new Error("최신 당첨 회차를 확인하지 못했습니다.");
  }

  return low;
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      success: false,
      message: "GET 또는 POST 요청만 허용됩니다."
    });
  }

  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !key) {
    return res.status(500).json({
      success: false,
      message: "Supabase 서버 환경 변수를 확인해 주세요."
    });
  }

  try {
    const supabase = createClient(url, key);
    const latestRound = await findLatestRound();

    // 최근 30회 당첨 번호를 가져옵니다.
    const startRound = Math.max(1, latestRound - 29);
    const fetched = [];

    for (let start = startRound; start <= latestRound; start += 10) {
      const end = Math.min(start + 9, latestRound);
      const batch = await Promise.all(
        Array.from(
          { length: end - start + 1 },
          (_, i) => getDraw(start + i)
        )
      );

      fetched.push(...batch);
    }

    const records = fetched
      .filter(data => data.returnValue === "success")
      .map(data => ({
        draw_number: Number(data.drwNo),
        numbers: [
          Number(data.drwtNo1),
          Number(data.drwtNo2),
          Number(data.drwtNo3),
          Number(data.drwtNo4),
          Number(data.drwtNo5),
          Number(data.drwtNo6)
        ]
      }))
      .filter(row =>
        Number.isInteger(row.draw_number) &&
        row.numbers.every(n =>
          Number.isInteger(n) && n >= 1 && n <= 45
        ) &&
        new Set(row.numbers).size === 6
      );

    if (records.length === 0) {
      throw new Error("유효한 당첨 번호를 가져오지 못했습니다.");
    }

    // 기존 회차를 확인하여 중복 저장을 방지합니다.
    const { data: existing, error: readError } = await supabase
      .from("lotto_history")
      .select("draw_number")
      .in("draw_number", records.map(row => row.draw_number));

    if (readError) {
      console.error("Existing rows query error:", readError);
      throw new Error(
        "기존 데이터 확인 실패: " + readError.message
      );
    }

    const existingRounds = new Set(
      (existing || []).map(row => Number(row.draw_number))
    );

    const newRecords = records.filter(
      row => !existingRounds.has(row.draw_number)
    );

    if (newRecords.length > 0) {
      const { error: insertError } = await supabase
        .from("lotto_history")
        .insert(newRecords);

      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error(
          "당첨 번호 저장 실패: " + insertError.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      latestRound,
      fetched: records.length,
      inserted: newRecords.length,
      message: newRecords.length
        ? `${newRecords.length}개 회차의 당첨 번호를 저장했습니다.`
        : "가져온 회차의 데이터가 이미 저장되어 있습니다."
    });
  } catch (error) {
    console.error("Lotto sync error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "당첨 번호 동기화에 실패했습니다."
    });
  }
};
