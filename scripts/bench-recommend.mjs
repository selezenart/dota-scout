// Micro-benchmark for recommend(): one full 24-action Captains Mode draft with
// every data source loaded (127 heroes, 5 allies, 5 enemies, OpenDota matchups,
// STRATZ rows, meta stats). Calls recommend() once per turn, as the board does.
// Timing only, nothing asserted. Usage: node scripts/bench-recommend.mjs [rounds]
import {recommend} from '../web/draft-engine.js';
import {buildDraft, buildHeroes, buildMatchups, buildPlayers, buildStratz, NOW} from '../tests/recommend-scenarios.js';

const heroes = buildHeroes();
const input = {heroes, matchups: buildMatchups(heroes), stratz: buildStratz(heroes), now: NOW,
  allies: buildPlayers(heroes, 5, {prefix: 'a', selfReports: true}), opponents: buildPlayers(heroes, 6, {prefix: 'e', cup: true})};
const draft = buildDraft(heroes, 4, true, input.allies);
const fullDraft = () => { for (let n = 0; n < 24; n++) recommend({...input, draft: draft.slice(0, n)}); };

const rounds = Number(process.argv[2]) || 30;
for (let i = 0; i < 5; i++) fullDraft(); // warm-up
const times = [];
for (let i = 0; i < rounds; i++) { const t = performance.now(); fullDraft(); times.push(performance.now() - t); }
times.sort((a, b) => a - b);
const median = times[times.length >> 1], mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`recommend() full 24-action draft: median ${median.toFixed(1)} ms, mean ${mean.toFixed(1)} ms, min ${times[0].toFixed(1)} ms (${rounds} rounds; ${(median / 24).toFixed(2)} ms per call)`);
