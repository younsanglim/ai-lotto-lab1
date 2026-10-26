
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "GET 또는 POST 요청만 허용됩니다.",
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.LOTTO_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      message: "Supabase 환경 변수를 확인해 주세요.",
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 기존 데이터에서 마지막 회차 확인
    const { data: latest, error: latestError } = await supabase
      .from("lotto_history")
      .select("round")
      .order("round", { ascending: false })
      .limit(1);

    if (latestError) throw latestError;

    const latestRound = latest?.[0]?.round || 0;

    // 동기화할 회차 지정: 기본적으로 다음 회차부터 시작
    const requestedRound = Number(req.query?.round);
    const startRound =
      Number.isInteger(requestedRound) && requestedRound > 0
        ? requestedRound
        : latestRound + 1;

    const maxRounds = Math.min(
      Math.max(Number(req.query?.count) || 1, 1),
      10
    );

    const synced = [];

    for (let round = startRound; round < startRound + maxRounds; round++) {
      const url =
        `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;

      const response = await fetch(url);
      if (!response.ok) break;

      const result = await response.json();

      // 아직 추첨되지 않은 회차는 건너뜀
      if (result.returnValue !== "success") break;

      const row = {
        round: result.drwNo,
        draw_date: result.drwNoDate,
        num1: result.drwtNo1,
        num2: result.drwtNo2,
        num3: result.drwtNo3,
        num4: result.drwtNo4,
        num5: result.drwtNo5,
        num6: result.drwtNo6,
        bonus: result.bnusNo,
      };

      const { error } = await supabase
        .from("lotto_history")
        .upsert(row, { onConflict: "round" });

      if (error) throw error;

      synced.push(round);
    }

    return res.status(200).json({
      success: true,
      message: `${synced.length}개 회차 동기화 완료`,
      latestRound,
      syncedRounds: synced,
    });
  } catch (error) {
    console.error("Lotto sync error:", error);

    return res.status(500).json({
      success: false,
      message: "로또 데이터 동기화에 실패했습니다.",
      error: error.message,
    });
  }
};
