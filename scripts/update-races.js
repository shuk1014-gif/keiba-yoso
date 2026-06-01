/**
 * JRA 出馬表自動取得 & 予想データ生成スクリプト (全レース対応版)
 *
 * 動作フロー:
 *  1. FULL_CARD_DATES: 指定日程の全12レース (R01-R12) を自動スキャン
 *  2. RACE_SCHEDULE: 7月以降の主要グレードレースを個別スキャン
 *  3. keibabook URLパターンをR11で探索し、見つかれば全レースに流用
 *  4. Claude APIでレース情報+馬データを生成
 *  5. index.html の RACES 配列を更新
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HTML_PATH = path.join(__dirname, '..', 'index.html');

// ============================================================
// 全レース走査対象日程 (6月 東京・阪神 全12R)
// 出馬表確定後 (木曜16時〜) に自動スキャンされる
// ============================================================
const FULL_CARD_DATES = [
  { date: '2026-06-06', venues: [
    { name: '東京競馬場', shortId: 'tokyo',   kbCode: '02', rotation: '左回り・直線502m', netkeibaVenue: '05' },
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り',   netkeibaVenue: '08' },
  ]},
  { date: '2026-06-07', venues: [
    { name: '東京競馬場', shortId: 'tokyo',   kbCode: '02', rotation: '左回り・直線502m', netkeibaVenue: '05' },
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り',   netkeibaVenue: '08' },
  ]},
  { date: '2026-06-13', venues: [
    { name: '東京競馬場', shortId: 'tokyo',   kbCode: '02', rotation: '左回り・直線502m', netkeibaVenue: '05' },
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り',   netkeibaVenue: '08' },
  ]},
  { date: '2026-06-14', venues: [
    { name: '東京競馬場', shortId: 'tokyo',   kbCode: '02', rotation: '左回り・直線502m', netkeibaVenue: '05' },
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り',   netkeibaVenue: '08' },
  ]},
  { date: '2026-06-27', venues: [
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り', netkeibaVenue: '08' },
  ]},
  { date: '2026-06-28', venues: [
    { name: '阪神競馬場', shortId: 'hanshin', kbCode: '08', rotation: '右回り・内回り', netkeibaVenue: '08' },
  ]},
];

// ============================================================
// 7月以降の主要グレードレース (FULL_CARD_DATES に含まれない日程)
// ============================================================
const RACE_SCHEDULE = [
  { id: 'hakodate_ss2026',    name: '函館スプリントS',  grade: 'G3', venue: '函館競馬場', date: '2026-07-05', raceNo: 11, distance: 1200, surface: '芝', courseFeature: '右回り・函館',     expectedPace: 'ハイ'   },
  { id: 'tanabata2026',       name: '七夕賞',           grade: 'G3', venue: '福島競馬場', date: '2026-07-12', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・福島',     expectedPace: 'ミドル' },
  { id: 'hakodate_kinen2026', name: '函館記念',         grade: 'G3', venue: '函館競馬場', date: '2026-07-19', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・函館',     expectedPace: 'スロー' },
  { id: 'niigata_kinen2026',  name: '関屋記念',         grade: 'G3', venue: '新潟競馬場', date: '2026-08-09', raceNo: 11, distance: 1600, surface: '芝', courseFeature: '左回り・外回り',   expectedPace: 'ミドル' },
  { id: 'sapporo_kinen2026',  name: '札幌記念',         grade: 'G2', venue: '札幌競馬場', date: '2026-08-23', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・札幌',     expectedPace: 'スロー' },
  { id: 'sprinters2026',      name: 'スプリンターズS',   grade: 'G1', venue: '中山競馬場', date: '2026-09-27', raceNo: 11, distance: 1200, surface: '芝', courseFeature: '右回り・中山',     expectedPace: 'ハイ'   },
  { id: 'shuka2026',          name: '秋華賞',           grade: 'G1', venue: '京都競馬場', date: '2026-10-11', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '右回り・京都',     expectedPace: 'ミドル' },
  { id: 'tenno_aki2026',      name: '天皇賞(秋)',       grade: 'G1', venue: '東京競馬場', date: '2026-11-01', raceNo: 11, distance: 2000, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'elizabeth2026',      name: 'エリザベス女王杯',  grade: 'G1', venue: '阪神競馬場', date: '2026-11-08', raceNo: 11, distance: 2200, surface: '芝', courseFeature: '右回り・内回り',   expectedPace: 'スロー' },
  { id: 'mile_cs2026',        name: 'マイルCS',         grade: 'G1', venue: '阪神競馬場', date: '2026-11-22', raceNo: 11, distance: 1600, surface: '芝', courseFeature: '右回り・外回り',   expectedPace: 'ミドル' },
  { id: 'jc2026',             name: 'ジャパンC',        grade: 'G1', venue: '東京競馬場', date: '2026-11-29', raceNo: 11, distance: 2400, surface: '芝', courseFeature: '左回り・直線502m', expectedPace: 'ミドル' },
  { id: 'arima2026',          name: '有馬記念',         grade: 'G1', venue: '中山競馬場', date: '2026-12-27', raceNo: 11, distance: 2500, surface: '芝', courseFeature: '右回り・中山',     expectedPace: 'ミドル' },
];

// ============================================================
// ユーティリティ
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchUrl(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const makeRequest = (u, left) => {
      const mod = u.startsWith('https') ? https : http;
      const req = mod.get(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JRA-Bot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.5',
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
          return makeRequest(res.headers.location, left - 1);
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

// 有効な出馬表ページかを判定 (日本語キーワードで確認)
function isValidRacePage(html) {
  if (html.length < 1000) return false;
  const keywords = ['出走馬', '馬番', '騎手', '馬名', '斤量'];
  return keywords.filter(k => html.includes(k)).length >= 3;
}

// ページが指定日付のレースか確認
function matchesDate(html, dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return html.includes(`${yyyy}年${mm}月${dd}日`) ||
         html.includes(`${mm}月${dd}日`) ||
         html.includes(dateStr);
}

// ============================================================
// keibabook URLパターン自動検出
// R11 で探索し、見つかったベースコードを返す (例: "202602051")
// 見つからなければ null
// ============================================================
async function findVenueDateBaseCode(venueConfig, date) {
  console.log(`    keibabook URLパターン探索中 (${venueConfig.name} ${date})...`);

  for (let week = 1; week <= 6; week++) {
    for (let day = 1; day <= 2; day++) {
      const baseCode = `2026${venueConfig.kbCode}${String(week).padStart(2, '0')}${day}`;
      const url = `https://s.keibabook.co.jp/cyuou/syutuba/${baseCode}11`;
      try {
        await sleep(150);
        const res = await fetchUrl(url);
        if (res.status === 200 && isValidRacePage(res.body)) {
          if (matchesDate(res.body, date)) {
            console.log(`    ✓ ベースコード発見: ${baseCode} (${url})`);
            return baseCode;
          }
        }
      } catch (e) { /* 次を試す */ }
    }
  }
  return null;
}

// ============================================================
// 指定ベースコード + レース番号で出馬表を取得
// ============================================================
async function fetchRaceByBaseCode(baseCode, raceNo) {
  const raceNoStr = String(raceNo).padStart(2, '0');
  const url = `https://s.keibabook.co.jp/cyuou/syutuba/${baseCode}${raceNoStr}`;
  try {
    const res = await fetchUrl(url);
    if (res.status === 200 && isValidRacePage(res.body)) {
      return { url, html: res.body };
    }
  } catch (e) { /* noop */ }
  return null;
}

// ============================================================
// RACE_SCHEDULE 用: 複数URLパターンを試してフェッチ
// ============================================================
const VENUE_CODES = {
  '東京競馬場': '02', '阪神競馬場': '08', '中山競馬場': '06',
  '京都競馬場': '07', '中京競馬場': '09', '函館競馬場': '03',
  '福島競馬場': '01', '新潟競馬場': '02', '札幌競馬場': '04', '小倉競馬場': '10',
};
const JRA_VENUE = {
  '東京競馬場': '05', '阪神競馬場': '08', '中山競馬場': '06', '京都競馬場': '07', '中京競馬場': '09',
};

async function tryFetchGradedRace(race) {
  const kbCode = VENUE_CODES[race.venue] || '02';
  const raceNoStr = String(race.raceNo).padStart(2, '0');
  const urlPatterns = [];

  for (let week = 1; week <= 8; week++) {
    for (let day = 1; day <= 2; day++) {
      const code = `2026${kbCode}${String(week).padStart(2, '0')}${day}`;
      urlPatterns.push(`https://s.keibabook.co.jp/cyuou/syutuba/${code}${raceNoStr}`);
    }
  }

  const jraCode = JRA_VENUE[race.venue] || '05';
  for (let meet = 1; meet <= 4; meet++) {
    for (let dayInMeet = 1; dayInMeet <= 12; dayInMeet++) {
      const raceId = `2026${jraCode}0${meet}${String(dayInMeet).padStart(2,'0')}${raceNoStr}`;
      urlPatterns.push(`https://race.netkeiba.com/race/shutuba.html?race_id=${raceId}`);
    }
  }

  for (const url of urlPatterns) {
    try {
      await sleep(150);
      const res = await fetchUrl(url);
      if (res.status === 200 && isValidRacePage(res.body)) {
        console.log(`    ✓ 出馬表発見: ${url}`);
        return { url, html: res.body };
      }
    } catch (e) { /* 次を試す */ }
  }
  return null;
}

// ============================================================
// 登録済みレースのスロット (date_venue_raceNo) をHTMLから抽出
// 既存レースとの重複チェックに使用
// ============================================================
function buildRegisteredSlots(html) {
  const slots = new Set();
  const dateRe = /date:\s*["'](\d{4}-\d{2}-\d{2})["']/g;
  let m;
  while ((m = dateRe.exec(html)) !== null) {
    const pos = m.index;
    const ctx = html.substring(Math.max(0, pos - 2000), pos + 500);
    const venueM = ctx.match(/venue:\s*["']([^"']+)["']/);
    const raceNoM = ctx.match(/raceNo:\s*["'](\d+)R["']/);
    if (venueM && raceNoM) {
      slots.add(`${m[1]}_${venueM[1]}_${raceNoM[1]}`);
    }
  }
  return slots;
}

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
// Claude API: 全カード用 — レース情報の抽出 + 馬データ生成
// ============================================================
async function generateFullCardRaceData(date, venueConfig, raceNo, html) {
  const trimmedHtml = html.length > 8000 ? html.substring(0, 8000) + '...[省略]' : html;
  const raceNoStr = String(raceNo).padStart(2, '0');
  const dateNoDash = date.replace(/-/g, '');
  const raceId = `r${raceNoStr}_${venueConfig.shortId}_${dateNoDash}`;

  const prompt = `あなたは競馬データアナリストです。以下の出馬表HTMLから、競馬予想アプリ用のJavaScriptオブジェクトを生成してください。

## 基本情報
- 競馬場: ${venueConfig.name}
- 開催日: ${date}
- レース番号: ${raceNo}R
- コース回り: ${venueConfig.rotation}
- レースID: ${raceId}

## 出馬表HTML
\`\`\`html
${trimmedHtml}
\`\`\`

## 指示
HTMLからレース名・グレード・距離・馬場・出走馬情報を正確に抽出し、以下の形式のJavaScriptオブジェクトを生成してください（コードブロック \`\`\`js で囲む）。

\`\`\`js
{
  id: "${raceId}",
  name: "（HTMLから抽出したレース名）",
  venue: "${venueConfig.name}",
  grade: "（G1/G2/G3/OP/3勝/2勝/1勝/新馬/未勝利 のいずれか）",
  raceNo: "${raceNo}R",
  date: "${date}",
  distance: 1600,
  surface: "芝",
  trackCondition: "良",
  weather: "晴",
  courseFeature: "${venueConfig.rotation}",
  expectedPace: "ミドル",
  desc: "（レースの特徴・見どころを100文字以内で）",
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
      sire: "父馬名",
      dam: "母馬名",
      damsire: "母父馬名",
      odds: 0,
      stats: { wins: 2, second: 1, third: 1, total: 6 },
      trackPerf: { "良": 75, "稍重": 70, "重": 65, "不良": 55 },
      surfPerf: { "芝": 80, "ダート": 50 },
      distPerf: { sprint: 65, mile: 78, middle: 82, long: 68 },
      coursePerf: { right: 75, left: 75 },
      venuePref: 72,
      runningStyle: "差し",
      avgLast3f: 35.0,
      paceAdaptability: { high: 72, mid: 78, slow: 75 },
      jockeyWinRate: 0.10,
      jockeyVenueRate: 0.12,
      jockeyContinued: true,
      workoutGrade: "B",
      workoutNote: "標準的な仕上がり",
      conditionScore: 70,
      recentRaces: [
        { pos: 3, total: 10, name: "前走レース名", date: "2026-05-01",
          surface: "芝", distance: 1600, trackCondition: "良",
          last3f: 35.0, runningPos4: 5, pace: "ミドル" }
      ]
    }
  ]
}
\`\`\`

## 注意事項
- HTMLから実際の馬名・馬番・騎手名・斤量を正確に抽出すること
- 全馬分のデータを生成すること（省略しない）
- G1/G2/G3はスコアを高め(85-95)、条件戦は低め(65-75)に設定
- runningStyle は 逃げ/先行/差し/追込 から選ぶこと
- oddsが不明な場合は 0 にすること
`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].text;
    const match = text.match(/```(?:js|javascript)?\s*(\{[\s\S]+\})\s*```/);
    if (!match) {
      console.error(`    ✗ Claudeの応答からJSオブジェクトを抽出できませんでした`);
      return null;
    }
    return match[1];
  } catch (e) {
    console.error(`    ✗ Claude API エラー:`, e.message);
    return null;
  }
}

// ============================================================
// Claude API: グレードレース用 (レース情報が既知)
// ============================================================
async function generateGradedRaceData(race, html) {
  const trimmedHtml = html.length > 8000 ? html.substring(0, 8000) + '...[省略]' : html;

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
以下の形式のJavaScriptオブジェクトを生成してください（\`\`\`js で囲むこと）。

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
      sire: "父馬名",
      dam: "母馬名",
      damsire: "母父馬名",
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
- 全馬分のデータを生成すること（省略しない）
- G1馬はスコアを高め(85-95)、条件戦馬は低め(65-75)に設定
- runningStyle は 逃げ/先行/差し/追込 から選ぶこと
- oddsが不明な場合は 0 にすること
`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].text;
    const match = text.match(/```(?:js|javascript)?\s*(\{[\s\S]+\})\s*```/);
    if (!match) {
      console.error(`    ✗ Claudeの応答からJSオブジェクトを抽出できませんでした`);
      return null;
    }
    return match[1];
  } catch (e) {
    console.error(`    ✗ Claude API エラー:`, e.message);
    return null;
  }
}

// ============================================================
// index.html の RACES 配列末尾に新レースを挿入
// ============================================================
function insertRaceIntoHtml(html, raceJs) {
  const racesEnd = html.lastIndexOf('\n];');
  if (racesEnd === -1) {
    console.error('    ✗ RACES配列の終端が見つかりません');
    return null;
  }
  const before = html.substring(0, racesEnd);
  const after  = html.substring(racesEnd);
  const needsComma = !before.trimEnd().endsWith(',');
  return before + (needsComma ? ',' : '') + '\n  ' + raceJs + after;
}

// ============================================================
// 全カード日程の処理 (R01-R12 全スキャン)
// ============================================================
async function processFullCardDate(dateConfig, registeredSlots, currentHtml) {
  const { date, venues } = dateConfig;
  let html = currentHtml;
  let anyUpdated = false;

  for (const venue of venues) {
    console.log(`\n  [全カード] ${date} ${venue.name}`);

    // keibabook URLパターンをR11で探索
    const baseCode = await findVenueDateBaseCode(venue, date);
    if (!baseCode) {
      console.log(`    → keibabook URLパターンが見つかりません。出馬表未確定のためスキップ`);
      continue;
    }

    // R01-R12 を順番に取得
    for (let raceNo = 1; raceNo <= 12; raceNo++) {
      const slot = `${date}_${venue.name}_${raceNo}`;
      if (registeredSlots.has(slot)) {
        console.log(`    R${String(raceNo).padStart(2,'0')}: 既登録 — スキップ`);
        continue;
      }

      console.log(`    R${String(raceNo).padStart(2,'0')}: 取得中...`);
      await sleep(200);
      const result = await fetchRaceByBaseCode(baseCode, raceNo);
      if (!result) {
        console.log(`    R${String(raceNo).padStart(2,'0')}: 取得失敗 — スキップ`);
        continue;
      }

      console.log(`    R${String(raceNo).padStart(2,'0')}: Claude APIでデータ生成中...`);
      const raceJs = await generateFullCardRaceData(date, venue, raceNo, result.html);
      if (!raceJs) {
        console.log(`    R${String(raceNo).padStart(2,'0')}: データ生成失敗 — スキップ`);
        continue;
      }

      const newHtml = insertRaceIntoHtml(html, raceJs);
      if (!newHtml) {
        console.log(`    R${String(raceNo).padStart(2,'0')}: HTML挿入失敗 — スキップ`);
        continue;
      }

      html = newHtml;
      registeredSlots.add(slot);
      anyUpdated = true;
      console.log(`    ✓ R${String(raceNo).padStart(2,'0')} 追加完了`);
    }
  }

  return { html, anyUpdated };
}

// ============================================================
// グレードレース (RACE_SCHEDULE) の処理
// ============================================================
async function processGradedRaces(registeredIds, registeredSlots, currentHtml) {
  const today = new Date();
  const twoWeeksLater = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  const targets = RACE_SCHEDULE.filter(race => {
    const raceDate = new Date(race.date);
    return raceDate >= today && raceDate <= twoWeeksLater && !registeredIds.includes(race.id);
  });

  if (targets.length === 0) return { html: currentHtml, anyUpdated: false };

  console.log(`\n[グレードレース] ${targets.length}件を処理:`);
  targets.forEach(r => console.log(`  - ${r.date} ${r.name} ${r.grade}`));

  let html = currentHtml;
  let anyUpdated = false;

  for (const race of targets) {
    // スロットチェック (日付+競馬場+レース番号が重複していないか)
    const slot = `${race.date}_${race.venue}_${race.raceNo}`;
    if (registeredSlots.has(slot)) {
      console.log(`\n  [${race.name}] スロット重複 (別IDで既登録) — スキップ`);
      continue;
    }

    console.log(`\n  [${race.name} ${race.grade} ${race.date}] 出馬表を取得中...`);
    const result = await tryFetchGradedRace(race);

    if (!result) {
      console.log(`    → 出馬表未確定 — スキップ`);
      continue;
    }

    console.log(`    → 出馬表取得成功。Claude APIでデータ生成中...`);
    const raceJs = await generateGradedRaceData(race, result.html);
    if (!raceJs) {
      console.log(`    → データ生成失敗 — スキップ`);
      continue;
    }

    const newHtml = insertRaceIntoHtml(html, raceJs);
    if (!newHtml) {
      console.log(`    → HTML挿入失敗 — スキップ`);
      continue;
    }

    html = newHtml;
    registeredSlots.add(slot);
    anyUpdated = true;
    console.log(`    ✓ ${race.name} を追加しました`);
  }

  return { html, anyUpdated };
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY が設定されていません');
    process.exit(1);
  }

  console.log('=== JRA 出馬表自動更新スクリプト (全レース対応版) ===');
  console.log(`実行日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const registeredIds   = getRegisteredRaceIds(html);
  const registeredSlots = buildRegisteredSlots(html);

  console.log(`\n既登録レースID: ${registeredIds.join(', ')}`);
  console.log(`既登録スロット数: ${registeredSlots.size}`);

  const today = new Date();
  const twoWeeksLater = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

  // 今後2週間に開催されるFULL_CARD_DATESをフィルタ
  const targetFullCards = FULL_CARD_DATES.filter(d => {
    const dt = new Date(d.date + 'T00:00:00+09:00');
    return dt >= today && dt <= twoWeeksLater;
  });

  let totalUpdated = false;

  // 全カード日程を処理
  for (const dateConfig of targetFullCards) {
    const result = await processFullCardDate(dateConfig, registeredSlots, html);
    html = result.html;
    if (result.anyUpdated) totalUpdated = true;
  }

  // グレードレースを処理 (FULL_CARDでカバーされない7月以降)
  const gradedResult = await processGradedRaces(registeredIds, registeredSlots, html);
  html = gradedResult.html;
  if (gradedResult.anyUpdated) totalUpdated = true;

  if (totalUpdated) {
    fs.writeFileSync(HTML_PATH, html, 'utf8');
    console.log('\n✅ index.html を更新しました');
  } else {
    console.log('\n変更はありませんでした (出馬表未確定 or 全レース登録済み)');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
