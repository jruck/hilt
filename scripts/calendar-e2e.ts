import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { chromium, type Page } from "playwright";

const HOST = "127.0.0.1";
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-calendar-e2e-"));
  let server: ChildProcessWithoutNullStreams | null = null;
  let logs = "";

  try {
    server = spawn("npx", ["next", "start", "-H", HOST, "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST,
        PORT: String(port),
        DATA_DIR: dataDir,
        HILT_CALENDAR_FIXTURE_MODE: "1",
        HILT_WEATHER_FIXTURE_MODE: "1",
        HILT_CALENDAR_SYNC_PAST_DAYS: "30",
        HILT_CALENDAR_SYNC_FUTURE_DAYS: "90",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });

    server.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    server.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });

    await waitForServer(baseUrl, () => logs, server);
    await syncFixtures(baseUrl);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await verifyCalendarFlow(page, baseUrl);
      for (const viewport of VIEWPORTS) {
        await verifyViewport(page, baseUrl, viewport.width, viewport.height);
      }

      assert.deepEqual(consoleErrors, []);
    } finally {
      await browser.close();
    }
  } finally {
    if (server) await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function verifyCalendarFlow(page: Page, baseUrl: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}/calendar`, { waitUntil: "networkidle" });
  await page.getByTestId("calendar-view").waitFor();
  await page.getByText("Platform standup").first().waitFor({ timeout: 20_000 });
  await page.getByText("Memorial Day").first().waitFor({ timeout: 20_000 });
  await page.getByText("9:30 AM").first().waitFor();

  for (const mode of ["day", "week", "month", "agenda"]) {
    await page.getByTestId(`calendar-mode-${mode}`).filter({ visible: true }).click();
    await page.getByTestId("schedule-x-calendar").waitFor();
    await verifyActiveDayHighlight(page, mode);
    if (mode === "day" || mode === "week") {
      await verifyHourlyTimeAxis(page, mode);
      await verifyCurrentTimeIndicator(page, mode);
      await verifyWeatherHeader(page);
    }
    if (mode === "week") await verifyAvailabilityHints(page);
    if (mode === "week" || mode === "month" || mode === "agenda") {
      await verifySundayFirstCalendar(page, mode);
    }
  }

  await page.getByTestId("calendar-mode-week").filter({ visible: true }).click();
  await page.getByText("Platform standup").first().click();
  await page.getByTestId("calendar-event-popover").waitFor();
  await page.getByTestId("calendar-event-recurring").waitFor();
  await page.getByLabel("Close event details").click();

  await page.getByText("Client review").first().click();
  const eventPopover = page.getByTestId("calendar-event-popover");
  await eventPopover.waitFor();
  await page.getByText("Meet").first().waitFor();
  assert.equal((await eventPopover.textContent())?.includes("Read-only"), false);

  await page.getByTestId("calendar-source-menu").filter({ visible: true }).click();
  await page.getByTestId("calendar-source-toggle-us-holidays").waitFor();
  const evercommerceToggle = page.getByTestId("calendar-source-toggle-evercommerce");
  await evercommerceToggle.click();
  await expectHidden(page, "Platform standup");
  await evercommerceToggle.click();
  await page.getByText("Platform standup").first().waitFor();

  const syncResponse = page.waitForResponse((response) => response.url().includes("/api/calendar/sync") && response.request().method() === "POST");
  await page.getByTestId("calendar-actions-menu").filter({ visible: true }).click();
  await page.getByTestId("calendar-sync-button").click();
  assert.equal((await syncResponse).ok(), true);
}

async function verifySundayFirstCalendar(page: Page, mode: string) {
  await page.waitForFunction((activeMode) => {
    if (activeMode === "week") return document.querySelectorAll(".sx__week-grid__day-name").length >= 7;
    if (activeMode === "month") return document.querySelectorAll(".sx__month-grid-day__header-day-name").length >= 7;
    return document.querySelectorAll(".sx__month-agenda-day-name").length >= 7;
  }, mode);

  const dayOrder = await page.evaluate((activeMode) => {
    if (activeMode === "week") {
      return Array.from(document.querySelectorAll(".sx__week-grid__day-name"))
        .map((element) => element.textContent?.trim().slice(0, 3).toUpperCase() || "")
        .slice(0, 7);
    }
    if (activeMode === "month") {
      return Array.from(document.querySelectorAll(".sx__month-grid-day__header-day-name"))
        .map((element) => element.textContent?.trim().slice(0, 3).toUpperCase() || "")
        .slice(0, 7);
    }
    return Array.from(document.querySelectorAll(".sx__month-agenda-day-name"))
      .map((element) => element.textContent?.trim().slice(0, 1).toUpperCase() || "")
      .slice(0, 7);
  }, mode);

  const expected = mode === "agenda"
    ? ["S", "M", "T", "W", "T", "F", "S"]
    : ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  assert.deepEqual(dayOrder, expected, `${mode} should start on Sunday`);
}

async function verifyHourlyTimeAxis(page: Page, mode: string) {
  const expected = ["12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM", "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM"];
  const labelsHandle = await page.waitForFunction((expectedLabels) => {
    const labels = Array.from(document.querySelectorAll('[data-testid="calendar-time-axis-hour"]'))
      .map((element) => element.textContent?.trim() || "")
      .filter(Boolean);
    return labels.length >= expectedLabels.length && expectedLabels.every((label, index) => labels[index] === label)
      ? labels
      : false;
  }, expected);
  const labels = await labelsHandle.jsonValue() as string[];

  assert.deepEqual(labels.slice(0, expected.length), expected, `${mode} time axis should label each whole hour`);
  assert.equal(new Set(labels).size, labels.length, `${mode} time axis should not repeat hour labels`);
  assert.equal(labels.some((label) => label.includes(":")), false, `${mode} time axis should not label half-hours`);

  await page.waitForFunction(() => {
    const view = document.querySelector(".sx__view-container");
    const grid = document.querySelector(".sx__week-grid");
    if (!(view instanceof HTMLElement) || !(grid instanceof HTMLElement)) return false;
    const target = (grid.offsetHeight * 8) / 24;
    return view.scrollHeight > view.clientHeight + 200 && Math.abs(view.scrollTop - target) < 180;
  });
}

async function verifyAvailabilityHints(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll(".sx__time-grid-background-event").length === 1);
  await page.getByText("Unblocked advisory").first().waitFor();
  await page.getByText("After-hours advisory").first().waitFor();
  await page.getByText("Holiday advisory").first().waitFor();
  const warningCount = await page.locator(".hilt-calendar-event-unblocked").count();
  assert.equal(warningCount, 1, "only unblocked non-EverCommerce events during 9-5 Eastern workdays should be marked");
  const warningText = await page.locator(".hilt-calendar-event-unblocked").first().textContent();
  assert.equal(warningText?.includes("Unblocked advisory"), true);
  assert.equal(warningText?.includes("After-hours advisory"), false);
  assert.equal(warningText?.includes("Holiday advisory"), false);
}

async function verifyCurrentTimeIndicator(page: Page, mode: string) {
  await page.waitForFunction(() => {
    const indicator = document.querySelector(".sx__current-time-indicator");
    return indicator instanceof HTMLElement && indicator.offsetHeight > 0;
  });
  if (mode === "week") {
    await page.waitForFunction(() => {
      const indicator = document.querySelector(".sx__current-time-indicator-full-week");
      return indicator instanceof HTMLElement && indicator.offsetHeight > 0;
    });
  }
}

async function verifyActiveDayHighlight(page: Page, mode: string) {
  const result = await page.waitForFunction((activeMode) => {
    if (activeMode === "day") {
      const column = document.querySelector(".sx__time-grid-day.is-selected");
      const dateMarker = document.querySelector(".sx__week-grid__date--is-today .sx__week-grid__date-number");
      if (!(dateMarker instanceof HTMLElement)) return false;
      const columnBg = column instanceof HTMLElement ? getComputedStyle(column).backgroundColor : "transparent";
      const markerBg = getComputedStyle(dateMarker).backgroundColor;
      return (columnBg === "rgba(0, 0, 0, 0)" || columnBg === "transparent")
        && markerBg !== "rgba(0, 0, 0, 0)"
        && markerBg !== "transparent";
    }
    if (activeMode === "week") {
      const day = document.querySelector(".sx__time-grid-day.is-selected");
      if (!(day instanceof HTMLElement)) return false;
      const dayBg = getComputedStyle(day).backgroundColor;
      return dayBg !== "rgba(0, 0, 0, 0)" && dayBg !== "transparent";
    }
    if (activeMode === "month") {
      const day = document.querySelector(".sx__month-grid-day.is-selected");
      if (!(day instanceof HTMLElement)) return false;
      const dayBg = getComputedStyle(day).backgroundColor;
      return dayBg !== "rgba(0, 0, 0, 0)" && dayBg !== "transparent";
    }
    const active = document.querySelector(".sx__month-agenda-day--active");
    if (!(active instanceof HTMLElement)) return false;
    const style = getComputedStyle(active);
    return (style.boxShadow.includes("245, 158, 11") || style.boxShadow.includes("rgb(245 158 11"))
      && style.backgroundColor !== "rgba(0, 0, 0, 0)"
      && style.backgroundColor !== "transparent";
  }, mode);

  assert.equal(await result.jsonValue(), true, `${mode} should highlight the active day`);
}

async function verifyWeatherHeader(page: Page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="calendar-weather-"]').length >= 1);
  const weatherLink = page.locator('[data-testid^="calendar-weather-"]').first();
  const text = await weatherLink.textContent();
  const href = await weatherLink.getAttribute("href");

  assert.match(text ?? "", /\d+°\/\d+°/);
  assert.equal(href?.startsWith("https://forecast.weather.gov/MapClick.php"), true);
}

async function verifyViewport(page: Page, baseUrl: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${baseUrl}/calendar`, { waitUntil: "networkidle" });
  await page.getByTestId("calendar-view").waitFor();
  await page.getByTestId("schedule-x-calendar").waitFor();
  await page.getByText("Platform standup").first().waitFor({ timeout: 20_000 });

  const isMobile = width <= 640;
  const metrics = await page.evaluate((mobileViewport) => {
    const frameRect = document.querySelector('[data-testid="calendar-frame"]')?.getBoundingClientRect();
    const navRect = document.querySelector("[data-mobile-chrome-bottom] nav")?.getBoundingClientRect();
    const dateRect = document.querySelector(".hilt-week-grid-date-row .sx__week-grid__date-number")?.getBoundingClientRect();
    const weatherRect = document.querySelector('[data-testid^="calendar-weather-"]')?.getBoundingClientRect();
    const activeMode = Array.from(document.querySelectorAll('[data-testid^="calendar-mode-"]'))
      .find((element) => element.getAttribute("aria-pressed") === "true")
      ?.getAttribute("data-testid")
      ?.replace("calendar-mode-", "");
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      activeMode,
      renderedDateHeaders: document.querySelectorAll(".sx__week-grid__date").length,
      calendarRect: document.querySelector('[data-testid="schedule-x-calendar"]')?.getBoundingClientRect().toJSON(),
      frameRect: frameRect?.toJSON(),
      navRect: navRect?.toJSON(),
      toolbarRect: Array.from(document.querySelectorAll('[data-testid="calendar-mode-control"]'))
        .map((element) => element.getBoundingClientRect())
        .find((rect) => rect.width > 0 && rect.height > 0)
        ?.toJSON(),
      weatherBelowDate: !mobileViewport || !dateRect || !weatherRect ? true : weatherRect.top >= dateRect.bottom - 1,
      frameClearsMobileNav: !mobileViewport || !frameRect || !navRect ? true : frameRect.bottom <= navRect.top - 6,
    };
  }, isMobile);
  assert.ok(metrics.calendarRect, `calendar missing at ${width}x${height}`);
  assert.ok(metrics.toolbarRect, `toolbar missing at ${width}x${height}`);
  assert.ok(metrics.horizontalOverflow <= 4, `horizontal overflow at ${width}x${height}: ${metrics.horizontalOverflow}`);

  if (isMobile) {
    assert.equal(metrics.activeMode, "day", `mobile should open in day mode at ${width}x${height}`);
    assert.equal(metrics.renderedDateHeaders, 1, `mobile day mode should render one date column at ${width}x${height}`);
    assert.equal(metrics.weatherBelowDate, true, `mobile weather should sit below the date at ${width}x${height}`);
    assert.equal(metrics.frameClearsMobileNav, true, `calendar frame should clear the mobile nav at ${width}x${height}`);

    const titleBeforeWheel = await page.getByTestId("calendar-title").textContent();
    await page.getByTestId("calendar-frame").hover({ position: { x: Math.min(180, width - 80), y: 220 } });
    await page.mouse.wheel(180, 0);
    await page.waitForFunction((previousTitle) => (
      document.querySelector('[data-testid="calendar-title"]')?.textContent !== previousTitle
    ), titleBeforeWheel);
    assert.notEqual(await page.getByTestId("calendar-title").textContent(), titleBeforeWheel, "horizontal wheel should advance the current calendar period");

    await page.getByTestId("calendar-mode-day").filter({ visible: true }).click();
    assert.equal(await activeCalendarMode(page), "day", "day button should keep the day view selected");

    await page.getByTestId("calendar-mode-week").filter({ visible: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".sx__week-grid__date").length >= 7);
    assert.equal(await activeCalendarMode(page), "week", "week button should select the week view");
  }
}

async function activeCalendarMode(page: Page): Promise<string | null> {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="calendar-mode-"]'))
    .find((element) => element.getAttribute("aria-pressed") === "true")
    ?.getAttribute("data-testid")
    ?.replace("calendar-mode-", "") ?? null);
}

async function expectHidden(page: Page, text: string) {
  await page.waitForFunction((value) => {
    const nodes = Array.from(document.querySelectorAll("body *"));
    return !nodes.some((node) => node.textContent?.includes(value) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  }, text);
}

async function syncFixtures(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/calendar/sync`, { method: "POST" });
  assert.equal(response.ok, true);
}

async function waitForServer(baseUrl: string, logs: () => string, server: ChildProcessWithoutNullStreams) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`Dev server exited early.\n${logs()}`);
    try {
      const response = await fetch(`${baseUrl}/api/calendar/setup/status`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for dev server.\n${logs()}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    sleep(5000).then(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }),
  ]);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
