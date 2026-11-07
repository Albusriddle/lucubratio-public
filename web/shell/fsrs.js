/* ============================================================
   Lucubratio · FSRS 调度适配层
   算法来自 vendored ts-fsrs 4.7.0（FSRS-5.0，MIT），本文件只做
   「存储结构 ↔ 库结构」的转换与薄封装，不实现任何调度公式。
   存储里的卡片用毫秒时间戳（IndexedDB 好存好比较），库要 Date。
   ============================================================ */
import { fsrs, createEmptyCard, Rating, State, generatorParameters } from '../vendor/ts-fsrs.mjs';

const f = fsrs(generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,        // 关掉随机模糊，保证同样的操作得到同样的排期（可测试）
  enable_short_term: true,
}));

export const RATING = {
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
};

export const STATE_LABEL = ['新卡', '学习中', '复习中', '重学中'];

function toFsrs(rec) {
  return {
    due: new Date(rec.due),
    stability: rec.stability || 0,
    difficulty: rec.difficulty || 0,
    elapsed_days: rec.elapsed_days || 0,
    scheduled_days: rec.scheduled_days || 0,
    reps: rec.reps || 0,
    lapses: rec.lapses || 0,
    state: rec.state == null ? State.New : rec.state,
    last_review: rec.last_review ? new Date(rec.last_review) : undefined,
  };
}

function fromFsrs(qid, card) {
  return {
    qid: qid,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

export function emptyRecord(qid, now) {
  return fromFsrs(qid, createEmptyCard(now || new Date()));
}

/** 打分 → 新卡片 + 复习日志（log 的时间是 Date，调用方需要时再转） */
export function schedule(rec, rating, now) {
  const out = f.next(toFsrs(rec), now || new Date(), rating);
  return { card: fromFsrs(rec.qid, out.card), log: out.log };
}

/** 预览四档评分的下一次间隔（天），用于把"下次 3 天"显示在按钮上 */
export function preview(rec, now) {
  const base = toFsrs(rec);
  const out = f.repeat(base, now || new Date());
  const res = {};
  [RATING.Again, RATING.Hard, RATING.Good, RATING.Easy].forEach(function (r) {
    const item = out[r];
    if (!item) return;
    res[r] = {
      due: item.card.due.getTime(),
      days: item.card.scheduled_days,
      state: item.card.state,
    };
  });
  return res;
}
