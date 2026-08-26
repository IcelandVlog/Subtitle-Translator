"use client";

import { useEffect, useRef, useState } from "react";
import type { LineTranslatedEvent } from "@/app/lib/translation/pipeline";

/** A single live line in the streaming results list. */
export interface LiveLine {
  index: number;
  /** Physical source line number when the caller supplied a mapping. */
  line?: number;
  original: string;
  translation: string;
  failed: boolean;
}

/**
 * 实时面板最多保留多少行。它是「正在发生什么」的取景窗,不是结果区 ——
 * 完整结果在下方的结果区,整轮结束后才有意义。上限同时封住 state 体积和
 * 每次 flush 的渲染量。
 */
const MAX_LIVE_LINES = 200;
/** 实时行攒批窗口(ms)—— 见 flushLiveLines 的注释。 */
const LIVE_FLUSH_MS = 100;
/** 稳定的空快照 —— useSyncExternalStore 要求"没变化就返回同一个引用"。 */
const NO_LIVE_LINES: LiveLine[] = [];

/** 实时行的外部 store 契约(见 useTranslationProgress 里的说明)。 */
export interface LiveLinesStore {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => LiveLine[];
  /** 冻结/解冻发布 —— 面板在用户上滚阅读期间冻结,滚回底部解冻。 */
  setPaused: (paused: boolean) => void;
}

/** 按行序排出当前窗口 —— 引擎并发发射,Map 的到达序不是行序。 */
const ordered = (map: Map<number, LiveLine>): LiveLine[] => [...map.values()].sort((a, b) => a.index - b.index);

const publish = (snapshotRef: { current: LiveLine[] }, listeners: Set<() => void>, next: LiveLine[]) => {
  snapshotRef.current = next;
  for (const notify of listeners) notify();
};

/**
 * Progress + abort state for a single translation run.
 *
 * `abortControllerRef` is shared across all concurrent translate calls in a
 * run so one auth failure (or user cancel) can tear them all down at once.
 * `makeUpdateProgress` builds a progress callback scoped to a specific file
 * slice within a multi-file translation, normalizing fractional/overflowing
 * progress into a clean {percent, current, total} pair.
 */
// 曾经的用户请求:「一切换页 / 开新 tab,翻译就断」——不该断。翻译循环靠闭包
// 自持、真实 API 请求已经发出去了,唯一决定它是否被【强行】腰斩的是这两个
// ref 是否随组件卸载被清空。之前它们是 useRef,活在单个组件实例上:
// Provider 卸载(切语言触发的 [locale] 路由重渲染、或任何未来的站内导航)会
// 触发下面这条 cleanup,abort 掉在飞请求、并把 disposedRef 钉死为 true,
// 于是 translateSingle/translateBatch 里的 shouldStop 短路,后续语言/文件
// 全部放弃。
//
// 现在把它们提到模块作用域:生命周期跟着【这个标签页的 JS 环境】走,而不是
// 跟着某一次组件挂载走。组件重挂载(locale 切换、面板重新渲染)不再摸到这两
// 个引用,翻译循环该怎么跑还怎么跑,直到它自己 resolve/reject,或者用户主动
// 点击取消按钮(那条路径走 requestCancel,直接 abort 当前 run 的 controller,
// 和这里无关,见 useTranslationState.tsx)。
// ⚠ 前提:同一个标签页里 useTranslationProgress 只会被实例化一次(当前只有
// 一个 TranslationProvider)。如果未来同一页面要并存多个独立的翻译面板,这两
// 个 module 级引用需要按 provider 实例分开(比如用一个 Map),否则会互相打断。
const globalAbortControllerRef: { current: AbortController | null } = { current: null };
const globalDisposedRef: { current: boolean } = { current: false };

export const useTranslationProgress = () => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const abortControllerRef = globalAbortControllerRef;
  const disposedRef = globalDisposedRef;

  // ─── 预计剩余时间(ETA)──────────────────────────────────────────────────
  // 只按【整体百分比 vs 已耗时】线性外推 —— 不按「当前文件的 current/total」算,
  // 因为 makeUpdateProgress 的 current/total 是【单个文件内部】的行数,多文件/
  // 多语言批次里跨文件切换时会突然归零再重新计数,拿它做速率会在每个文件边界
  // 抖成锯齿。progress(下面算出的全局 0-100)跨文件是连续的,线性外推稳。
  //
  // ⚠ 就地算在 makeUpdateProgress 的回调里,不用 useEffect 追 progressPercent
  // 再 setState —— 那是"在 effect 里镜像 state"的反模式(本仓开着的
  // react-hooks/set-state-in-effect 规则会直接拒绝),而且语义也不对:这里要的
  // 是「这次进度事件发生时该报多少」,不是「progressPercent 变了就重新算」,
  // 两者在此等价,但前者才是事件驱动的正确写法。
  const runStartTimeRef = useRef<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  /**
   * Build a progress-updater for one file within a multi-file batch.
   * `fileIndex` / `totalFiles` map per-file [0..1] into the global progress bar.
   */
  const makeUpdateProgress =
    (fileIndex: number = 0, totalFiles: number = 1) =>
    (current: number, total: number) => {
      const progress = ((fileIndex + current / total) / totalFiles) * 100;
      setProgressPercent(progress);
      // `current` can be fractional (e.g. 0.5 kick value to avoid a 0% stall) — floor it for display.
      setProgressInfo({ current: Math.min(Math.floor(current), total), total });
      // 5% 门槛:翻完第一行就可能是 2%,样本太小,除出来的「还要 40 分钟」这种
      // 数字比不显示更误导人;到 5% 时噪声已经收敛到能看的程度。100% 时已经
      // 没有「剩多久」这个问题,不算。
      if (progress >= 5 && progress < 100 && runStartTimeRef.current !== null) {
        const elapsedMs = Date.now() - runStartTimeRef.current;
        const remainingMs = (elapsedMs / progress) * (100 - progress);
        setEtaSeconds(Math.max(0, Math.round(remainingMs / 1000)));
      }
    };

  const resetProgress = () => {
    setProgressPercent(0);
    setProgressInfo({ current: 0, total: 0 });
    // 计时起点钉在这里(runTranslation 在发第一个请求前就调用它),比等第一次
    // progressPercent 变化再起表更早、更准 —— 请求排队/探测阶段的耗时也该算进
    // 「已经花了多久」里,否则 ETA 会系统性偏乐观。
    runStartTimeRef.current = Date.now();
    setEtaSeconds(null);
  };

  // ─── 实时逐行结果(与进度条并行的第二通道)──────────────────────────────
  // 每一行定稿立即上屏,不等整批结束(LLM 上下文批一条 20-60s)。失败行不在
  // 这里呈现 —— 失败面板是它们的统一出口,这里混入"原文副本"只会让用户以为
  // 译出了。文档变化 / 重跑由调用方 clearLiveLines 复位。
  //
  // 事实源是 Map(index → 行)而不是数组:引擎【并发】发射,到达顺序不是行序
  // (line 路径是 p-limit 并发,上下文路径还会在批次前补发缓存命中的槽),而
  // 面板必须按行序读。Map 顺带把「同一槽重发」变成天然覆盖,不需要额外的
  // 去重游标。
  //
  // ⚠ Map 的迭代序被当作【到达序】用,所以重发同一槽时必须 delete 再 set ——
  // 直接 set 会保留旧位置,那一行在"最近 N 条"里就永远停在老位置。
  // ⚠ 实时行【不】用 useState —— 那会把它放进本 hook 的返回值,而本 hook 由
  // useTranslationState 消费、后者又是 TranslationContext 的 value(每次渲染
  // 都是新对象)。于是 10 次/秒的 flush 会重渲染整棵工具树(含装着整份源文的
  // SourceArea、结果区、语言选择器),而真正需要更新的只有那个面板。
  // 改成外部 store:状态住在 ref 里,只有 useSyncExternalStore 的订阅者(面板
  // 自己)被通知,context 的 value 不因实时行变化而变。
  const liveLinesRef = useRef<Map<number, LiveLine>>(new Map());
  const liveSnapshotRef = useRef<LiveLine[]>(NO_LIVE_LINES);
  const liveListenersRef = useRef<Set<() => void>>(new Set());
  // 冻结开关(面板在用户上滚阅读时打开)。冻结 = 不再发布新快照 —— 快照身份
  // 不变,订阅者既不重渲染也不滚动,而 Map 照常在背后累积。窗口淘汰只动 Map,
  // 已发布的那个数组不受影响,所以用户正在读的行不会中途消失。
  const livePausedRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useState 的惰性初值(不是 useRef):store 要在 render 里读出来传给面板,
  // 而 React Compiler 禁止 render 期间读 ref。方法只碰 ref,首渲染建一次即可。
  const [liveLinesStore] = useState<LiveLinesStore>(() => ({
    subscribe: (onChange) => {
      liveListenersRef.current.add(onChange);
      return () => void liveListenersRef.current.delete(onChange);
    },
    getSnapshot: () => liveSnapshotRef.current,
    setPaused: (paused) => {
      if (livePausedRef.current === paused) return;
      livePausedRef.current = paused;
      // 解冻时立刻补上冻结期间攒下的行,不必等下一次 flush。
      if (!paused) publish(liveSnapshotRef, liveListenersRef.current, ordered(liveLinesRef.current));
    },
  }));
  const publishLiveLines = (next: LiveLine[]) => {
    if (livePausedRef.current) return;
    publish(liveSnapshotRef, liveListenersRef.current, next);
  };

  // 攒批 flush。引擎逐行发射(3000 行的 SRT 就是 3000 次),每次都 setState
  // 等于把一整轮翻译变成一整轮重渲染。100ms 一窗把它压到 ≤10 次/秒,肉眼
  // 仍然是"实时"。
  //
  // ⚠ 窗口按【到达序】取最近 MAX_LIVE_LINES 条,取完【再】按 index 排序显示。
  // 反过来(先按 index 排序、再 slice(-N))取的是"下标最大的 N 行",两者在
  // 顺序翻译时碰巧一致,一旦有缓存补发就完全不同:续跑一份中间失败的 1000 行
  // 字幕,补发的 ~950 行缓存把窗口钉死在 800-999,而本轮真正在翻的 400-450
  // 永远进不了面板 —— 整轮静止,恰是这个面板要解决的问题的反面。
  const flushLiveLines = () => {
    flushTimerRef.current = null;
    publishLiveLines(ordered(liveLinesRef.current));
  };
  const scheduleLiveFlush = () => {
    if (flushTimerRef.current === null) flushTimerRef.current = setTimeout(flushLiveLines, LIVE_FLUSH_MS);
  };

  // 顺手取消待发的 flush。⚠ 别把它写成"不取消的话行会长回来"—— 不会:Map 已经
  // 被整个换掉,那一发只会 publish 一个空数组。真实理由小得多:不留一个属于上
  // 一轮的定时器,在下一轮任意时刻抢在攒批窗口前面打一次早到的 flush。
  const clearLiveLines = () => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    liveLinesRef.current = new Map();
    // ⚠ 解冻 + 无条件发布。冻结是"用户正在读这一轮的内容"的状态,而这一轮已经
    // 没了;不解冻的话:用户在文件 1 上滚读过一次,而 isTranslating 横跨整个
    // 批量循环、面板不卸载,于是剩下每个文件的面板都停在原地再也不跟随。
    livePausedRef.current = false;
    publish(liveSnapshotRef, liveListenersRef.current, NO_LIVE_LINES);
  };

  // 新行入流。⚠ 只管【内容】;「这一行最终没译出」的标记走 markLiveLinesFailed。
  const recordLiveLine = (result: LineTranslatedEvent) => {
    const map = liveLinesRef.current;
    map.delete(result.index); // 重发要移到队尾 —— 见上面「到达序」的注释
    map.set(result.index, { ...result, failed: false });
    // 超出窗口的最旧几条直接丢掉:Map 就是窗口本身,不留只增不减的全量历史。
    while (map.size > MAX_LIVE_LINES) map.delete(map.keys().next().value as number);
    scheduleLiveFlush();
  };

  // 把已上屏的行标记为最终失败(失败面板确认这些槽位保留原文后调用)。
  // 只翻 failed 位,不动 original/translation —— 用户已经看到的内容不抹掉。
  // ⚠ 这里【同步】落地,不能走 scheduleLiveFlush:它在一轮 translateBatch 结束
  // 时被调用,而紧接着的下一句就是 clearLiveLines()(会 clearTimeout 掉待发的
  // flush),最后一个语种更是 setIsTranslating(false) 直接卸载面板 —— 100ms 的
  // 窗口必然被抢跑,琥珀「未译出」永远画不出来。它一轮只调用一次,同步没有
  // 攒批要解决的那个问题。
  const markLiveLinesFailed = (indices: Iterable<number>) => {
    const map = liveLinesRef.current;
    let changed = false;
    for (const index of indices) {
      const line = map.get(index);
      if (line && !line.failed) {
        map.set(index, { ...line, failed: true });
        changed = true;
      }
    }
    if (!changed) return;
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushLiveLines();
  };

  // 卸载时丢掉待发的 flush —— 落地也无处可去。
  useEffect(() => () => void (flushTimerRef.current !== null && clearTimeout(flushTimerRef.current)), []);

  return {
    isTranslating,
    setIsTranslating,
    progressPercent,
    setProgressPercent,
    progressInfo,
    setProgressInfo,
    abortControllerRef,
    disposedRef,
    makeUpdateProgress,
    resetProgress,
    etaSeconds,
    liveLinesStore,
    clearLiveLines,
    recordLiveLine,
    markLiveLinesFailed,
  };
};
