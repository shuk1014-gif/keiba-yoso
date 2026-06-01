/**
 * JRA 出馬表自動取得 & 予想データ生成スクリプト
 *
 * 動作フロー:
 *  1. index.html から既登録レースIDを抽出
 *  2. 今後2週間の主要グレードレーススケジュールを走査
 *  3. keibabook / JRA官サイトから出馬表HTMLを取得
 *  4. Claude APIで馬データオブジェクトを生成
 *  5. RACES配列に挿入して index.html を更新
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HTML_PATH = path.join(__dirname, '..', 'index.html');

// ============================================================
// JRA 主要グレードレース年間スケジュール (2026年)
// ※ 出馬表確定後に自動取得するレースの候補リスト
// ============================================================
const RACE_SCHEDULE = [
  // 6月
  { id: 'yasuda2026',     name: '安田記念',         grade: 'G1', venue: '東京競馬場', date: '2026-06-07', raceNo: 11, distance: 1600, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'epsom2026',      name: 'エプソムC',         grade: 'G3', venue: '東京競馬場', date: '2026-06-14', raceNo: 11, distance: 1800, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'mermaid2026',    name: 'マーメイドS',       grade: 'G3', venue: '阪神競馬場', date: '2026-06-14', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・内回り', expectedPace: 'スロー' },
  { id: 'takarazuka2026', name: '宝塚記念',           grade: 'G1', venue: '阪神競馬場', date: '2026-06-28', raceNo: 11, distance: 2200, surface: '芝', courseFeature: '右回り・内回り', expectedPace: 'ミドル' },
  // 7月
  { id: 'hakodate_ss2026', name: '函館スプリントS', grade: 'G3', venue: '函館競馬場', date: '2026-07-05', raceNo: 11, distance: 1200, surface: '芝', courseFeature: '右回り・函館', expectedPace: 'ハイ' },
  { id: 'tanabata2026',   name: '七夕賞',             grade: 'G3', venue: '福島競馬場', date: '2026-07-12', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・福島', expectedPace: 'ミドル' },
  { id: 'hakodate_kinen2026', name: '函館記念',       grade: 'G3', venue: '函館競馬場', date: '2026-07-19', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・函館', expectedPace: 'スロー' },
  { id: 'niigata_kinen2026',  name: '関屋記念',       grade: 'G3', venue: '新潟競馬場', date: '2026-08-09', raceNo: 11, distance: 1600, surface: '芝', courseFeature: '左回り・外回り', expectedPace: 'ミドル' },
  { id: 'sapporo_kinen2026',  name: '札幌記念',       grade: 'G2', venue: '札幌競馬場', date: '2026-08-23', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・札幌', expectedPace: 'スロー' },
  // 秋シーズン
  { id: 'sprinters2026',  name: 'スプリンターズS',   grade: 'G1', venue: '中山競馬場', date: '2026-09-27', raceNo: 11, distance: 1200, surface: '芝', courseFeature: '右回り・中山', expectedPace: 'ハイ' },
  { id: 'shuka2026',      name: '秋華賞',             grade: 'G1', venue: '京都競馬場', date: '2026-10-11', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・京都', expectedPace: 'ミドル' },
  { id: 'tenno_aki2026',  name: '天皇賞(秋)',         grade: 'G1', venue: '東京競馬場', date: '2026-11-01', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'elizabeth2026',  name: 'エリザベス女王杯',   grade: 'G1', venue: '阪神競馬場', date: '2026-11-08', raceNo: 11, distance: 2200, surface: '芝', courseFeature: '右回り・内回り', expectedPace: 'スロー' },
  { id: 'mile_cs2026',    name: 'マイルCS',           grade: 'G1', venue: '阪神競馬場', date: '2026-11-22', raceNo: 11, distance: 1600, surface: '芝', courseFeature: '右回り・外回り', expectedPace: 'ミドル' },
  { id: 'jc2026',         name: 'ジャパンC',           grade: 'G1', venue: '東京競馬場', date: '2026-11-29', raceNo: 11, distance: 2400, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'arima2026',      name: '有馬記念',           grade: 'G1', venue: '中山競馬場', date: '2026-12-27', raceNo: 11, distance: 2500, surface: '芝', courseFeature: '右回り・中山', expectedPace: 'ミドル' },
];

// ============================================================
// keibabook URL パターン推定
// keibabook は YYYY + venue_code + meet_week + day + race_no の形式
// venue_code: 東京=02, 阪神=03? 中山=04?, 函館=06?, 福島=07?, 新潟=09?
// ============================================================
const VENUE_CODES = {
  '東京競馬場': '02',
  '阪神競馬場': '08',
  '中山競馬場': '06',
  '京都競馬場': '07',
  '中京競馬場': '09',
  '函館競馬場': '03',
  '福島競馬場': '01',
  '新潟競馬場': '02',  // 新潟は別コードの可能性あり
  '札幌競馬場': '04',
  '小倉競馬場': '10',
};

// ============================================================
// HTTP フェッチ (Node.js built-in)
// ============================================================
function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const makeRequest = (u, redirectsLeft) => {
      const mod = u.startsWith('https') ? https : http;
      const req = mod.get(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JRA-Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.5',
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          return makeRequest(res.headers.location, redirectsLeft - 1);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    };
    makeRequest(url, maxRedirects);
  });
}

// ============================================================
// 既登録レースIDを index.html から抽出
// ============================================================
function getRegisteredRaceIds(html) {
  const ids = [];
  const re = /id:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!m[1].startsWith('race00')) ids.push(m[1]);
  }
  return ids;
}

// ============================================================
// 出馬表URL を複数パターンで試す
// ============================================================
async function tryFetchRaceEntries(race) {
  const venueCode = VENUE_CODES[race.venue] || '02';
  const date = new Date(race.date);
  const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat

  // 試すURLパターンのリスト
  const urlPatterns = [];

  // keibabook パターン (week 1〜8, day 1〜2)
  for (let week = 1; week <= 8; week++) {
    for (let day = 1; day <= 2; day++) {
      const code = `2026${venueCode}${String(week).padStart(2,'0')}${day}`;
      const raceNo = String(race.raceNo).padStart(2, '0');
      urlPatterns.push(`https://s.keibabook.co.jp/cyuou/syutuba/${code}${raceNo}`);
    }
  }

  // JRA 官サイトパターン (日付ベース)
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  urlPatterns.push(`https://www.jra.go.jp/keiba/race/2026/${mm}${dd}/${String(race.raceNo).padStart(2,'0')}/index.html`);

  // netkeiba パターン (race_id 推定)
  // format: YYYY + venue_jra(05=Tokyo,08=Hanshin...) + meet + day_in_meet + race
  const JRA_VENUE = { '東京競馬場':'05', '阪神競馬場':'08', '中山競馬場':'06', '京都競馬場':'07', '中京競馬場':'09' };
  const jraCode = JRA_VENUE[race.venue] || '05';
  for (let meet = 1; meet <= 4; meet++) {
    for (let dayInMeet = 1; dayInMeet <= 12; dayInMeet++) {
      const raceId = `2026${jraCode}0${meet}${String(dayInMeet).padStart(2,'0')}1${String(race.raceNo).padStart(2,'0')}`;
      urlPatterns.push(`https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
    }
  }

  // それぞれのURLを試す (最初に成功したものを返す)
  for (const url of urlPatterns) {
    try {
      const res = await fetchUrl(url);
      if (res.status === 200 && isValidRacePage(res.body, race)) {
        console.log(`  ✓ 出馬表発見: ${url}`);
        return { url, html: res.body };
      }
    } catch (e) {
      // このURLは失敗、次を試す
    }
  }

  return null;
}

// 有効な出馬表ページかどうかを判定
function isValidRacePage(html, race) {
  if (html.length < 1000) return false;
  // 日本語の出馬表特有の文字列を確認
  const keywords = ['出走馬', '馬番', '騎手', '馬名', '斤量'];
  const found = keywords.filter(k => html.includes(k));
  return found.length >= 3;
}

// ============================================================
// Claude API: 出馬表HTMLから予想データを生成
// ============================================================
async function generateRaceDataWithClaude(race, html) {
  // HTMLを5000文字以内に切り詰め (Claude入力制限対策)
  const trimmedHtml = html.length > 8000 ? html.substring(0, 8000) + '...[省略]' : html;

  const today = new Date().toISOString().split('T')[0];

  const prompt = `あなたは競馬データアナリストです。以下の出馬表HTMLから、競馬予想アプリ用のJavaScriptオブジェクトを生成してください。

## レース情報
- レース名: ${race.name}
- 開催日: ${race.date}
- 競馬場: ${race.venue}
- グレード: ${race.grade}
- レース番号: ${race.raceNo}R
- 距離: ${race.distance}m
- 馬場: ${race.surface}
- コース: ${race.courseFeature}
- 予想ペース: ${race.expectedPace}

## 出馬表HTML
\`\`\`html
${trimmedHtml}
\`\`\`

## 出力形式
以下の形式のJavaScriptオブジェクトを生成してください。コードブロック(js)で囲むこと。

\`\`\`js
{
  id: "${race.id}",
  name: "${race.name}",
  venue: "${race.venue}",
  grade: "${race.grade}",
  raceNo: "${race.raceNo}R",
  date: "${race.date}",
  distance: ${race.distance},
  surface: "${race.surface}",
  trackCondition: "良",
  weather: "晴",
  courseFeature: "${race.courseFeature}",
  expectedPace: "${race.expectedPace}",
  desc: "（レースの特徴や見どころを100文字以内で）",
  horses: [
    {
      number: 1,
      name: "馬名",
      age: 4,
      sex: "牡",
      weight: 480,
      weightChange: 0,
      jockey: "騎手名",
      trainer: "調教師名",
      owner: "馬主名",
      breeder: "生産牧場",
      sire: "父馬名（推定可）",
      dam: "母馬名",
      damsire: "母父馬名（推定可）",
      odds: 0,
      stats: { wins: 2, second: 1, third: 1, total: 6 },
      trackPerf: { "良": 80, "稍重": 75, "重": 70, "不良": 60 },
      surfPerf: { "芝": 85, "ダート": 40 },
      distPerf: { sprint: 60, mile: 80, middle: 85, long: 70 },
      coursePerf: { right: 80, left: 80 },
      venuePref: 78,
      runningStyle: "差し",
      avgLast3f: 34.5,
      paceAdaptability: { high: 75, mid: 82, slow: 80 },
      jockeyWinRate: 0.12,
      jockeyVenueRate: 0.14,
      jockeyContinued: true,
      workoutGrade: "B",
      workoutNote: "標準的な仕上がり",
      conditionScore: 72,
      recentRaces: [
        { pos: 3, total: 12, name: "前走レース名", date: "2026-05-01",
          surface: "芝", distance: 1600, trackCondition: "良",
          last3f: 34.5, runningPos4: 5, pace: "ミドル" }
      ]
    }
  ]
}
\`\`\`

## 注意事項
- HTMLから実際の馬名・馬番・騎手名・斤量を正確に抽出すること
- 統計スコア（trackPerf等）は各馬のクラスと過去成績を踏まえて合理的に推定すること
- G1馬はスコアを高め(85-95)、条件戦馬は低め(65-75)に設定
- runningStyle は 逃げ/先行/差し/追込 から選ぶこと
- odds が不明な場合は 0 にすること
- 日本語の馬名・騎手名をそのまま使うこと
- 全馬分のデータを生成すること (省略しない)
`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text;

    // JavaScriptオブジェクトを抽出
    const match = text.match(/```(?:js|javascript)?\s*(\{[\s\S]+\})\s*```/);
    if (!match) {
      console.error('  ✗ Claude の応答からJSオブジェクトを抽出できませんでした');
      console.error('  Response preview:', text.substring(0, 500));
      return null;
    }

    return match[1];
  } catch (e) {
    console.error('  ✗ Claude API エラー:', e.message);
    return null;
  }
}

// ============================================================
// index.html の RACES 配列に新レースを挿入
// ============================================================
function insertRaceIntoHtml(html, raceJs, raceDate) {
  // RACES配列内の適切な位置に挿入 (日付順)
  // まず既存の最後のレースオブジェクトの直前か直後に追加

  // RACES配列の終端 "];" を見つける
  const racesEnd = html.lastIndexOf('\n];');
  if (racesEnd === -1) {
    console.error('  ✗ RACES配列の終端が見つかりません');
    return null;
  }

  // 最後の馬データの直後 ("}," の後) に追加
  const insertPos = racesEnd;
  const beforeInsert = html.substring(0, insertPos);
  const afterInsert  = html.substring(insertPos);

  // 直前がカンマで終わっているか確認
  const trimmed = beforeInsert.trimEnd();
  const needsComma = !trimmed.endsWith(',');

  const insertion = (needsComma ? ',' : '') + '\n  ' + raceJs;

  return beforeInsert + insertion + afterInsert;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY が設定されていません');
    process.exit(1);
  }

  console.log('=== JRA 出馬表自動更新スクリプト ===');
  console.log(`実行日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  // 現在のindex.htmlを読み込む
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const registeredIds = getRegisteredRaceIds(html);
  console.log(`\n既登録レースID: ${registeredIds.join(', ')}`);

  // 今後2週間のレースをフィルタ
  const today = new Date();
  const twoWeeksLater = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  const targetRaces = RACE_SCHEDULE.filter(race => {
    const raceDate = new Date(race.date);
    return raceDate >= today && raceDate <= twoWeeksLater && !registeredIds.includes(race.id);
  });

  if (targetRaces.length === 0) {
    console.log('\n今後2週間に追加対象のレースはありません');
    return;
  }

  console.log(`\n追加対象レース (${targetRaces.length}件):`);
  targetRaces.forEach(r => console.log(`  - ${r.date} ${r.name} ${r.grade}`));

  let updated = false;

  for (const race of targetRaces) {
    console.log(`\n[${race.name} ${race.grade} ${race.date}] 出馬表を取得中...`);

    const result = await tryFetchRaceEntries(race);

    if (!result) {
      console.log(`  → 出馬表未確定 (URLが見つかりません) — スキップ`);
      continue;
    }

    console.log(`  → 出馬表取得成功。Claude APIでデータ生成中...`);
    const raceJs = await generateRaceDataWithClaude(race, result.html);

    if (!raceJs) {
      console.log(`  → データ生成失敗 — スキップ`);
      continue;
    }

    // HTMLに挿入
    const newHtml = insertRaceIntoHtml(html, raceJs, race.date);
    if (!newHtml) {
      console.log(`  → HTML挿入失敗 — スキップ`);
      continue;
    }

    html = newHtml;
    updated = true;
    console.log(`  ✓ ${race.name} を追加しました`);
  }

  if (updated) {
    fs.writeFileSync(HTML_PATH, html, 'utf8');
    console.log(`\n✅ index.html を更新しました`);
  } else {
    console.log('\n変更はありませんでした');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
