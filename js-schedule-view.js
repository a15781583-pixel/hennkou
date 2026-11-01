/* 【確認用・動作確認後に削除してよい】読み込まれた版を画面右下に表示する */
window.SCHEDULE_VIEW_VERSION = 'view-v3 / 20261101b';
console.info('[js-schedule-view] ' + window.SCHEDULE_VIEW_VERSION);
document.addEventListener('DOMContentLoaded', function () {
  var b = document.createElement('div');
  b.textContent = window.SCHEDULE_VIEW_VERSION;
  b.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:99999;background:#1f6f43;color:#fff;font-size:11px;padding:3px 8px;border-radius:10px;opacity:.85;pointer-events:none;';
  document.body.appendChild(b);
});

/* =========================================================
   js-schedule-view.js  ─  ③-b スケジュールへの反映（画面）
   ---------------------------------------------------------
   【こんなときに、このファイルを開く】
    ・「スケジュール」タブの表示（表・カレンダー・バッジ・凡例）を直したい
    ・「今日やること」と進捗入力の画面・保存ボタンの動きを直したい
    ・月目標カード、今週のまとめ、「次のタスク設定」案内を直したい
    ・※ 日付や再配分の計算結果がおかしいときは js-schedule-calc.js
   【読み込み順】 ⑥ js-common.js の後
   ※ 中身のコードは、分割前の js-app.js と同一です（場所を移しただけ）。
========================================================= */

/* ───────── 復習間隔の色分け・バッジの表示部品 ───────── */
// ── 復習インターバルの階層スタイルを返すヘルパー ──────────────
function getIntervalTier(interval) {
  if (interval <= 1) return 1;
  if (interval <= 3) return 2;
  if (interval <= 7) return 3;
  return 4;
}
// 階層(tier)ごとの表示情報を一元管理する。ラベル文字列はここが唯一の定義箇所であり、
// 凡例（reviewLegendHTML）・復習スロット表示（renderProgressedReviews 等）は
// 必ず getIntervalTierStyle() 経由で参照することで、表記のズレや二重管理を防ぐ。
// index 0 はダミー（tier番号=配列indexに揃えるため）。
const INTERVAL_TIER_STYLES = [
  null,
  { label: 'Lv.1 初期',   legendDays: '1日後'   },
  { label: 'Lv.2 定着',   legendDays: '3日後'   },
  { label: 'Lv.3 強化',   legendDays: '7日後'   },
  { label: 'Lv.4 仕上げ', legendDays: '14日後〜' },
];
function getIntervalTierStyle(tier) {
  return INTERVAL_TIER_STYLES[tier] || { label: '', legendDays: '' };
}
function reviewLegendHTML() {
  const badges = [1, 2, 3, 4].map(tier => {
    const { label, legendDays } = getIntervalTierStyle(tier);
    return `<span class="review-legend-badge tag-review-t${tier}">${label} <small>${legendDays}</small></span>`;
  }).join('\n    ');
  // 【改善】凡例は初期状態で折りたたみ、「今日やること」が最初に目に入るようにする
  return `<details class="review-legend-fold"><summary>🎯 復習ステップの見方</summary>
  <div class="review-legend">
    <span class="review-legend-label">🎯 復習ステップ：</span>
    ${badges}
    <span style="color:var(--ink-soft); margin-left:4px; font-size:.72rem;">数字が大きいほど記憶定着の山場です</span>
  </div></details>`;
}
// ──────────────────────────────────────────────────────────────

// ── STEP 8：統一バッジ生成ヘルパー ────────────────────────────

/**
 * 「未完了」バッジのHTMLを返す（テーブルビュー・カードビュー共通）
 * 【変更】表示を「未完了繰越 [日付]」から「未完了」に一本化（日付は表示しない）。
 * @param {string|null} [originalDate] - 互換のため引数は残すが、表示には使わない
 * @param {string} [cls='carry-badge'] - 付与するクラス名
 */
function buildCarryBadgeHtml(originalDate, cls = 'carry-badge') {
  return `<span class="${cls}" style="background:#fff7ed;color:#9a3412;border-color:#fed7aa;">⚠️ 未完了</span>`;
}

/**
 * 「復習」バッジのHTMLを返す（テーブルビュー・カードビュー共通）
 * @param {number} interval    - 復習インターバル日数（1/3/7/14 等）
 * @param {number} delayedDays - 遅れ日数（0 なら遅れなし）
 * @param {'inline'|'block'}  [layout='inline'] - 'block' ならラベルをブロック要素で包む
 */
function buildReviewBadgeHtml(interval, delayedDays, layout = 'inline') {
  const tier = getIntervalTier(interval);
  // 🔁 復習 Lv.X [N日後]
  // 色は css-style.css の .tag-review-t{tier} を流用（JS側でのハードコード二重管理を回避）
  const mainBadge = `<span class="tag-review-t${tier}" style="display:inline-flex;align-items:center;gap:3px;border-radius:4px;padding:1px 6px;font-size:.68rem;font-weight:700;white-space:nowrap;">🔁 復習 Lv.${tier} [${interval}日後]</span>`;
  // 🔄 [遅れN日]（遅れがある場合のみ）
  const delayBadge = delayedDays > 0
    ? `<span style="display:inline-flex;align-items:center;background:#b23a2e;color:#fff;border-radius:4px;padding:1px 6px;font-size:.68rem;font-weight:700;white-space:nowrap;">🔄 [遅れ${delayedDays}日]</span>`
    : '';
  return `${mainBadge}${delayBadge ? ' ' + delayBadge : ''}`;
}

/**
 * 統合スケジュール（buildDayCard）の「新規タスク1件」分のHTMLを返す（単語・参考書共通）。
 * 色・ラベル文字列・書名フォールバックの有無だけが種別（kind）によって異なる。
 * @param {object} item - チャンク（w または b）。carriedForward/isCarriedNew/bookName/rangeStart/rangeEnd を参照
 * @param {'word'|'book'} kind
 */
const DAY_TASK_KIND_STYLES = {
  word: { label: '単語',   bg: '#e3f2fd', fg: '#0d47a1', nameFallback: '単語' },
  book: { label: '参考書', bg: '#e8f5e9', fg: '#1b5e20', nameFallback: null },
};
function buildDayTaskItemHtml(item, kind) {
  const { label, bg, fg, nameFallback } = DAY_TASK_KIND_STYLES[kind];
  const carryBadge = item.carriedForward
    ? buildCarryBadgeHtml(item.originalDate)
    : (item.isCarriedNew ? buildCarryBadgeHtml(item.originalDate || null) : '');
  const displayName = nameFallback !== null ? (item.bookName || nameFallback) : item.bookName;
  return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;"><span style="background:${bg};color:${fg};padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;">${label}</span>${carryBadge}<span style="color:#333;font-size:.85rem;">${escapeHtml(displayName)}: ${item.rangeStart} 〜 ${item.rangeEnd}</span></div>`;
}

/**
 * 統合スケジュール（buildDayCard）の「復習タスク1件」分のHTMLを返す（単語・参考書共通）。
 * 単語復習のみ bookName 未設定時に「単語」とフォールバック表示する点が唯一の差分。
 * @param {object} r - 復習項目。interval/delayedDays/done/key/bookName/rangeStart/rangeEnd を参照
 * @param {'word'|'book'} kind
 */
function buildDayReviewItemHtml(r, kind) {
  const tier = getIntervalTier(r.interval);
  const reviewBadge = buildReviewBadgeHtml(r.interval, r.delayedDays);
  const displayName = kind === 'word' ? (r.bookName || '単語') : r.bookName;
  // 【変更】チェックボックスを廃止。表示専用（状態アイコンのみ）。入力は「今日の進捗を入力」パネルで行う。
  return `<div style="margin-top:6px;max-width:100%;overflow:hidden;"><div class="tag-review-t${tier} review-check-label${r.done ? ' is-done' : ''}" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 9px;border-radius:6px;${r.done ? 'opacity:.5;text-decoration:line-through;' : ''}">${reviewStatusIconHtml(r)}${reviewBadge}<span style="color:#333;font-size:.8rem;word-break:break-all;">${escapeHtml(displayName)} ${r.rangeStart}〜${r.rangeEnd}</span></div></div>`;
}

/**
 * 復習1件の状態アイコン（表示専用）。✅完了／⚠️途中／🚫進んでいない／⬜未記録。
 * まだ先の日付の復習は、状態を出さない（空文字）。
 */
function reviewStatusIconHtml(r) {
  if (r.date > todayISO()) return '';
  const meta = {
    done:       ['rs-done',    '✅'],
    partial:    ['rs-partial', '⚠️ 途中'],
    none:       ['rs-none',    '🚫'],
    unrecorded: ['rs-pending', '⬜'],
  };
  const [cls, label] = meta[classifyReviewStatus(r)] || meta.unrecorded;
  return `<span class="review-status ${cls}">${label}</span>`;
}

/**
 * 「やった日」入力欄のHTML（新規タスクの進捗入力用）。
 * 入力日（今日）と実際にやった日が違うとき（前日にやったが入力を忘れた等）に、復習の起点がずれないようにする。
 * @param {string} defaultDate - 初期値（YYYY-MM-DD）
 * @param {string} plannedDate - 本来の予定日（なければ今日と同じ値）
 * @param {string} todayStr    - 今日（YYYY-MM-DD）
 */
function buildDoneDateRowHtml(defaultDate, plannedDate, todayStr) {
  const yesterday = formatISO(addDays(parseISO(todayStr), -1));
  const md = (iso) => { const d = parseISO(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const chips = [];
  if (plannedDate && plannedDate < todayStr) chips.push({ date: plannedDate, label: `予定日 ${md(plannedDate)}` });
  if (!chips.some(c => c.date === yesterday)) chips.push({ date: yesterday, label: '昨日' });
  chips.push({ date: todayStr, label: '今日' });
  const open = defaultDate !== todayStr; // 今日以外が初期値のときは最初から開いておく
  const chipsHtml = chips.map(c =>
    `<button type="button" class="prog-done-chip" data-date="${c.date}">${c.label}</button>`).join('');
  return `<div class="prog-done-date-wrap">
    <button type="button" class="prog-done-date-toggle"${open ? ' style="display:none"' : ''}>📅 やった日を変更</button>
    <div class="prog-done-date-row" style="display:${open ? 'flex' : 'none'}">
      <span class="prog-done-date-label">📅 やった日</span>
      <input type="date" class="prog-done-date" value="${defaultDate}" max="${todayStr}">
      ${chipsHtml}
    </div>
  </div>`;
}

// 「やった日」入力欄の動き（変更リンク・クイック選択ボタン・日付入力）を設定する
function initDoneDateControls(container) {
  container.querySelectorAll('.prog-done-date-wrap').forEach(wrap => {
    const input  = wrap.querySelector('.prog-done-date');
    const row    = wrap.querySelector('.prog-done-date-row');
    const toggle = wrap.querySelector('.prog-done-date-toggle');
    const chips  = wrap.querySelectorAll('.prog-done-chip');
    const sync = () => chips.forEach(c => c.classList.toggle('active', c.dataset.date === input.value));
    toggle?.addEventListener('click', () => { row.style.display = 'flex'; toggle.style.display = 'none'; });
    chips.forEach(c => c.addEventListener('click', () => { input.value = c.dataset.date; sync(); }));
    input.addEventListener('change', sync);
    sync();
  });
}

// 日付をまたいで開いたままの画面を、最新の日付で描き直す（古い日付のまま入力・保存されるのを防ぐ）
let integratedRenderedDate = null; // 「スケジュール」タブを最後に描画した日（YYYY-MM-DD）
function refreshIfDateChanged() {
  if (!integratedRenderedDate || integratedRenderedDate === todayISO()) return;
  try {
    renderAll();
    renderIntegratedSchedule();
    renderRefTodayCard();
  } catch (e) { console.error('[refreshIfDateChanged] 再描画に失敗:', e); }
}
// ──────────────────────────────────────────────────────────────

/* ───────── 復習の完了状態を書き込む「唯一の入口」 ───────── */
// 復習の完了は「reviewDoneSet（完了済みキー）」と「dailyProgress（進捗記録）」の2か所に表れる。
// 進捗入力パネルから操作したとき、必ずこの関数群を通して両方を同じ状態にする。
// （復習の完了チェックボックスは廃止し、復習の入力は「今日の進捗を入力」パネルに一本化した）
// （以前はチェックボックスが reviewDoneSet だけを更新していたため、パネルで完了した復習を
//   チェックボックスで外しても、dailyProgress 側の完了記録が残って「完了」に戻ってしまっていた）

// 期限超過で日付移動した復習のキー（`originalKey_moved_YYYY-MM-DD`）から、サフィックスを除いた元のキーを返す。
// computeEffectiveReviewDate は元のキーで reviewDoneSet / dailyProgress を照合する。
function getReviewBaseKey(key){
  return String(key).replace(MOVED_KEY_SUFFIX_RE, '');
}
function isReviewProgressRecord(p){
  return p.type === 'word-review' || p.type === 'book-review';
}


// 復習1件の進捗を記録する（進捗入力パネルの処理）。
// actualEnd が plannedEnd 以上なら完了（reviewDoneSet に追加）、未満なら未完了（reviewDoneSet から削除）。
function recordReviewProgress({ reviewKey, type, dateStr, plannedStart, plannedEnd, actualEnd, bookName }){
  dailyProgress = dailyProgress.filter(
    p => !(p.date === dateStr && p.reviewKey === reviewKey && p.type === type)
  );
  const record = {
    id: genId('dp_'),
    date: dateStr,
    reviewKey,
    type,
    plannedStart,
    plannedEnd,
    actualEnd,
    bookName: bookName || '',
    notProgressed: actualEnd === plannedStart - 1  // 進捗なし（actualEnd === plannedStart - 1）のフラグ
  };
  dailyProgress.push(record);
  const baseKey = getReviewBaseKey(reviewKey);
  if(actualEnd >= plannedEnd){ reviewDoneSet.add(baseKey); }
  else {
    // 「完了」→「途中まで／進んでいない」へ直した場合：以前の完了記録（別の日の分も含む）を取り消す。
    // 取り消さないと、古い完了記録が残って「完了」のままになってしまう。
    clearReviewCompletion(reviewKey);
  }
  return record;
}

// 復習1件の「完了」を取り消す（完了→途中まで／進んでいない に直したときの処理）。
// reviewDoneSet から外すだけでなく、dailyProgress に残っている「完了」記録も取り除く。
// 「途中まで」「進んでいない」の記録は完了ではないので残す（週のまとめの集計に使われるため）。
function clearReviewCompletion(reviewKey){
  const baseKey = getReviewBaseKey(reviewKey);
  reviewDoneSet.delete(baseKey);
  dailyProgress = dailyProgress.filter(p => !(
    isReviewProgressRecord(p) && p.reviewKey && getReviewBaseKey(p.reviewKey) === baseKey &&
    !p.notProgressed && p.actualEnd >= p.plannedEnd
  ));
}


/* ───────── スケジュール表／月目標／今週のまとめ／今日やること／進捗入力 ───────── */
// 単語スケジュールと参考書スケジュールをまとめて1つのカレンダーとして描画する共通関数
// 「単語タブ」の #scheduleArea に描画する（参考書タブは renderRefTodayCard で管理）
function renderMergedSchedule(containerId){
  const area = document.getElementById(containerId);
  if(!area) return;

  const { vocabChunks, refChunks, vocabReviews, refReviews } = buildScheduleData();

  if(entries.length === 0 && refEntries.length === 0){
    area.innerHTML = buildOnboardingHtml();
    return;
  }
  if(vocabChunks.length === 0 && refChunks.length === 0){
    area.innerHTML = `<div class="empty-state">学習曜日が選択されていない範囲があります。設定を確認してください。</div>`;
    return;
  }

  // ── 過去の未達成チャンクは buildScheduleData 内で繰り上げ済み ──

  const today = new Date(); today.setHours(0,0,0,0);
  // 表示は「今日」以降のみ（過去日は非表示）
  let minDate = new Date(today);
  const futureDates = [
    ...vocabChunks.filter(c => parseISO(c.date) >= today).map(c => parseISO(c.date)),
    ...vocabReviews.filter(r => parseISO(r.date) >= today).map(r => parseISO(r.date)),
    ...refChunks.filter(c => parseISO(c.date) >= today).map(c => parseISO(c.date)),
    ...refReviews.filter(r => parseISO(r.date) >= today).map(r => parseISO(r.date)),
    today
  ];
  let maxDate = new Date(Math.max(...futureDates));
  const MAX_DAYS = 45;
  const spanDays = Math.round((maxDate - minDate) / 86400000) + 1;
  let truncated = false;
  if(spanDays > MAX_DAYS){ maxDate = addDays(minDate, MAX_DAYS - 1); truncated = true; }

  // 表示期間（45日）より先にある予定の件数を数えておく（データは消えていないことを利用者に伝えるため）。
  // 日付はISO形式(YYYY-MM-DD)なので文字列比較で大小判定できる。
  let hiddenNoticeHtml = '';
  if(truncated){
    const capIso = formatISO(maxDate);
    const beyond = (arr) => arr.filter(x => x.date > capIso);
    const beyondNew = [...beyond(vocabChunks), ...beyond(refChunks)];
    const beyondReview = [...beyond(vocabReviews), ...beyond(refReviews)].filter(r => !r.done);
    const nextBeyond = [...beyondNew, ...beyondReview].map(x => x.date).sort()[0];
    const nextLabel = nextBeyond ? `（次は ${parseISO(nextBeyond).getMonth()+1}/${parseISO(nextBeyond).getDate()}）` : '';
    hiddenNoticeHtml = buildBeyondNoticeHtml(
      `表示は今日から${MAX_DAYS}日分（〜${maxDate.getMonth()+1}/${maxDate.getDate()}）までです。`,
      beyondNew.length, beyondReview.length, nextLabel,
      '予定は消えていません。日が進むと、その日が近づいた時点で自動的に表示されます。'
    );
  }

  const rows = [];
  let cursor = new Date(minDate);
  while(cursor <= maxDate){
    const iso = formatISO(cursor);
    const newItems = vocabChunks.filter(c => c.date === iso);
    const reviewItems = vocabReviews.filter(r => r.date === iso);
    const refItems = refChunks.filter(c => c.date === iso);
    const refReviewItems = refReviews.filter(r => r.date === iso);
    if(newItems.length || reviewItems.length || refItems.length || refReviewItems.length){ rows.push({ date: new Date(cursor), iso, newItems, reviewItems, refItems, refReviewItems }); }
    cursor = addDays(cursor, 1);
  }

  const todayIso = todayISO();
  const INITIAL_VISIBLE_ROWS = 3;

  function rowHtml(row) {
    const isToday = row.iso === todayIso;
    const wd = WEEKDAYS[row.date.getDay()];
    const dateLabel = `${row.date.getMonth()+1}/${row.date.getDate()}`;
    return `<tr class="${isToday ? 'today' : ''}">
      <td class="date-cell">${dateLabel}<span class="wd">(${wd})</span>${isToday ? '<span class="today-badge">今日</span>' : ''}</td>
      <td>${row.newItems.map(c => {
        // STEP 8: 未完了繰越バッジを統一形式で表示
        const cfBadge = c.carriedForward ? buildCarryBadgeHtml(c.originalDate) : '';
        const cnBadge = c.isCarriedNew   ? buildCarryBadgeHtml(c.originalDate || null) : '';
        return `<span class="tag tag-new">${escapeHtml(c.bookName || '単語')} ${c.rangeStart}〜${c.rangeEnd}${cfBadge}${cnBadge}</span>`;
      }).join('') || '—'}</td>
      <td>${row.reviewItems.map(r => {
        // STEP 8: 復習バッジを統一形式で表示（🔁 復習 Lv.X [N日後] + 🔄 [遅れN日]）
        const reviewBadge = buildReviewBadgeHtml(r.interval, r.delayedDays);
        return `<span class="tag tag-review tag-review-t${getIntervalTier(r.interval)} review-check-label${r.done ? ' is-done' : ''}">${reviewStatusIconHtml(r)}${reviewBadge} ${escapeHtml(r.bookName || '単語')} ${r.rangeStart}〜${r.rangeEnd}</span>`;
      }).join('') || '—'}</td>
      <td>${row.refItems.map(c => {
        // STEP 8: 参考書の未完了繰越バッジを統一形式で表示（carriedForward / isCarriedNew 両対応）
        const cfBadge = c.carriedForward ? buildCarryBadgeHtml(c.originalDate) : '';
        const cnBadge = c.isCarriedNew   ? buildCarryBadgeHtml(c.originalDate || null) : '';
        return `<span class="tag tag-ref">${escapeHtml(c.bookName)} ${c.rangeStart}〜${c.rangeEnd}${cfBadge}${cnBadge}</span>`;
      }).join('') || '—'}</td>
      <td>${row.refReviewItems.map(r => {
        // STEP 8: 参考書復習バッジを統一形式で表示
        const reviewBadge = buildReviewBadgeHtml(r.interval, r.delayedDays);
        return `<span class="tag tag-ref-review tag-review-t${getIntervalTier(r.interval)} review-check-label${r.done ? ' is-done' : ''}">${reviewStatusIconHtml(r)}${reviewBadge} ${escapeHtml(r.bookName)} ${r.rangeStart}〜${r.rangeEnd}</span>`;
      }).join('') || '—'}</td>
    </tr>`;
  }

  const tableHead = `<thead><tr><th>日付</th><th>単語：新規</th><th>単語：復習</th><th>参考書：新規</th><th>参考書：復習</th></tr></thead>`;
  const visibleRows = rows.slice(0, INITIAL_VISIBLE_ROWS);
  const hiddenRows  = rows.slice(INITIAL_VISIBLE_ROWS);
  const detailsWasOpen = document.getElementById(`schedule-details-${containerId}`)?.open;

  let html = reviewLegendHTML();
  html += hiddenNoticeHtml; // 45日を超える予定がある場合のみ、表の上に注意書きを出す
  html += `<table>${tableHead}<tbody>`;
  visibleRows.forEach(row => { html += rowHtml(row); });
  html += `</tbody></table>`;

  if (hiddenRows.length > 0) {
    const openAttr = detailsWasOpen !== false ? ' open' : '';
    html += `<details class="schedule-details" id="schedule-details-${containerId}"${openAttr}>
      <summary>残りのスケジュール（${hiddenRows.length}日）</summary>
      <div class="schedule-details-body schedule-wrap">
        <table>${tableHead}<tbody>`;
    hiddenRows.forEach(row => { html += rowHtml(row); });
    html += `</tbody></table></div></details>`;
  }
  // （旧）下部の「範囲を追加していくと自動で延びます」は誤りだったため削除。上部の注意書きに統合。
  html += `<div class="hint" style="margin-top:8px;">※過去日のスケジュールは非表示です。未達成の新規項目は「今日」に繰り上げられ、それに伴う復習日も自動で再計算されます。4日目以降は「残りのスケジュール」を開いて確認できます。復習の完了は、スケジュールタブの「今日のタスク」で記録します。</div>`;
  area.innerHTML = html;
}

// 「表示期間より先にも予定がある」ことを知らせる注意書きHTMLを返す（単語スケジュール表・統合ビュー共通）。
// 件数が0なら空文字を返す（＝先に予定がなければ何も表示しない）。
function buildBeyondNoticeHtml(headText, newCount, reviewCount, nextLabel, tailText){
  if(newCount + reviewCount === 0) return '';
  const parts = [];
  if(newCount > 0)    parts.push(`新規${newCount}件`);
  if(reviewCount > 0) parts.push(`復習${reviewCount}件`);
  return `<div class="schedule-beyond-notice" style="margin:8px 0;padding:7px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:.78rem;color:#9a3412;font-weight:600;">
    ⚠️ ${headText}これより先にも ${parts.join('・')} の予定があります${nextLabel}。${tailText}
  </div>`;
}

function refreshAllSchedules(){
  renderMergedSchedule('scheduleArea');
  // refScheduleOutput は削除済み（参考書タブは renderRefTodayCard で管理）
}

function renderIntegratedSchedule() {
  const container = document.getElementById('integratedScheduleList');
  if (!container) return;
  const wasFutureOpen = document.getElementById('integratedScheduleFuture')?.open;
  integratedRenderedDate = todayISO(); // 日付が変わったか判定するために、描画した日を覚えておく
  container.innerHTML = '';

  // ── 凡例を先頭に挿入 ──────────────────────────────────────────
  container.insertAdjacentHTML('beforeend', reviewLegendHTML());
  // ─────────────────────────────────────────────────────────────

  // 表示日数の決定 (1週間なら7日、1ヶ月なら30日)
  const checked = document.querySelector('input[name="schedulePeriod"]:checked');
  const periodMode = checked ? checked.value : 'week';
  const targetDays = periodMode === 'week' ? 7 : 30;

  // 単語・参考書の新規チャンクと、復習日（繰り上げ時は自動調整済み）をまとめて取得
  const {
    rawVocabChunks: rawWordChunks,
    rawRefChunks: rawBookChunks,
    vocabChunks: allWordChunks,
    refChunks: allBookChunks,
    vocabReviews: allWordReviews,
    refReviews: allBookReviews
  } = buildScheduleData();

  // ★ 今週のまとめ／完了後の「次のタスク設定」案内を更新（上で計算済みの復習データを再利用）
  const summaryScheduleData = { vocabReviews: allWordReviews, refReviews: allBookReviews };
  renderWeeklySummary(summaryScheduleData);
  renderCompletionPrompts(summaryScheduleData);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const futureDetails = document.createElement('details');
  futureDetails.className = 'schedule-details';
  futureDetails.id = 'integratedScheduleFuture';
  if (wasFutureOpen !== undefined) {
    futureDetails.open = wasFutureOpen;
  } else {
    futureDetails.open = true;
  }

  const futureBody = document.createElement('div');
  futureBody.className = 'schedule-details-body';
  let futureDayCount = 0;

  function buildDayCard(i, currentLoopDate, dateStr) {
    const dayWords = allWordChunks.filter(chunk => chunk.date.startsWith(dateStr)).sort((a, b) => a.rangeStart - b.rangeStart); // 【修正】番号順に並べる
    const dayBooks = allBookChunks.filter(chunk => chunk.date.startsWith(dateStr)).sort((a, b) => a.rangeStart - b.rangeStart);
    const dayWordReviews = allWordReviews.filter(r => r.date.startsWith(dateStr));
    const dayBookReviews = allBookReviews.filter(r => r.date.startsWith(dateStr));

    if (dayWords.length === 0 && dayBooks.length === 0 && dayWordReviews.length === 0 && dayBookReviews.length === 0 && periodMode === 'month') {
      return null;
    }

    const dayOfWeek = WEEKDAYS[currentLoopDate.getDay()];
    const mm = String(currentLoopDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentLoopDate.getDate()).padStart(2, '0');

    const dayCard = document.createElement('div');
    dayCard.style.cssText = "background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); max-width: 100%; overflow: hidden; word-break: break-word;";

    let taskHtml = '';

    // STEP 8: 新規タスク（単語・参考書）を統一ヘルパーで描画。
    // 色・ラベル・繰越バッジの有無は buildDayTaskItemHtml 内の kind 別スタイル定義に集約済み。
    dayWords.forEach(w => { taskHtml += buildDayTaskItemHtml(w, 'word'); });
    dayBooks.forEach(b => { taskHtml += buildDayTaskItemHtml(b, 'book'); });

    // STEP 8: 復習タスク（単語・参考書）を統一ヘルパーで描画。
    // 通常: 🔁 復習 Lv.X [N日後]  /  移動済み: 🔁 復習 Lv.X [N日後] + 🔄 [遅れN日]
    // 色は css-style.css の .tag-review-t{tier} を流用（JS側でのハードコード二重管理を回避）
    dayWordReviews.forEach(r => { taskHtml += buildDayReviewItemHtml(r, 'word'); });
    dayBookReviews.forEach(r => { taskHtml += buildDayReviewItemHtml(r, 'book'); });

    if (taskHtml === '') {
      taskHtml = `<div style="color: #999; font-size: 0.85rem; margin-top: 4px;">予定なし</div>`;
    }

    // 進捗入力UIの対象チャンクを i===0 のときのみ算出（HTML生成・イベント設定の両方で共用）
    const dayWordsForProgress       = i === 0 ? dayWords : null;
    // 繰り越し分も含めた allBookChunks を使うことで、繰り越し参考書も進捗入力対象にする
    const dayBooksForProgress       = i === 0 ? dayBooks : null;
    // 復習タスクも進捗入力対象にする（完了済みも渡し、パネル側で「完了済み」として折りたたんで表示する。
    // チェックボックスを廃止したため、完了の取り消し・修正もパネルから行う）
    const dayWordReviewsForProgress = i === 0 ? dayWordReviews : null;
    const dayBookReviewsForProgress = i === 0 ? dayBookReviews : null;
    const hasAnyTask = i === 0 && (
      dayWordsForProgress.length > 0 || dayBooksForProgress.length > 0 ||
      dayWordReviewsForProgress.length > 0 || dayBookReviewsForProgress.length > 0
    );

    let progressSectionHtml = '';
    if (hasAnyTask) {
      const html = buildProgressInputSection(
        dateStr,
        dayWordsForProgress,
        dayBooksForProgress,
        dateStr,
        dayWordReviewsForProgress,
        dayBookReviewsForProgress
      );
      progressSectionHtml = html || '';
    }

    // 【変更】「過去の未達成スケジュールが繰り越されています」のバナーは廃止（各タスクの「未完了」バッジで足りるため）。
    // 【変更】今日のカードは、進捗入力パネルに全タスク（新規・復習）が載っているため、
    //   上のタスク一覧と下の入力欄に分けず、入力欄つきの1つの一覧にまとめて一度に表示する。
    //   （入力パネルを作れなかった場合のみ、従来どおりタスク一覧を表示する）
    const taskListHtml = progressSectionHtml
      ? ''
      : `<div style="padding-top: 4px;">${taskHtml}</div>`;

    dayCard.innerHTML = `
      <div style="font-weight: bold; font-size: 0.9rem; color: #555; border-bottom: 1px dashed #eee; padding-bottom: 4px;">
        ${mm}/${dd} (${dayOfWeek})${i === 0 ? ' <span style="display:inline-block;font-size:.7rem;background:var(--ink);color:#fff;border-radius:4px;padding:1px 6px;margin-left:4px;">今日</span>' : ''}
      </div>
      ${taskListHtml}
      ${progressSectionHtml}
    `;

    if (hasAnyTask) {
      attachProgressInputHandlers(dayCard, dateStr);
    }

    return dayCard;
  }

  for (let i = 0; i < targetDays; i++) {
    const currentLoopDate = new Date(today);
    currentLoopDate.setDate(today.getDate() + i);
    const yyyy = currentLoopDate.getFullYear();
    const mm = String(currentLoopDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentLoopDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const dayCard = buildDayCard(i, currentLoopDate, dateStr);
    if (!dayCard) continue;

    if (i === 0) {
      container.appendChild(dayCard);
    } else {
      futureBody.appendChild(dayCard);
      futureDayCount++;
    }
  }

  if (futureDayCount > 0) {
    const summary = document.createElement('summary');
    summary.id = 'futureScheduleSummary';
    summary.textContent = `今後のスケジュール（${futureDayCount}日）`;
    futureDetails.appendChild(summary);
    futureDetails.appendChild(futureBody);
    container.appendChild(futureDetails);
  }

  if (entries.length === 0 && refEntries.length === 0) {
    // 【改善】初回（何も登録されていない）：「予定なし」のカードの代わりに、使い方の3ステップと
    //   登録タブへ移動するボタンを出す（凡例も不要なので消す）
    container.innerHTML = buildOnboardingHtml();
  } else if (!container.querySelector('div:not(.review-legend):not(.schedule-beyond-notice)')) {
    container.insertAdjacentHTML('beforeend', '<div style="text-align:center; color:#999; padding:20px;">この期間のスケジュールはありません。設定タブから登録してください。</div>');
  }

}

/* ---------- 月目標カード ---------- */
function loadMonthGoal() {
  return loadFromStorage(MONTH_GOAL_KEY, { text: '' });
}
function saveMonthGoal(text) {
  saveToStorage(MONTH_GOAL_KEY, { text });
}
function renderMonthGoalCard() {
  const displayEl = document.getElementById('monthGoalDisplay');
  const inputEl = document.getElementById('monthGoalInput');
  if (!displayEl) return;
  const goal = loadMonthGoal();
  const text = (goal && goal.text) ? goal.text.trim() : '';
  displayEl.textContent = text ? text : '目標が設定されていません。「編集」から入力してください。';
  if (inputEl) inputEl.value = text;
  // 折りたたんだ見出しにも目標の1行目を出す（閉じていても目標が目に入る）
  const sumEl = document.getElementById('monthGoalSummaryText');
  if (sumEl) {
    const first = text.split('\n')[0];
    sumEl.textContent = text ? '：' + (first.length > 26 ? first.slice(0, 26) + '…' : first) : '（未設定）';
  }
}
function openMonthGoalEditor() {
  const displayEl = document.getElementById('monthGoalDisplay');
  const editArea = document.getElementById('monthGoalEditArea');
  const inputEl = document.getElementById('monthGoalInput');
  if (!editArea) return;
  const goal = loadMonthGoal();
  if (inputEl) inputEl.value = (goal && goal.text) ? goal.text : '';
  if (displayEl) displayEl.style.display = 'none';
  editArea.style.display = 'block';
  if (inputEl) inputEl.focus();
}
function closeMonthGoalEditor() {
  const displayEl = document.getElementById('monthGoalDisplay');
  const editArea = document.getElementById('monthGoalEditArea');
  if (editArea) editArea.style.display = 'none';
  if (displayEl) displayEl.style.display = 'block';
}
function handleMonthGoalSave() {
  const inputEl = document.getElementById('monthGoalInput');
  const text = inputEl ? inputEl.value.trim() : '';
  saveMonthGoal(text);
  renderMonthGoalCard();
  closeMonthGoalEditor();
}

/* =========================================================
   今週のまとめ ／ 完了後の「次のタスク設定」案内
========================================================= */
const COMPLETION_DISMISSED_KEY = 'vocab-completion-dismissed'; // 「閉じる」を押した完了案内のキー一覧

// 集計の対象は「期限日が今週（月曜〜今日）のタスク」。
//  ・新規タスク … 計画上の学習日（スロット）。進捗レコードがあればその最新状態、無ければ未完了。
//  ・復習タスク … 本来の復習予定日（originalDate）。完了チェック／進捗レコードで判定。
// 明日以降に期限が来るタスクは集計に含めない。
// 画面には「件数」は出さず、完了・途中・未完了の「割合（％）」だけを表示する。
//
// ★ 今日が期限で、まだ記録していないタスクの扱い（WEEKLY_COUNT_TODAY_UNRECORDED）
//    false … 「今日の未記録分」は保留とし、集計に含めない（記録した分だけが入る）。
//            ％だけの表示では、朝の時点で「未完了100％」と出てしまうのを防ぐため。
//    true  … 以前の動き。今日の未記録分も「未完了」として数える。
const WEEKLY_COUNT_TODAY_UNRECORDED = false;
const WEEKLY_STATUS_META = [
  { key: 'done',    label: '完了' },
  { key: 'partial', label: '途中' },
  { key: 'none',    label: '未完了' },
];

// 月曜始まりの週の開始日を返す
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return addDays(d, -((d.getDay() + 6) % 7));
}

function formatMonthDay(iso) {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// 進捗レコード1件を 'done'（完了）/ 'partial'（途中）/ 'none'（進んでいない）に分類する
function classifyProgressRecord(p) {
  if (p.notProgressed || p.actualEnd < p.plannedStart) return 'none';
  return p.actualEnd >= p.plannedEnd ? 'done' : 'partial';
}

// 日付の新しい順 → 到達量の大きい順で先頭1件を返す
function pickLatestProgress(records) {
  return records.slice().sort((a, b) =>
    b.date.localeCompare(a.date) || b.actualEnd - a.actualEnd
  )[0];
}

// 新規タスク（word / book）の進捗レコードが属する教材ID
function getProgressOwnerId(p) {
  return p.type === 'word' ? (p.originEntryId || p.entryId) : (p.planId || p.entryId);
}

// 新規タスクの進捗レコードが対応する「本来の学習予定日」。
// 繰り越し分の entryId は `${教材ID}_${元の日付}_${開始位置}` なので、末尾から元の日付を読み取る。
// （前日の未達成分を今日入力しても、元の予定日のタスクとして数えるため）
const CHUNK_KEY_DATE_RE = /_(\d{4}-\d{2}-\d{2})_\d+$/;
function getProgressSlotDate(p) {
  const m = typeof p.entryId === 'string' ? p.entryId.match(CHUNK_KEY_DATE_RE) : null;
  return m ? m[1] : p.date;
}

// 新規タスク（単語 or 参考書）の今週分の状態を集計する
function collectNewTaskStatuses(materials, type, computeBase, range) {
  const statuses = [];
  let upcoming = 0;      // 明日以降に期限が来るもの
  let pendingToday = 0;  // 今日が期限で、まだ記録していないもの（保留）

  materials.forEach(m => {
    const owned = dailyProgress.filter(p => p.type === type && getProgressOwnerId(p) === m.id);
    // 全範囲を終えた日（それ以降の学習予定日は不要になるので、未完了として数えない）
    const completedOn = owned
      .filter(p => !p.notProgressed && p.actualEnd >= m.endNum)
      .map(p => p.date).sort()[0] || null;

    // (1) 期限日が今週の学習予定日のうち、記録があるもの：同じ予定日の記録は最新1件で判定
    const bySlot = new Map();
    owned.forEach(p => {
      const slot = getProgressSlotDate(p);
      if (slot < range.startIso || slot > range.todayIso) return;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(p);
    });
    bySlot.forEach(list => statuses.push(classifyProgressRecord(pickLatestProgress(list))));

    // (2) 記録が無い学習予定日：昨日まで→未完了、今日→保留（設定で未完了にも切替可）、明日以降→「今後の予定」
    const recordedSlots = new Set(owned.map(getProgressSlotDate));
    computeBase(m).forEach(c => {
      if (c.date < range.startIso || c.date > range.endIso) return;
      if (completedOn && c.date > completedOn) return;
      if (recordedSlots.has(c.date)) return;
      if (c.date < range.todayIso) statuses.push('none');
      else if (c.date === range.todayIso) {
        if (WEEKLY_COUNT_TODAY_UNRECORDED) statuses.push('none'); else pendingToday++;
      } else upcoming++;
    });
  });
  return { statuses, upcoming, pendingToday };
}

// 復習タスク1件の状態（完了チェック済み／途中まで進捗入力済み／記録なし／進んでいない）
//  'done' / 'partial' / 'none'（記録済みだが進んでいない） / 'unrecorded'（まだ何も記録していない）
function classifyReviewStatus(r) {
  if (r.done) return 'done';
  const baseKey = r.key.replace(MOVED_KEY_SUFFIX_RE, '');
  const recs = dailyProgress.filter(p =>
    (p.type === 'word-review' || p.type === 'book-review') && p.reviewKey &&
    p.reviewKey.replace(MOVED_KEY_SUFFIX_RE, '') === baseKey
  );
  if (!recs.length) return 'unrecorded';
  return classifyProgressRecord(pickLatestProgress(recs)) === 'partial' ? 'partial' : 'none';
}

function collectReviewStatuses(reviews, range) {
  const statuses = [];
  let upcoming = 0;      // 明日以降に期限が来るもの
  let pendingToday = 0;  // 今日が期限で、まだ記録していないもの（保留）
  reviews.forEach(r => {
    if (r.originalDate < range.startIso || r.originalDate > range.endIso) return;
    if (r.originalDate > range.todayIso) { if (!r.done) upcoming++; return; }
    const st = classifyReviewStatus(r);
    if (st !== 'unrecorded') { statuses.push(st); return; }
    // 記録なし：昨日までに期限が来ていれば未完了。今日が期限なら保留（設定で未完了にも切替可）
    if (r.originalDate === range.todayIso && !WEEKLY_COUNT_TODAY_UNRECORDED) pendingToday++;
    else statuses.push('none');
  });
  return { statuses, upcoming, pendingToday };
}

function tallyStatuses(statuses) {
  const c = { done: 0, partial: 0, none: 0 };
  statuses.forEach(s => { c[s]++; });
  c.total = c.done + c.partial + c.none;
  return c;
}

// 合計が必ず100%になるよう、最大剰余法で割合（整数%）を求める
function toPercents(counts) {
  const out = { done: 0, partial: 0, none: 0 };
  if (!counts.total) return out;
  const keys = ['done', 'partial', 'none'];
  const raw = keys.map(k => counts[k] * 100 / counts.total);
  const floors = raw.map(Math.floor);
  let rest = 100 - floors.reduce((a, b) => a + b, 0);
  raw.map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(o => { if (rest > 0) { floors[o.i]++; rest--; } });
  keys.forEach((k, i) => { out[k] = floors[i]; });
  return out;
}

function computeWeeklySummary(scheduleData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = getWeekStart(today);
  const range = {
    startIso: formatISO(weekStart),
    endIso: formatISO(addDays(weekStart, 6)),
    todayIso: formatISO(today),
  };
  const wordNew = collectNewTaskStatuses(entries, 'word', computeChunksForEntry, range);
  const bookNew = collectNewTaskStatuses(refEntries, 'book', computeRefSchedule, range);
  const wordRev = collectReviewStatuses(scheduleData.vocabReviews, range);
  const bookRev = collectReviewStatuses(scheduleData.refReviews, range);
  const newStatuses = [...wordNew.statuses, ...bookNew.statuses];
  const reviewStatuses = [...wordRev.statuses, ...bookRev.statuses];
  return {
    range,
    total: tallyStatuses([...newStatuses, ...reviewStatuses]),
    newTasks: tallyStatuses(newStatuses),
    reviews: tallyStatuses(reviewStatuses),
    upcoming: wordNew.upcoming + bookNew.upcoming + wordRev.upcoming + bookRev.upcoming,
    pendingToday: wordNew.pendingToday + bookNew.pendingToday + wordRev.pendingToday + bookRev.pendingToday,
    hasMaterials: entries.length + refEntries.length > 0,
  };
}

// 新規／復習ごとの内訳（％のみ。件数は表示しない）
function buildWeeklyBreakdownText(label, c) {
  if (!c.total) return `${label}：―`;
  const p = toPercents(c);
  return `${label}：完了${p.done}%・途中${p.partial}%・未完了${p.none}%`;
}

function renderWeeklySummary(scheduleData) {
  const el = document.getElementById('weeklySummaryCard');
  if (!el) return;
  const s = computeWeeklySummary(scheduleData || buildScheduleData());
  const rangeLabel = `${formatMonthDay(s.range.startIso)}〜${formatMonthDay(s.range.endIso)}`;

  let bodyHtml;
  if (!s.hasMaterials) {
    bodyHtml = `<div class="ws-empty">スケジュールを登録すると、今週の達成状況がここに表示されます。</div>`;
  } else if (s.total.total === 0) {
    bodyHtml = s.pendingToday > 0
      ? `<div class="ws-empty">まだ集計できるタスクがありません。今日の分を記録すると、ここに反映されます。</div>`
      : `<div class="ws-empty">今週は、集計できるタスクがまだありません。</div>`;
  } else {
    const pct = toPercents(s.total);
    const barLabel = WEEKLY_STATUS_META.map(m => `${m.label}${pct[m.key]}%`).join('、');
    const segs = WEEKLY_STATUS_META
      .filter(m => s.total[m.key] > 0)
      .map(m => `<span class="ws-seg ws-seg-${m.key}" style="width:${pct[m.key]}%"></span>`)
      .join('');
    const tiles = WEEKLY_STATUS_META.map(m => `
      <div class="ws-stat ws-stat-${m.key}">
        <div class="ws-stat-label"><span class="ws-dot ws-dot-${m.key}"></span>${m.label}</div>
        <div class="ws-stat-num">${pct[m.key]}<span class="ws-stat-unit">%</span></div>
      </div>`).join('');
    const pendingNote = (!WEEKLY_COUNT_TODAY_UNRECORDED && s.pendingToday > 0)
      ? '今日の未記録分は、記録するまで集計に含めていません。' : '';
    const upcomingNote = s.upcoming > 0 ? '明日以降の予定は含まれていません。' : '';
    bodyHtml = `
      <div class="ws-total">今日までに期限が来たタスクの達成状況（新規＋復習）</div>
      <div class="ws-bar" role="img" aria-label="${barLabel}">${segs}</div>
      <div class="ws-stats">${tiles}</div>
      <div class="ws-breakdown">${buildWeeklyBreakdownText('新規', s.newTasks)}　／　${buildWeeklyBreakdownText('復習', s.reviews)}</div>
      <div class="ws-note">※ 期限日が今週（月曜〜今日）のタスクを集計しています。${pendingNote}${upcomingNote}</div>`;
  }

  el.innerHTML = `
    <div class="ws-header">
      <div class="ws-title">📊 今週のまとめ</div>
      <div class="ws-range">${rangeLabel}</div>
    </div>
    <div class="ws-display">${bodyHtml}</div>`;
}

/* ---------- 完了後の「次のタスク設定」案内 ---------- */

// 教材1件の一連の学習（全範囲の新規学習 ＋ すべての復習）が完了しているか
function isSeriesFullyCompleted(material, type, reviews) {
  const reachedEnd = dailyProgress.some(p =>
    p.type === type && getProgressOwnerId(p) === material.id &&
    !p.notProgressed && p.actualEnd >= material.endNum
  );
  if (!reachedEnd) return false;
  const ownerOf = r => (type === 'word' ? r.entryId : r.planId);
  return reviews.filter(r => ownerOf(r) === material.id).every(r => r.done);
}

// 案内を出すべき教材の一覧を返す。
// 各種別（単語／参考書）で「最後に登録した教材」が完了していて、次の教材がまだ登録されていない場合のみ対象。
// （次の範囲を登録した時点で案内は自然に消える）
function getCompletionPrompts(scheduleData) {
  const dismissed = new Set(loadFromStorage(COMPLETION_DISMISSED_KEY, []));
  const defs = [
    { type: 'word', materials: entries,    reviews: scheduleData.vocabReviews, defaultName: '単語', kindLabel: '単語範囲',   unit: '' },
    { type: 'book', materials: refEntries, reviews: scheduleData.refReviews,   defaultName: '参考書', kindLabel: '参考書範囲', unit: 'p.' },
  ];
  const allDone = (entries.length + refEntries.length) > 0 &&
    defs.every(d => d.materials.every(m => isSeriesFullyCompleted(m, d.type, d.reviews)));

  const prompts = [];
  defs.forEach(d => {
    const last = d.materials[d.materials.length - 1];
    if (!last || !isSeriesFullyCompleted(last, d.type, d.reviews)) return;
    const dismissKey = `${d.type}:${last.id}:${last.endNum}`;
    if (dismissed.has(dismissKey)) return;
    prompts.push({
      type: d.type,
      kindLabel: d.kindLabel,
      dismissKey,
      allDone,
      name: `${last.bookName || d.defaultName} ${d.unit}${last.startNum}〜${d.unit}${last.endNum}`,
    });
  });
  return prompts;
}

function renderCompletionPrompts(scheduleData) {
  const area = document.getElementById('completionPromptArea');
  if (!area) return;
  const prompts = getCompletionPrompts(scheduleData || buildScheduleData());

  area.innerHTML = prompts.map(p => `
    <div class="completion-prompt" role="status">
      <div class="cp-icon" aria-hidden="true">🎉</div>
      <div class="cp-body">
        <div class="cp-title">「${escapeHtml(p.name)}」を、復習まですべて完了しました！</div>
        <div class="cp-text">${p.allDone
          ? '登録中のスケジュールはすべて完了です。次の範囲を設定して、学習のリズムを止めずに進めましょう。'
          : '新規の範囲も復習スケジュールもクリアしました。次の範囲を設定して、学習を続けましょう。'}</div>
        <div class="cp-actions">
          <button type="button" class="btn-primary cp-go-btn" data-type="${p.type}">次の${p.kindLabel}を設定する</button>
          <button type="button" class="btn-ghost cp-dismiss-btn" data-dismiss-key="${escapeHtml(p.dismissKey)}">閉じる</button>
        </div>
      </div>
    </div>`).join('');

  area.querySelectorAll('.cp-go-btn').forEach(btn => {
    btn.addEventListener('click', () => goToNextTaskSetup(btn.dataset.type));
  });
  area.querySelectorAll('.cp-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dismissed = loadFromStorage(COMPLETION_DISMISSED_KEY, []);
      if (!dismissed.includes(btn.dataset.dismissKey)) dismissed.push(btn.dataset.dismissKey);
      saveToStorage(COMPLETION_DISMISSED_KEY, dismissed);
      renderCompletionPrompts();
    });
  });
}

// 「次の範囲を設定する」：該当の設定タブを開き、登録フォームを表示する
function goToNextTaskSetup(type) {
  const isWord = type === 'word';
  showTab(isWord ? 'study' : 'reference');
  (isWord ? ['setup', 'rangeRegisterDetails'] : ['refSetup', 'refSettingDetails']).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.open = true;
  });
  document.getElementById(isWord ? 'rangeRegisterDetails' : 'refSettingDetails')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 進捗入力 UI ---------- */

/**
 * 進捗入力コントロール（ボタン＋ステッパー方式）のHTMLを返すヘルパー
 * @param {number} rangeStart  - 計画開始番号/ページ
 * @param {number} rangeEnd    - 計画終了番号/ページ
 * @param {string|number} recordedVal - 既存の記録値（空文字 = 未記録）
 * @param {string} type        - 'word' | 'book' | 'word-review' | 'book-review'
 * @param {string} statusHtml  - 既存記録バッジのHTML
 * @param {string} inputAttrs  - hidden input に付与する data-* 属性の文字列
 */
function buildProgControlHtml(rangeStart, rangeEnd, recordedVal, type, statusHtml, inputAttrs) {
  const isWordType  = (type === 'word' || type === 'word-review');
  const unitWord    = isWordType ? '個' : 'ページ';
  const unitLabel   = isWordType ? '番まで' : 'ページまで';
  const plannedCount = rangeEnd - rangeStart + 1;

  const rv       = recordedVal !== '' ? parseInt(recordedVal, 10) : null;
  const isDone   = rv !== null && rv >= rangeEnd;
  const isNotProgressed = rv !== null && rv === rangeStart - 1;              // ★「進んでいない」状態
  const isPartial = rv !== null && rv > (rangeStart - 1) && rv < rangeEnd;  // ★ 境界値を > に変更（isNotProgressedと排他）
  const completedCount = rv !== null ? Math.max(0, rv - rangeStart + 1) : 0;
  const pct      = plannedCount > 0 ? Math.min(100, Math.round(completedCount / plannedCount * 100)) : 0;
  const displayVal = rv !== null ? rv : rangeEnd;

  const step1LabelClass = isDone ? ' step-done'
    : isPartial       ? ' step-partial'
    : isNotProgressed ? ' step-not-progressed'
    : '';
  const isReviewType = (type === 'word-review' || type === 'book-review');
  const extraPages   = rv !== null && rv > rangeEnd ? rv - rangeEnd : 0;
  const extraUnit    = isWordType ? '個追加' : 'ページ追加';

  return `
    <div class="prog-control-ui"
         data-range-start="${rangeStart}"
         data-range-end="${rangeEnd}"
         data-type="${type}">
      <input type="number" class="progress-num-input" style="display:none"
             min="${rangeStart - 1}" max="${rangeEnd + 50}"
             value="${recordedVal}" ${inputAttrs}>
      <div class="prog-step1-label${step1LabelClass}">完了しましたか？</div>
      <div class="prog-toggle">
        <button type="button" class="prog-btn prog-btn-done${isDone ? ' prog-btn-active' : ''}">
          ✅ 完了
        </button>
        <button type="button" class="prog-btn prog-btn-partial${isPartial ? ' prog-btn-active' : ''}">
          ⚠️ 途中まで
        </button>
        <button type="button" class="prog-btn prog-btn-not-progressed${isNotProgressed ? ' prog-btn-active' : ''}">
          🚫 進んでいない
        </button>
      </div>
      ${statusHtml ? `<div class="prog-status-wrap">${statusHtml}</div>` : ''}
      <div class="prog-partial-panel"${isPartial ? '' : ' style="display:none"'}>
        <div class="prog-partial-heading">どこまで進みましたか？</div>
        <div class="prog-count-row">
          <span class="prog-count-val">${completedCount}</span>
          <span class="prog-count-total">/ ${plannedCount}${unitWord}完了</span>
          <div class="prog-bar-wrap"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="prog-stepper">
          <input type="number" class="prog-display-input"
                 value="${displayVal}"
                 min="${rangeStart - 1}" max="${rangeEnd + 50}"
                 inputmode="numeric" pattern="[0-9]*"
                 aria-label="${unitLabel}入力">
          <span class="prog-unit">${unitLabel}</span>
        </div>
      </div>
      ${!isReviewType ? `
      <button type="button" class="prog-extra-open-link"${isDone && extraPages === 0 ? '' : ' style="display:none"'}>＋ 予定より多く進んだ</button>
      <div class="prog-extra-panel"${isDone && extraPages > 0 ? '' : ' style="display:none"'}>
        <div class="prog-extra-heading">さらに余剰${isWordType ? '個数' : 'ページ'}はありましたか？</div>
        <div class="prog-extra-options">
          <button type="button" class="prog-extra-no-btn">追加なし</button>
          <div class="prog-extra-input-row">
            <button type="button" class="prog-extra-step" data-delta="-1">−1</button>
            <input type="number" class="prog-extra-input"
                   value="${extraPages}" min="0" max="999" inputmode="numeric">
            <button type="button" class="prog-extra-step" data-delta="+1">+1</button>
            <span class="prog-extra-unit">${extraUnit}</span>
            <button type="button" class="prog-extra-confirm-btn">✅ 記録</button>
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

/**
 * 復習セクション（単語・参考書共通）のHTMLを返す
 * @param {Array}  pendingReviews  - 未完了の復習タスク配列
 * @param {string} type            - 'word-review' | 'book-review'
 * @param {string} unit            - 単位文字列（'個' | 'ページ'）
 * @param {string} dividerLabel    - セクション見出し文字列
 * @param {string} dateStr         - 対象日付 (YYYY-MM-DD)
 * @param {Array}  existingRecords - 当日の既存進捗レコード
 * @returns {string} HTML文字列（タスクがなければ空文字）
 */
function buildReviewProgressItems(reviews, type, unit, dividerLabel, dateStr, existingRecords) {
  if (!reviews.length) return '';
  const pending = reviews.filter(r => !r.done);
  const done    = reviews.filter(r => r.done);

  const itemHtml = (r) => {
    const tier = getIntervalTier(r.interval);
    // 遅れて完了した復習は、記録のキー（_moved_日付つき）と表示キーが違うので、サフィックスを除いて照合する
    const rec  = existingRecords.find(p => p.type === type && p.reviewKey && getReviewBaseKey(p.reviewKey) === getReviewBaseKey(r.key));
    // 完了済みの復習は、別の日に記録されていても「完了」を初期表示にする
    const rv   = rec ? rec.actualEnd : (r.done ? r.rangeEnd : '');
    const pc   = r.rangeEnd - r.rangeStart + 1;
    const isDoneNow = rv !== '' && rv >= r.rangeEnd;
    const statusHtml = rv !== ''
      ? `<span class="progress-status-badge ${isDoneNow ? 'ps-on-track' : 'ps-behind'}">
           ${isDoneNow ? '✅ 完了' : `⚠️ ${rv - r.rangeStart + 1}/${pc}${unit}`}
         </span>` : '';
    const badge = buildReviewBadgeHtml(r.interval, r.delayedDays);
    const bookName = type === 'word-review' ? (r.bookName || '単語') : r.bookName;
    const nameLabel = `${escapeHtml(bookName)} ${r.rangeStart}〜${r.rangeEnd}（${pc}${type === 'word-review' ? '個' : 'ページ'}）`;
    // data-initial-val：記録済みの値。保存時に「変更のない項目」を再保存しないための目印
    const dataAttrs = `data-review-key="${r.key}" data-type="${type}" data-planned-start="${r.rangeStart}" data-planned-end="${r.rangeEnd}" data-date="${dateStr}" data-book-name="${escapeHtml(bookName)}"${rv !== '' ? ` data-initial-val="${rv}"` : ''}`;
    return `<div class="progress-item review-item t${tier}">
      <span class="progress-plan-label">${badge} ${nameLabel}</span>
      ${buildProgControlHtml(r.rangeStart, r.rangeEnd, rv, type, statusHtml, dataAttrs)}
    </div>`;
  };

  let html = '';
  if (pending.length) {
    html += `<div class="progress-review-divider">${dividerLabel}</div>` + pending.map(itemHtml).join('');
  }
  if (done.length) {
    const kind = type === 'word-review' ? '単語' : '参考書';
    html += `<details class="progress-done-details">
      <summary>✅ ${kind}の完了済み復習（${done.length}件）／修正はここから</summary>
      ${done.map(itemHtml).join('')}
    </details>`;
  }
  return html;
}

/**
 * 新規チャンク（単語・参考書共通）1件分の進捗入力アイテムHTMLを返す。
 * 「新規：単語チャンク」「新規：参考書チャンク」の2つのforEachが、
 * entryId/planId・単位（個/ページ）・bookName初期値以外ほぼ同一だったため共通化。
 * @param {Object} chunk - 対象チャンク（単語チャンク or 参考書チャンク）
 * @param {Object} cfg
 * @param {'word'|'book'} cfg.type       - 進捗記録の種別
 * @param {string} cfg.unit              - 単位文字列（'個' | 'ページ'）
 * @param {string} cfg.ownerAttrName     - data属性名（'origin-entry-id' | 'plan-id'）
 * @param {function} cfg.getOwnerId      - chunk → ownerID（entryId or planId）
 * @param {function} cfg.getBookName     - chunk → 表示用の教材名（初期値の扱いが単語/参考書で異なる）
 * @param {boolean} cfg.showCarryBadge   - 「未完了」バッジを表示するか（単語・参考書とも true）
 * @param {Array}  existingRecords       - 当日の既存進捗レコード
 * @param {string} dateStr               - 対象日付 (YYYY-MM-DD)
 */
function buildNewChunkProgressItemHtml(chunk, cfg, existingRecords, dateStr) {
  const ownerId = cfg.getOwnerId(chunk);
  // ★ composite key：ownerId + チャンク本来の日付 + 開始位置（同一教材の複数チャンク衝突防止）
  // 繰り越し分は originalDate、通常分は dateStr（= chunk.date）を使う
  const chunkBaseDate = chunk.carriedForward ? (chunk.originalDate || chunk.date) : chunk.date;
  // ★修正：実績チャンク（保存済み記録から再生成）は、保存時の複合キーをそのまま使う
  //   （繰越分は保存後に今日付けで再生成されるため、キーを組み直すと記録が見つからず二重になる）
  const chunkEntryId  = chunk.progressEntryId || `${ownerId}_${chunkBaseDate}_${chunk.rangeStart}`;
  // ★修正：実績チャンクの rangeEnd は actualEnd なので、予定終了は plannedEnd を使う
  //   （これで途中完了が「完了」扱いにならず、再保存でも予定終了が縮まない）
  const planEnd       = chunk.isFromProgress ? (chunk.plannedEnd ?? chunk.rangeEnd) : chunk.rangeEnd;

  const rec = existingRecords.find(p => p.entryId === chunkEntryId && p.type === cfg.type);
  const recordedVal  = rec ? rec.actualEnd : '';
  const plannedCount = planEnd - chunk.rangeStart + 1;
  const bookName = cfg.getBookName(chunk);

  // STEP 8: 未完了繰越バッジを統一形式で表示（carriedForward / isCarriedNew 両対応）
  const cfNote = cfg.showCarryBadge
    ? (chunk.carriedForward ? buildCarryBadgeHtml(chunk.originalDate) : (chunk.isCarriedNew ? buildCarryBadgeHtml(chunk.originalDate || null) : ''))
    : '';

  const statusHtml = rec
    ? `<span class="progress-status-badge ${rec.actualEnd >= planEnd ? 'ps-on-track' : 'ps-behind'}">
         ${rec.actualEnd >= planEnd ? '✅ 完了' : `⚠️ ${rec.actualEnd - chunk.rangeStart + 1}/${plannedCount}${cfg.unit}完了`}
       </span>`
    : '';

  // ★実施日（やった日）：本来の予定日と、初期値を決める
  //   ・記録済み → その記録の実施日（なければ入力日）
  //   ・前日以前の予定が繰り越されてきた分 → 予定日（「やったのに入力を忘れた」を救うため）
  //     ただし「途中まで」の残りの繰越は、予定日にやったとは限らないので今日にする
  //   ・それ以外 → 今日
  const slotMatch = typeof chunkEntryId === 'string' ? chunkEntryId.match(CHUNK_KEY_DATE_RE) : null;
  const plannedDate = (!chunk.fromPartial && slotMatch) ? slotMatch[1] : dateStr;
  //   ・予定日に「進んでいない」と記録した分は、やっていないことが分かっているので今日にする
  const wasRecordedNone = dailyProgress.some(p => p.type === cfg.type && p.notProgressed && p.entryId === chunkEntryId);
  const isCarriedOld = !rec && !!chunk.carriedForward && !chunk.isFromProgress && !chunk.fromPartial && !wasRecordedNone && plannedDate < dateStr;
  const defaultDoneDate = rec ? (rec.doneDate || rec.date) : (isCarriedOld ? plannedDate : dateStr);

  const dataAttrs = `data-entry-id="${chunkEntryId}" data-${cfg.ownerAttrName}="${ownerId}" data-type="${cfg.type}" data-planned-start="${chunk.rangeStart}" data-planned-end="${planEnd}" data-date="${dateStr}" data-book-name="${escapeHtml(bookName)}"${rec ? ` data-initial-val="${rec.actualEnd}" data-initial-done-date="${defaultDoneDate}"` : ''}`;

  return `
      <div class="progress-item">
        <span class="progress-plan-label">${escapeHtml(bookName)} ${chunk.rangeStart}〜${planEnd}（予定 ${plannedCount}${cfg.unit}）${cfNote}</span>
        ${buildProgControlHtml(chunk.rangeStart, planEnd, recordedVal, cfg.type, statusHtml, dataAttrs)}
        ${buildDoneDateRowHtml(defaultDoneDate, plannedDate, dateStr)}
      </div>`;
}

/**
 * 今日の単語・参考書チャンクに対する進捗入力セクションのHTMLを返す
 * @param {string} dateStr          - 対象日付 (YYYY-MM-DD)
 * @param {Array}  dayWords         - 当日の単語チャンク（新規）
 * @param {Array}  dayBooks         - 当日の参考書チャンク（新規・繰り越し含む）
 * @param {string} [baseId]         - IDプレフィックス（省略時は dateStr）
 * @param {Array}  [dayWordReviews] - 当日の単語復習タスク
 * @param {Array}  [dayBookReviews] - 当日の参考書復習タスク
 */
function buildProgressInputSection(dateStr, dayWords, dayBooks, baseId, dayWordReviews, dayBookReviews) {
  baseId = baseId || dateStr;
  dayWordReviews = dayWordReviews || [];
  dayBookReviews = dayBookReviews || [];
  const existingRecords = dailyProgress.filter(p => p.date === dateStr);
  const hasAnyRecord = existingRecords.length > 0;

  let itemsHtml = '';

  // ── 新規：単語チャンク ──────────────────────────────────────
  dayWords.forEach(w => {
    itemsHtml += buildNewChunkProgressItemHtml(w, {
      type: 'word',
      unit: '個',
      ownerAttrName: 'origin-entry-id',
      getOwnerId: c => c.entryId,
      getBookName: c => c.bookName || '単語',
      showCarryBadge: true
    }, existingRecords, dateStr);
  });

  // ── 新規：参考書チャンク ─────────────────────────────────────
  dayBooks.forEach(b => {
    itemsHtml += buildNewChunkProgressItemHtml(b, {
      type: 'book',
      unit: 'ページ',
      ownerAttrName: 'plan-id',
      getOwnerId: c => c.planId,
      getBookName: c => c.bookName,
      showCarryBadge: true
    }, existingRecords, dateStr);
  });

  // ── 復習：単語・参考書（共通ヘルパーで処理） ────────────────
  itemsHtml += buildReviewProgressItems(dayWordReviews, 'word-review', '個',   '🔁 復習タスク（単語）',   dateStr, existingRecords);
  itemsHtml += buildReviewProgressItems(dayBookReviews, 'book-review', 'ページ', '📚 復習タスク（参考書）', dateStr, existingRecords);

  // 新規・復習ともにタスクがなければ null を返す
  if (!itemsHtml) return null;

  const savedLabel = hasAnyRecord
    ? `<span class="progress-recorded-badge">✓ 記録済み</span>`
    : '';

  return `
    <div class="progress-section" id="progress-section-${baseId}">
      <div class="progress-section-title">
        📝 今日のタスク（完了したら進捗を入力）
        ${savedLabel}
      </div>
      ${itemsHtml}
      <div class="ahead-banner" id="ahead-banner-${baseId}" style="display:none;">
        <span class="ahead-text" id="ahead-text-${baseId}"></span>
        <button class="btn-primary" style="font-size:.8rem; padding:7px 12px;"
                onclick="handleProgressSave('${dateStr}', '${baseId}')">
          スケジュールを再調整する
        </button>
      </div>
      <div class="behind-note" id="behind-note-${baseId}" style="display:none;"></div>
      <div class="not-progressed-note" id="not-progressed-note-${baseId}" style="display:none;"></div>
      <div class="progress-save-row">
        <button class="btn-primary" style="font-size:.85rem;"
                onclick="handleProgressSave('${dateStr}', '${baseId}')">
          📌 進捗を記録してスケジュールを調整
        </button>
        <button class="btn-ghost" style="font-size:.8rem;"
                onclick="markAllProgressDone('${baseId}')">
          ✅ 未入力をすべて完了に
        </button>
        ${hasAnyRecord ? `<button class="btn-ghost" style="font-size:.8rem;"
                onclick="handleProgressClear('${dateStr}')">記録をリセット</button>` : ''}
      </div>
    </div>`;
}

/**
 * 【追加】まだ何も選んでいない項目だけを、まとめて「完了」にする（モバイルでのタップ数削減用）。
 * すでに「完了／途中まで／進んでいない」を選んだ項目・記録済みの項目は変更しない。
 * 「完了」にするだけで、保存は「📌 進捗を記録…」ボタンで行う。
 */
function markAllProgressDone(baseId) {
  const section = document.getElementById(`progress-section-${baseId}`);
  if (!section) return;
  section.querySelectorAll('.prog-control-ui').forEach(ui => {
    const hidden = ui.querySelector('.progress-num-input');
    const doneBtn = ui.querySelector('.prog-btn-done');
    if (hidden && doneBtn && hidden.value === '') doneBtn.click();
  });
}

/**
 * 進捗入力コントロール（ボタン＋ステッパー）のインタラクションをセットアップ
 */
function initProgressControls(container, dateStr, baseId) {
  baseId = baseId || dateStr;

  container.querySelectorAll('.prog-control-ui').forEach(ui => {
    const hiddenInput    = ui.querySelector('.progress-num-input');
    if (!hiddenInput) return;

    const btnDone           = ui.querySelector('.prog-btn-done');
    const btnPartial        = ui.querySelector('.prog-btn-partial');
    const btnNotProgressed  = ui.querySelector('.prog-btn-not-progressed'); // ★追加
    const partialPanel      = ui.querySelector('.prog-partial-panel');
    const progDisplay    = ui.querySelector('.prog-display');
    const progDisplayInput = ui.querySelector('.prog-display-input');
    const barFill        = ui.querySelector('.prog-bar-fill');
    const countValEl     = ui.querySelector('.prog-count-val');
    const step1Label     = ui.querySelector('.prog-step1-label');
    const extraPanel     = ui.querySelector('.prog-extra-panel');
    const extraLink      = ui.querySelector('.prog-extra-open-link'); // 余剰パネルを開く小さなリンク

    const rangeStart   = parseInt(hiddenInput.dataset.plannedStart, 10);
    const rangeEnd     = parseInt(hiddenInput.dataset.plannedEnd,   10);
    const plannedCount = rangeEnd - rangeStart + 1;

    /* ── 表示を更新し、hidden input を更新してプレビューを起動 ── */
    function updateDisplay(val) {
      const clampedVal     = Math.max(rangeStart - 1, Math.min(rangeEnd + 50, val));
      const completedCount = Math.max(0, clampedVal - rangeStart + 1);
      const pct            = plannedCount > 0 ? Math.min(100, Math.round(completedCount / plannedCount * 100)) : 0;

      if (progDisplay)      progDisplay.textContent = clampedVal;
      if (progDisplayInput) progDisplayInput.value  = clampedVal;
      if (barFill)          barFill.style.width      = pct + '%';
      if (countValEl)       countValEl.textContent   = completedCount;

      hiddenInput.value = clampedVal;
      hiddenInput.dispatchEvent(new Event('input'));
    }

    /* ── ①ラベルの色をステップ状態に合わせて更新 ── */
    function updateStep1Label(mode) {
      if (!step1Label) return;
      step1Label.classList.toggle('step-done',          mode === 'done');
      step1Label.classList.toggle('step-partial',       mode === 'partial');
      step1Label.classList.toggle('step-not-progressed', mode === 'not-progressed'); // ★追加
    }

    /* ── ボタンのアクティブ状態を切り替える ── */
    function setActiveState(mode) {
      if (btnDone)           btnDone.classList.toggle('prog-btn-active',           mode === 'done');
      if (btnPartial)        btnPartial.classList.toggle('prog-btn-active',        mode === 'partial');
      if (btnNotProgressed)  btnNotProgressed.classList.toggle('prog-btn-active',  mode === 'not-progressed'); // ★追加
      // 直接入力中（フォーカス中）は、値に応じて状態が変わってもパネルを閉じない（入力が途切れるのを防ぐ）
      const typing = progDisplayInput && document.activeElement === progDisplayInput;
      if (partialPanel)      partialPanel.style.display = (mode === 'partial' || typing) ? 'block' : 'none';
      // 「途中まで」「進んでいない」どちらに切り替えても余剰パネルは閉じる
      if (extraPanel && mode !== 'done') extraPanel.style.display = 'none';
      if (extraLink  && mode !== 'done') extraLink.style.display  = 'none';
      updateStep1Label(mode);
    }

    /* ── 「✅ 完了」 ── */
    if (btnDone) {
      btnDone.addEventListener('click', () => {
        updateDisplay(rangeEnd);
        setActiveState('done');
        // 【変更】余剰パネルは自動で開かず、入力値だけ 0 にリセットして小さなリンクを出す
        //   （「完了」は最も多い操作のため、毎回パネルが開くと手数が増える）
        if (extraPanel) {
          const extraInput = extraPanel.querySelector('.prog-extra-input');
          if (extraInput) extraInput.value = '0';
          extraPanel.style.display = 'none';
        }
        if (extraLink) extraLink.style.display = 'inline-block';
      });
    }

    /* ── 「＋ 予定より多く進んだ」リンク：余剰パネルを開く ── */
    if (extraLink && extraPanel) {
      extraLink.addEventListener('click', () => {
        extraPanel.style.display = 'block';
        extraLink.style.display = 'none';
      });
    }

    /* ── 余剰ページパネル ── */
    if (extraPanel) {
      // 「追加なし」→ パネルを閉じ、rangeEnd のまま確定
      const extraNoBtn = extraPanel.querySelector('.prog-extra-no-btn');
      if (extraNoBtn) {
        extraNoBtn.addEventListener('click', () => {
          extraPanel.style.display = 'none';
          if (extraLink) extraLink.style.display = 'inline-block';
          // hiddenInput は既に rangeEnd なのでそのまま、プレビューだけ更新
          hiddenInput.dispatchEvent(new Event('input'));
        });
      }

      // ±ステッパー（余剰パネル専用。既存の .prog-step とクラス名が異なるため競合なし）
      extraPanel.querySelectorAll('.prog-extra-step').forEach(btn => {
        btn.addEventListener('click', () => {
          const extraInput = extraPanel.querySelector('.prog-extra-input');
          if (!extraInput) return;
          const delta   = parseInt(btn.dataset.delta, 10);
          const current = parseInt(extraInput.value, 10) || 0;
          extraInput.value = Math.max(0, current + delta);
        });
      });

      // 「✅ 記録」→ rangeEnd + 余剰ページ を hiddenInput に直接セット
      // ※ updateDisplay() のクランプ（+50上限）を迂回するため直接代入する
      const extraConfirmBtn = extraPanel.querySelector('.prog-extra-confirm-btn');
      if (extraConfirmBtn) {
        extraConfirmBtn.addEventListener('click', () => {
          const extraInput = extraPanel.querySelector('.prog-extra-input');
          const extraPages = Math.max(0, parseInt(extraInput?.value, 10) || 0);
          hiddenInput.value = rangeEnd + extraPages;
          hiddenInput.dispatchEvent(new Event('input')); // previewProgressAdjustment を起動
          extraPanel.style.display = 'none';
          if (extraLink) extraLink.style.display = 'inline-block';
        });
      }
    }

    /* ── 「⚠️ 途中まで」 ── */
    if (btnPartial) {
      btnPartial.addEventListener('click', () => {
        // 現在が「完了」「進んでいない」または未入力なら、中間値を初期値にする
        const currentVal = parseInt(hiddenInput.value, 10);
        if (isNaN(currentVal) || currentVal >= rangeEnd || currentVal === rangeStart - 1) {
          const midVal = rangeStart - 1 + Math.max(1, Math.floor(plannedCount * 0.5));
          updateDisplay(Math.min(rangeEnd - 1, midVal));
        }
        setActiveState('partial');
        // パネルが開いたら入力フィールドにフォーカス
        if (progDisplayInput) {
          setTimeout(() => progDisplayInput.focus(), 50);
        }
      });
    }

    /* ── 「🚫 進んでいない」 ── */
    if (btnNotProgressed) {
      btnNotProgressed.addEventListener('click', () => {
        // hidden input に「0進捗」を示す番兵値（rangeStart - 1）をセット
        hiddenInput.value = rangeStart - 1;
        hiddenInput.dispatchEvent(new Event('input'));
        setActiveState('not-progressed');
      });
    }

    /* ── 直接入力フィールド ── */
    if (progDisplayInput) {
      // 値を反映し、状態ボタンも切り替える。クランプ後の値を返す
      const applyTyped = (val) => {
        const clampedVal = Math.max(rangeStart - 1, Math.min(rangeEnd + 50, val));
        const completedCount = Math.max(0, clampedVal - rangeStart + 1);
        const pct = plannedCount > 0 ? Math.min(100, Math.round(completedCount / plannedCount * 100)) : 0;
        if (barFill)     barFill.style.width = pct + '%';
        if (countValEl)  countValEl.textContent = completedCount;
        if (progDisplay) progDisplay.textContent = clampedVal;
        hiddenInput.value = clampedVal;
        hiddenInput.dispatchEvent(new Event('input'));
        if (clampedVal >= rangeEnd)             setActiveState('done');
        else if (clampedVal === rangeStart - 1) setActiveState('not-progressed');
        else                                    setActiveState('partial');
        return clampedVal;
      };

      // 入力中：空欄や「開始より前の値」は桁を消している途中かもしれないので何もしない
      progDisplayInput.addEventListener('input', () => {
        const raw = progDisplayInput.value.trim();
        if (raw === '') return;
        const val = parseInt(raw, 10);
        if (isNaN(val) || val < rangeStart) return;
        applyTyped(val);
      });

      // 確定時（フォーカスが外れたとき／Enter）：ここで初めて範囲外を丸める
      progDisplayInput.addEventListener('blur', () => {
        const val = parseInt(progDisplayInput.value, 10);
        if (isNaN(val)) {                       // 空欄のまま離れたら直前の有効値に戻す
          progDisplayInput.value = hiddenInput.value;
          // 入力中は開いたままだったパネルを、現在の値に合わせて整える（値は変更しない）
          const cur = parseInt(hiddenInput.value, 10);
          if (!isNaN(cur)) {
            setActiveState(cur >= rangeEnd ? 'done' : (cur === rangeStart - 1 ? 'not-progressed' : 'partial'));
          }
          return;
        }
        progDisplayInput.value = applyTyped(val);
      });

      progDisplayInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); progDisplayInput.blur(); }
      });
    }

  });
}

function attachProgressInputHandlers(container, dateStr, baseId) {
  baseId = baseId || dateStr;
  container.querySelectorAll('.progress-num-input').forEach(input => {
    input.addEventListener('input', () => {
      previewProgressAdjustment(container, dateStr, baseId);
      updateProgressDirty(container); // 【追加】未記録の入力があるとき、記録ボタンで知らせる
    });
  });
  // 新UIのインタラクションもここで初期化
  initProgressControls(container, dateStr, baseId);
  initDoneDateControls(container); // 「やった日」入力欄
}

/**
 * 入力値を読みながら「進捗バナー」をリアルタイムプレビュー
 * @param {string} [baseId] - buildProgressInputSection に渡したものと同じベースID
 */
function previewProgressAdjustment(container, dateStr, baseId) {
  baseId = baseId || dateStr;
  let hasAhead = false, hasBehind = false, hasNotProgressed = false;
  let aheadMessages = [], behindMessages = [], notProgressedLabels = [];

  container.querySelectorAll('.progress-num-input').forEach(input => {
    const val = parseInt(input.value, 10);
    if (isNaN(val)) return;
    const plannedEnd   = parseInt(input.dataset.plannedEnd,   10);
    const plannedStart = parseInt(input.dataset.plannedStart, 10);
    const type         = input.dataset.type;

    // 復習タスクは「ページ/個数」のみ記録（繰り越し再調整は行わない）
    const isReview = type === 'word-review' || type === 'book-review';
    const unit = (type === 'word' || type === 'word-review') ? '個' : 'ページ';
    const prefix = isReview ? '復習 ' : '';
    const label = (type === 'word' || type === 'word-review')
      ? `${prefix}${input.dataset.bookName || '単語'} ${plannedStart}〜${plannedEnd}`
      : `${prefix}${input.dataset.bookName || '参考書'} ${plannedStart}〜${plannedEnd}`;

    if (!isReview && val === plannedStart - 1) {
      // 「進んでいない」状態（actualEnd === plannedStart - 1）
      hasNotProgressed = true;
      notProgressedLabels.push(label);
    } else if (!isReview && val > plannedEnd) {
      // 新規タスクで予定より進んだ場合のみスケジュール再調整バナーを表示
      hasAhead = true;
      aheadMessages.push(`${label}: ${val - plannedEnd}${unit}多く進みました！`);
    } else if (val < plannedEnd && (val >= plannedStart || (isReview && val === plannedStart - 1))) {
      hasBehind = true;
      const diff = plannedEnd - val;
      if (isReview) {
        behindMessages.push(`${label}: ${diff}${unit}残っています`);
      } else {
        behindMessages.push(`${label}: ${diff}${unit}残っています → 残りのスケジュールに自動で分散します`);
      }
    }
  });

  const aheadBanner         = container.querySelector(`#ahead-banner-${baseId}`);
  const aheadText           = container.querySelector(`#ahead-text-${baseId}`);
  const behindNote          = container.querySelector(`#behind-note-${baseId}`);
  const notProgressedNote   = container.querySelector(`#not-progressed-note-${baseId}`);

  if (aheadBanner && aheadText) {
    if (hasAhead) {
      aheadText.textContent = '🎉 予定より進んでいます！ ' + aheadMessages.join(' / ') + ' 記録するとスケジュールが更新されます。';
      aheadBanner.style.display = 'flex';
    } else {
      aheadBanner.style.display = 'none';
    }
  }
  if (behindNote) {
    if (hasBehind) {
      behindNote.innerHTML = '⚠️ ' + behindMessages.map(m => escapeHtml(m)).join('<br>');
      behindNote.style.display = 'block';
    } else {
      behindNote.style.display = 'none';
    }
  }
  if (notProgressedNote) {
    if (hasNotProgressed) {
      // 「進んでいない」タスクごとに繰越メッセージを1行ずつ表示
      notProgressedNote.innerHTML = notProgressedLabels
        .map(l => `🚫 ${escapeHtml(l)}: 進んでいないため、この範囲は未完了のまま残り、翌日以降に繰り越されます。`)
        .join('<br>');
      notProgressedNote.style.display = 'block';
    } else {
      notProgressedNote.style.display = 'none';
    }
  }
}

// ★修正：復習インターバルの取得を単語・参考書で共通化（参考書も登録時に選んだ間隔を使う）
//   buildAllReviews() と同じ規則（未設定・空配列なら DEFAULT_INTERVALS）に揃える。
function getIntervalsOf(entity) {
  return (entity && entity.intervals && entity.intervals.length) ? entity.intervals : DEFAULT_INTERVALS;
}

/**
 * 進捗を保存してスケジュールを再描画
 * @param {string} [baseId] - buildProgressInputSection に渡したものと同じベースID
 */
function handleProgressSave(dateStr, baseId) {
  baseId = baseId || dateStr;
  const container = document.getElementById(`progress-section-${baseId}`);
  if (!container) return;

  // 日付をまたいで画面を開いたままにしていた場合：古い日付のまま保存すると記録の日付がずれるため、
  // 保存せずに最新の日付で描き直す。
  if (dateStr !== todayISO()) {
    renderAll();
    renderIntegratedSchedule();
    renderRefTodayCard();
    showToast('日付が変わっていたため、画面を最新の日付に更新しました。お手数ですが、もう一度記録してください。', null, null, 8000);
    return;
  }

  const inputs = container.querySelectorAll('.progress-num-input');
  // 【追加】保存前の状態を控えておく（保存直後の「元に戻す」用。状態は dailyProgress と reviewDoneSet のみ）
  const undoSnap = { progress: JSON.stringify(dailyProgress), done: Array.from(reviewDoneSet) };
  let saved = 0;
  let unchanged = 0; // 記録済みから変更のなかった項目数

  // 保存するレコードを収集（後で復習スケジュール表示に使う）
  const savedRecords = [];

  inputs.forEach(input => {
    const val = parseInt(input.value, 10);
    if (isNaN(val)) return;

    const type = input.dataset.type;
    const plannedStart = parseInt(input.dataset.plannedStart, 10);
    const plannedEnd   = parseInt(input.dataset.plannedEnd,   10);
    const bookName     = input.dataset.bookName || '';

    // 「やった日」（新規タスクのみ）。今日より未来は今日に丸める。未入力は今日。
    const doneDateInput = input.closest('.progress-item')?.querySelector('.prog-done-date');
    let doneDate = doneDateInput?.value || dateStr;
    if (doneDate > dateStr) doneDate = dateStr;

    // 記録済みの値・実施日から変わっていない項目は再保存しない（実施日や完了記録を意図せず上書きしないため）
    const initialVal = input.dataset.initialVal;
    if (initialVal !== undefined && initialVal !== '' && parseInt(initialVal, 10) === val &&
        (!doneDateInput || doneDate === (input.dataset.initialDoneDate || dateStr))) {
      unchanged++;
      return;
    }

    if (type === 'word-review' || type === 'book-review') {
      // ── 復習タスクの進捗記録（reviewKey で識別）──
      const reviewKey = input.dataset.reviewKey;
      // チェックボックスと同じ共通関数で記録する（dailyProgress と reviewDoneSet を同時に更新）。
      // val が plannedEnd に達していれば完了、未達（途中・進捗なし含む）なら未完了としてカレンダーに残す。
      const record = recordReviewProgress({
        reviewKey, type, dateStr, plannedStart, plannedEnd, actualEnd: val, bookName
      });
      savedRecords.push(record);
      saved++;
    } else {
      // ── 新規タスク（word / book）の進捗記録（entryId で識別）──
      const entryId = input.dataset.entryId;
      // word: entryId は composite key（entryId_chunkDate_rangeStart）、originEntryId は元の entry.id
      const originEntryId = input.dataset.originEntryId || undefined;
      // book タイプは planId（参考書プランID）も別途保持する
      // entryId は「planId_originalDate_rangeStart」の複合キーなので refEntries への紐付けに planId を使う
      const planId = input.dataset.planId || entryId;

      // ★追加：教材の終了番号でクランプ（範囲外の番号が復習・完了判定に混入するのを防ぐ）
      const material = type === 'word'
        ? entries.find(e => e.id === originEntryId)
        : refEntries.find(r => r.id === planId);
      const actualEnd = material ? Math.min(val, material.endNum) : val;
      // ── Bug 1 修正：保存前に旧キーを reviewDoneSet から除去 ──
      // 再保存前に旧キーを reviewDoneSet から除去する。
      // キー形式: `${prefix}_prog_${resolved}_${p.date}_${p.plannedStart}_${n}` (actualEnd はキーに含めない)
      // handleProgressClear の ② と同じロジックを適用する。
      dailyProgress
        .filter(p => p.date === dateStr && p.entryId === entryId && p.type === type && !p.notProgressed)
        .forEach(p => {
          const prefix   = type === 'word' ? 'w' : 'r';
          const resolved = type === 'word'
            ? (p.originEntryId || p.entryId)
            : (p.planId || p.entryId);
          const entity = type === 'word'
            ? entries.find(e => e.id === resolved)
            : refEntries.find(r => r.id === resolved);
          if (!entity) return;
          const intervals = getIntervalsOf(entity);
          intervals.forEach(n => {
            const key = `${prefix}_prog_${resolved}_${p.date}_${p.plannedStart}_${n}`;
            reviewDoneSet.delete(key);
            reviewDoneSet.delete(key.replace(MOVED_KEY_SUFFIX_RE, '')); // movedKey 派生も念のため削除
          });
        });
      dailyProgress = dailyProgress.filter(
        p => !(p.date === dateStr && p.entryId === entryId && p.type === type)
      );
      const record = {
        id: genId('dp_'),
        date: dateStr,
        entryId,
        originEntryId: type === 'word' ? originEntryId : undefined, // ★ word: 元の entry.id を別途保存
        planId: type === 'book' ? planId : undefined, // book のみ planId を保持
        type,
        plannedStart,
        plannedEnd,
        actualEnd,
        bookName,
        // ★実施日：入力日と違う日にやった場合だけ記録（進んでいない記録には付けない）。復習の起点に使われる
        doneDate: (actualEnd >= plannedStart && doneDate !== dateStr) ? doneDate : undefined,
        notProgressed: actualEnd === plannedStart - 1  // ← 追加: 進捗なし（actualEnd === plannedStart - 1）のフラグ
      };
      dailyProgress.push(record);
      savedRecords.push(record);
      saved++;
    }
  });

  if (saved === 0) {
    showToast(unchanged > 0 ? '変更された項目がありません。' : '進捗を入力してから記録してください（「✅ 完了」などをタップ）。');
    return;
  }

  saveDailyProgress();
  // スケジュール全体を再描画（進捗に基づき再計算される）
  saveReviewDone(); // ← 追加：reviewDoneSet の変更を永続化
  renderIntegratedSchedule();
  refreshAllSchedules();
  renderRefTodayCard();

  // 【追加】記録できたことを知らせる（5秒間は「元に戻す」で取り消せる）
  showToast(`${saved}件の進捗を記録しました。`, '元に戻す', () => {
    dailyProgress = JSON.parse(undoSnap.progress);
    reviewDoneSet = new Set(undoSnap.done);
    saveDailyProgress();
    saveReviewDone();
    renderIntegratedSchedule();
    refreshAllSchedules();
    renderRefTodayCard();
    showToast('記録を取り消しました。');
  });

  // スケジュールタブ内の進捗セクションに単語復習プレビューを注入
  const wordRecordsForPreview = savedRecords.filter(r => r.type === 'word');
  if (wordRecordsForPreview.length > 0) {
    // renderIntegratedSchedule() 後に再生成された progress-section を探す
    // スケジュールタブでは baseId === dateStr
    const progressSectionEl = document.getElementById(`progress-section-${dateStr}`);
    if (progressSectionEl) {
      // 既存のプレビューがあれば除去（重複防止）
      const existing = progressSectionEl.querySelector(`#word-review-preview-${dateStr}`);
      if (existing) existing.remove();
      const previewHtml = buildWordReviewPreviewHtml(dateStr, wordRecordsForPreview);
      if (previewHtml) {
        const previewEl = document.createElement('div');
        previewEl.id = `word-review-preview-${dateStr}`;
        previewEl.innerHTML = previewHtml;
        progressSectionEl.appendChild(previewEl);
      }
    }
  }
}

/**
 * 単語の進捗記録から「復習スケジュールプレビュー」HTMLを生成するヘルパー。
 * スケジュールタブ内インジェクションから呼ばれる。
 * @param {string} dateStr     - 進捗を記録した日付 (YYYY-MM-DD)
 * @param {Array}  wordRecords - type === 'word' の savedRecords 配列
 * @returns {string} HTML文字列（対象なしの場合は空文字）
 */
function buildWordReviewPreviewHtml(dateStr, wordRecords) {
  if (!wordRecords || wordRecords.length === 0) return '';

  let wordsHtml = '';
  let hasAnyReview = false; // 復習スロットが1件以上生成されたか（タイトル分岐用）

  wordRecords.forEach(rec => {
    // ── 「進んでいない」レコードはスロット表示をスキップし繰越メッセージを表示 ──
    if (rec.notProgressed) {
      wordsHtml += `
        <div class="progressed-review-book">
          <div class="progressed-review-book-name">
            📖 単語 ${rec.plannedStart}〜${rec.plannedEnd}
            <span class="range-badge">${rec.plannedStart}〜${rec.plannedEnd}番</span>
          </div>
          <div class="progressed-undershot" style="background:#fff7ed;border-color:#fed7aa;color:#9a3412;">
            🚫 進んでいないため、この範囲は未完了のまま残り、翌日以降に繰り越されます。
          </div>
        </div>`;
      return; // 復習スロット生成をスキップ
    }

    // ── 通常の進捗レコード ──
    const entry = entries.find(e => e.id === (rec.originEntryId || rec.entryId));
    if (!entry) return;

    hasAnyReview = true;
    const actualEnd  = rec.actualEnd;
    const diff       = actualEnd - rec.plannedEnd;

    let diffHtml = '';
    if (diff > 0) {
      diffHtml = `<div class="progressed-overshot">🎉 予定より ${diff}個多く進みました！ 余分に進んだ分も復習対象に追加されました。</div>`;
    } else if (diff < 0) {
      diffHtml = `<div class="progressed-undershot">⚠️ ${Math.abs(diff)}個残りました。残りは以降のスケジュールに自動分散されました。</div>`;
    }

    const slotsHtml = (entry.intervals || DEFAULT_INTERVALS).map(n => {
      const d = addDays(parseISO(rec.doneDate || dateStr), n); // ★実施日基準
      const wdLabel  = WEEKDAYS[d.getDay()];
      const dispDate = `${d.getMonth()+1}/${d.getDate()}（${wdLabel}）`;
      const tier      = getIntervalTier(n);
      const tierLabel = getIntervalTierStyle(tier).label;
      return `<span class="progressed-review-slot slot-t${tier}">
        <span class="slot-date">${dispDate}</span>
        <span class="slot-lv">${n}日後 ${tierLabel}</span>
      </span>`;
    }).join('');

    wordsHtml += `
      <div class="progressed-review-book">
        <div class="progressed-review-book-name">
          📖 単語 ${rec.plannedStart}〜${actualEnd}
          <span class="range-badge">${rec.plannedStart}〜${actualEnd}番</span>
        </div>
        ${diffHtml}
        <div style="font-size:.8rem;color:var(--ink-soft);margin-bottom:6px;font-weight:600;">📅 この範囲の復習予定日：</div>
        <div class="progressed-review-slots">${slotsHtml}</div>
      </div>`;
  });

  if (!wordsHtml) return '';

  // タイトルを内容に合わせて分岐（全件繰越 / 一部繰越 / 全件復習追加）
  const sectionTitle = hasAnyReview
    ? '📖 単語の進捗を記録 — 復習スケジュールが追加されました'
    : '📖 単語の進捗を記録 — 繰り越し処理が完了しました';

  return `<div class="progressed-review-section" style="margin-top:16px;">
    <div class="progressed-review-title">${sectionTitle}</div>
    ${wordsHtml}
  </div>`;
}

/**
 * 今日の進捗記録をクリアしてスケジュールを元に戻す
 */
function handleProgressClear(dateStr) {
  if (!confirm(`${dateStr} の進捗記録をリセットしますか？\nスケジュールが元の計画に戻ります。`)) return;
  // dailyProgress を削除する前に、対象日の復習キーを reviewDoneSet から除去
  const reviewKeysToRemove = dailyProgress
    .filter(p => p.date === dateStr && (p.type === 'word-review' || p.type === 'book-review') && p.reviewKey)
    .map(p => p.reviewKey);
  reviewKeysToRemove.forEach(k => {
    reviewDoneSet.delete(k);
    reviewDoneSet.delete(k.replace(MOVED_KEY_SUFFIX_RE, '')); // 追加: originalKey も削除
  });

  // ② word/book 型の進捗記録から buildProgressReviews() で生成されるレビューキーも除去する。
  // カレンダーのチェックボックスで reviewDoneSet に追加されたキーが、クリア後の再記録時に
  // 「完了済み」と誤認されるのを防ぐための修正。
  // キー形式: `${prefix}_prog_${resolved}_${p.date}_${p.plannedStart}_${n}` (actualEnd はキーに含めない)
  dailyProgress
    .filter(p => p.date === dateStr && (p.type === 'word' || p.type === 'book') && !p.notProgressed)
    .forEach(p => {
      const prefix   = p.type === 'word' ? 'w' : 'r';
      const resolved = p.type === 'word'
        ? (p.originEntryId || p.entryId)
        : (p.planId || p.entryId);
      const entity = p.type === 'word'
        ? entries.find(e => e.id === resolved)
        : refEntries.find(r => r.id === resolved);
      const intervals = getIntervalsOf(entity);
      intervals.forEach(n => {
        const key = `${prefix}_prog_${resolved}_${p.date}_${p.plannedStart}_${n}`;
        reviewDoneSet.delete(key);
        reviewDoneSet.delete(key.replace(MOVED_KEY_SUFFIX_RE, '')); // movedKey 派生も念のため削除
      });
    });

  saveReviewDone();

  dailyProgress = dailyProgress.filter(p => p.date !== dateStr);
  saveDailyProgress();
  renderIntegratedSchedule();
  refreshAllSchedules();
  renderRefTodayCard();
}

function renderTodayNew(){
  const box = document.getElementById('todayNewBox');
  if (!box) return;
  const todayIso = todayISO();
  const { vocabChunks: allChunks } = buildScheduleData();
  const todayChunks = allChunks.filter(c => c.date === todayIso);
  if(todayChunks.length === 0){
    box.innerHTML = `<div class="empty-mini">今日の新規範囲はありません。</div>`;
  }else{
    // ★ 参考書の今日カードと設計を共通化：教材名を併記する
    box.innerHTML = todayChunks.map(c => `<span class="today-new-tag">${escapeHtml(c.bookName || '単語')} ${c.rangeStart}〜${c.rangeEnd}</span>`).join('');
  }
}

/**
 * 参考書タブの「今日やること」カードを描画する。
 * - 今日の新規参考書チャンク（繰り越し含む）を緑タグで表示
 * - 今日の参考書復習を状態表示つきで表示（記録は「スケジュール」タブの進捗入力パネルで行う）
 */
function renderRefTodayCard() {
  const newBox    = document.getElementById('refTodayNewBox');
  const reviewList = document.getElementById('refTodayReviewList');
  if (!newBox || !reviewList) return;

  const todayStr = todayISO();
  const { refChunks, refReviews } = buildScheduleData();

  // ── 今日の新規範囲 ──────────────────────────────────────────
  const todayChunks = refChunks.filter(c => c.date === todayStr);
  if (todayChunks.length === 0) {
    newBox.innerHTML = '<div class="empty-mini">今日の参考書範囲はありません。</div>';
  } else {
    newBox.innerHTML = todayChunks.map(c => {
      // STEP 8: 未完了繰越バッジを統一形式で表示（carriedForward / isCarriedNew 両対応）
      const cfBadge = c.carriedForward
        ? buildCarryBadgeHtml(c.originalDate)
        : (c.isCarriedNew ? buildCarryBadgeHtml(c.originalDate || null) : '');
      return `<span class="today-ref-tag">${escapeHtml(c.bookName)}<br><span style="font-weight:400;font-size:.82em;">p.${c.rangeStart}〜${c.rangeEnd}</span>${cfBadge ? '<br>' + cfBadge : ''}</span>`;
    }).join('');
  }

  // ── 今日の復習 ──────────────────────────────────────────────
  const todayReviews = refReviews.filter(r => r.date === todayStr);
  if (todayReviews.length === 0) {
    reviewList.innerHTML = '<div class="empty-mini">今日の参考書復習はありません。</div>';
  } else {
    // 未完了を先頭、完了済みを後ろに並べる
    const sorted = [...todayReviews].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
    const itemsHtml = sorted.map(r => {
      // STEP 8: 復習バッジを統一形式で表示（🔁 復習 Lv.X [N日後] + 🔄 [遅れN日]）
      const reviewBadge = buildReviewBadgeHtml(r.interval, r.delayedDays);
      return `<div class="ref-review-item${r.done ? ' is-done' : ''}">
        <div class="ref-book-info">
          <span class="ref-book-title">${escapeHtml(r.bookName)}</span>
          <span class="ref-book-range">p.${r.rangeStart}〜${r.rangeEnd}</span>
        </div>
        <span class="tag tag-ref-review tag-review-t${getIntervalTier(r.interval)} review-check-label${r.done ? ' is-done' : ''}"
               style="padding:6px 12px; display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${reviewStatusIconHtml(r)}
          ${reviewBadge}
        </span>
      </div>`;
    }).join('');
    reviewList.innerHTML = `<div class="due-list" style="gap:10px;">${itemsHtml}</div>
      <div class="hint" style="margin-top:8px;">復習の記録は「スケジュール」タブの「今日のタスク」で行います。
        <button type="button" class="btn-ghost ref-go-schedule-btn" style="font-size:.78rem;padding:4px 10px;">スケジュールタブを開く</button>
      </div>`;
    reviewList.querySelector('.ref-go-schedule-btn')?.addEventListener('click', () => showTab('schedule'));
  }

}

function renderAll(){
  renderEntryList();
  refreshAllSchedules();
  renderTodayNew();
}

/* =========================================================
   【追加】初回案内・未記録の進捗の検知
========================================================= */

// 初回（単語も参考書も未登録）に出す案内。「上のフォーム」ではなく、登録タブへ直接移動できるボタンを置く。
function buildOnboardingHtml() {
  return `<div class="onboarding-card">
    <div class="ob-title">🌱 はじめに：1分で今日のタスクが出ます</div>
    <ol class="ob-steps">
      <li>単語帳か参考書を1つ登録する</li>
      <li>この画面に、今日やることと復習が自動で並ぶ</li>
      <li>終わったら「✅ 完了」をタップして記録する</li>
    </ol>
    <div class="ob-actions">
      <button type="button" class="btn-primary" onclick="showTab('study')">📖 単語帳を登録する</button>
      <button type="button" class="btn-ghost" onclick="showTab('reference')">📚 参考書を登録する</button>
    </div>
  </div>`;
}

// 「完了／途中まで」などを選んだのに、まだ「記録」を押していない項目の数（画面上の入力から数える）
function countUnsavedProgress() {
  let n = 0;
  document.querySelectorAll('.progress-section .progress-num-input').forEach(inp => {
    if (inp.value === '') return;
    const init = inp.dataset.initialVal;
    if (init === undefined || init === '' || parseInt(init, 10) !== parseInt(inp.value, 10)) n++;
  });
  return n;
}

// 未記録の入力があるとき、記録ボタンの文言と色を変えて「押し忘れ」を防ぐ
function updateProgressDirty(container) {
  let n = 0;
  container.querySelectorAll('.progress-num-input').forEach(inp => {
    if (inp.value === '') return;
    const init = inp.dataset.initialVal;
    if (init === undefined || init === '' || parseInt(init, 10) !== parseInt(inp.value, 10)) n++;
  });
  container.querySelectorAll('.progress-save-row .btn-primary').forEach(btn => {
    if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent.trim();
    btn.classList.toggle('is-dirty', n > 0);
    btn.textContent = n > 0 ? `📌 未記録の${n}件を記録してスケジュールを調整` : btn.dataset.label;
  });
}

// 未記録のままページを閉じようとしたときの確認
window.addEventListener('beforeunload', e => {
  if (countUnsavedProgress() > 0) { e.preventDefault(); e.returnValue = ''; }
});
