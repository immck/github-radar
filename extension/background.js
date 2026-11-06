import { getSettings } from './src/core/settings.js';
import { getSession, processCrawlStep, startCrawl, getLastTask, getCounts } from './src/core/crawl.js';
import { CATEGORIES } from './src/core/defaults.js';

const TICK_ALARM = 'radar-tick';
const SCHEDULE_ALARM = 'radar-schedule';

async function ensureSchedule() {
  const settings = await getSettings();
  const period = Math.max(1, Number(settings.crawlIntervalMinutes) || 360);
  await chrome.alarms.clear(SCHEDULE_ALARM);
  await chrome.alarms.create(SCHEDULE_ALARM, { periodInMinutes: period });
}

function notify() {
  chrome.runtime.sendMessage({ type: 'radar:changed' }).catch(() => {});
}

async function setBadge(running) {
  await chrome.action.setBadgeText({ text: running ? '…' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
}

async function tick() {
  const session = await getSession();
  if (!session) {
    await chrome.alarms.clear(TICK_ALARM);
    await setBadge(false);
    return;
  }

  const result = await processCrawlStep();
  notify();

  if (result.done) {
    await chrome.alarms.clear(TICK_ALARM);
    await setBadge(false);
    return;
  }

  await setBadge(true);

  if (result.paused) {
    const resetAt = Number(result.session?.pauseUntil ?? 0);
    const delay = Math.max(1, Math.min(60, Math.round((resetAt - Date.now()) / 60_000) || 5));
    await chrome.alarms.create(TICK_ALARM, { delayInMinutes: delay });
    return;
  }

  await chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1 });
}

function categoryKeywordMap() {
  return Object.fromEntries(CATEGORIES.map((category) => [category.slug, category.keywords]));
}

async function startAndTick(trigger) {
  const existing = await getSession();
  if (!existing) {
    await startCrawl({ trigger, categoryKeywords: categoryKeywordMap() });
    await setBadge(true);
  }
  await tick();
  return getSession();
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSchedule();
  void setBadge(false);
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await ensureSchedule();
    const session = await getSession();
    if (session) {
      await chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1 });
      await setBadge(true);
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    void tick().catch(async (error) => {
      console.error('[radar] tick failed', error);
      await chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1 });
    });
    return;
  }
  if (alarm.name === SCHEDULE_ALARM) {
    void (async () => {
      const settings = await getSettings();
      if (!settings.githubToken) return;
      await startAndTick('schedule');
    })().catch((error) => console.error('[radar] schedule failed', error));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  (async () => {
    switch (message.type) {
      case 'crawl:start': {
        const session = await startAndTick('manual');
        sendResponse({ ok: true, session });
        return;
      }
      case 'crawl:status': {
        const [session, lastTask, counts] = await Promise.all([
          getSession(),
          getLastTask(),
          getCounts(),
        ]);
        sendResponse({ ok: true, session, lastTask, counts });
        return;
      }
      case 'settings:updated': {
        await ensureSchedule();
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message ?? String(error) });
  });

  return true;
});
