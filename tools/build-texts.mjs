// 青空文庫の作品(XHTML版)を取得・整形して texts.js を作る。
// usage: node tools/build-texts.mjs [cacheDir]
//   cacheDir を指定すると、取得したHTMLをそこに保存し、次回からはそれを使う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = process.argv[2] || null;

// 新字新仮名版を使う。person は青空文庫の作家ID。
const WORKS = [
  { id: 'gongitsune', person: 121, title: 'ごん狐' },
  { id: 'tebukuro', person: 121, title: '手袋を買いに' },
  { id: 'akairousoku', person: 1475, title: '赤いろうそくと人魚' },
  { id: 'chumon', person: 81, title: '注文の多い料理店' },
  { id: 'yodaka', person: 81, title: 'よだかの星' },
  { id: 'kumonoito', person: 879, title: '蜘蛛の糸' },
  { id: 'torokko', person: 879, title: 'トロッコ' },
  { id: 'toshishun', person: 879, title: '杜子春' },
  { id: 'melos', person: 35, title: '走れメロス' },
  { id: 'yumejuya', person: 148, title: '夢十夜' },
];

// 外字画像(JIS X 0213の面区点) → Unicode
const GAIJI = {
  '1-87-71': '犍', // 特のへん＋廴＋聿
  '1-14-75': '匀', // 均のつくり
  '1-88-85': '睜', // 目＋爭
  '1-84-66': '戢', // 楫のつくり＋戈
};

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2000)).toLowerCase();
  return new TextDecoder(/shift_jis/.test(head) ? 'shift_jis' : 'utf-8').decode(buf);
}

async function fetchWork(w) {
  const cached = cacheDir && path.join(cacheDir, `${w.id}.json`);
  if (cached && fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const personUrl = `https://www.aozora.gr.jp/index_pages/person${w.person}.html`;
  const personHtml = await get(personUrl);
  const re = /<li><a href="(\.\.\/cards\/\d+\/card\d+\.html)">([^<]+)<\/a>[^<]*/g;
  let m, cardRel = null;
  while ((m = re.exec(personHtml))) {
    if (m[2].trim() === w.title && /新字新仮名/.test(m[0])) { cardRel = m[1]; break; }
  }
  if (!cardRel) throw new Error(`${w.title}: 図書カードが見つからない`);
  const cardUrl = new URL(cardRel, personUrl).href;
  const x = (await get(cardUrl)).match(/href="(\.\/files\/[^"]+\.html)"/);
  if (!x) throw new Error(`${w.title}: XHTMLへのリンクが見つからない`);
  const xhtmlUrl = new URL(x[1], cardUrl).href;
  const data = { cardUrl, xhtmlUrl, html: await get(xhtmlUrl) };
  if (cached) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cached, JSON.stringify(data), 'utf8');
  }
  return data;
}

const HEADING = '\u0001';

function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[e]);
}

function htmlToLines(html) {
  return decodeEntities(html
    .replace(/<img[^>]*src="[^"]*\/(\d-\d+-\d+)\.png"[^>]*>/g, (_, code) => {
      if (!GAIJI[code]) throw new Error(`未対応の外字 ${code}`);
      return GAIJI[code];
    })
    .replace(/<rp>[^<]*<\/rp>|<rt>[^<]*<\/rt>/g, '')       // ルビは親文字だけ残す
    .replace(/<span class="notes">[^<]*<\/span>/g, '')       // ［＃…］注記
    .replace(/<div class="chitsuki_\d+"[^>]*>.*?<\/div>/g, '') // 地付きの日付など
    .replace(/<h\d[^>]*>/g, `\n${HEADING}`)                  // 見出しの行に印をつける
    .replace(/<br\s*\/?>|<\/div>|<\/h\d>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n')
    .map(l => l.replace(/\s+$/u, ''))
    .filter(l => l.trim() !== '');
}

function parse(w, { cardUrl, xhtmlUrl, html }) {
  const author = html.match(/<meta name="DC.Creator" content="([^"]+)"/)[1];
  const main = html.match(/<div class="main_text">([\s\S]*?)<div class="bibliographical_information">/)[1];
  const bib = html.match(/<div class="bibliographical_information">([\s\S]*?)<\/div>/)[1];
  const bibLines = htmlToLines(bib);
  const pick = label => (bibLines.find(l => l.startsWith(label)) || '').slice(label.length);
  const teihonStart = bibLines.findIndex(l => l.startsWith('底本：'));
  const teihon = [];
  for (let i = teihonStart; i >= 0 && i < bibLines.length; i++) {
    if (i > teihonStart && !bibLines[i].startsWith('　')) break;
    teihon.push(bibLines[i].replace(/^底本：|^　+/g, ''));
  }
  const lines = htmlToLines(main);
  return {
    id: w.id,
    title: w.title,
    author,
    paragraphs: lines.map(l => l.replace(HEADING, '')),
    headings: lines.flatMap((l, i) => (l.startsWith(HEADING) ? [i] : [])),
    credit: { teihon: teihon.join(' '), input: pick('入力：'), proof: pick('校正：'), cardUrl, xhtmlUrl },
  };
}

const stories = [];
for (const w of WORKS) {
  const s = parse(w, await fetchWork(w));
  const chars = s.paragraphs.filter((_, i) => !s.headings.includes(i)).join('').replace(/\s/gu, '').length;
  console.log(`${s.id}\t${s.title}\t${s.author}\t${chars}字\t${s.paragraphs.length}段落\t見出し${s.headings.length}`);
  stories.push(s);
}

const out = `// 自動生成: node tools/build-texts.mjs
// 本文は青空文庫（https://www.aozora.gr.jp/）の新字新仮名版。ルビは親文字のみ残している。
window.STORIES = ${JSON.stringify(stories, null, 1)};
`;
fs.writeFileSync(path.join(ROOT, 'texts.js'), out, 'utf8');
console.log(`texts.js: ${stories.length}作品`);
