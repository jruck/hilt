import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { chromium, type Page } from "playwright";

const HOST = "127.0.0.1";
const FIXTURE_CALENDAR_PATH = "/calendar/event/fixture-date/2026-05-29";
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
        HILT_CALENDAR_SYNC_PAST_DAYS: "120",
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

      if (process.env.HILT_CALENDAR_E2E_ATTENDEES_ONLY === "1") {
        await verifyAttendeeRoster(page, baseUrl);
      } else {
        await verifyCalendarFlow(page, baseUrl);
        for (const viewport of VIEWPORTS) {
          await verifyViewport(page, baseUrl, viewport.width, viewport.height);
        }
      }

      const actionableConsoleErrors = process.env.HILT_CALENDAR_E2E_ATTENDEES_ONLY === "1"
        ? consoleErrors.filter((message) => (
            !message.includes("Connection closed before receiving a handshake response")
            && !message.includes("net::ERR_NAME_NOT_RESOLVED")
          ))
        : consoleErrors;
      assert.deepEqual(actionableConsoleErrors, []);
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
  await page.goto(`${baseUrl}${FIXTURE_CALENDAR_PATH}`, { waitUntil: "networkidle" });
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
      if (await isViewingToday(page)) await verifyCurrentTimeIndicator(page, mode);
      await verifyWeatherHeader(page);
    }
    if (mode === "week") {
      await verifyAvailabilityHints(page);
      await verifyOverlappingEventsUseSeparateLanes(page);
    }
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
  await eventPopover.getByTestId("calendar-attendees-toggle").click();
  await eventPopover.getByTestId("calendar-attendee-list").getByText("Alex Example").waitFor();
  await eventPopover.getByTestId("calendar-attendee-list").getByText("Accepted").waitFor();
  assert.equal((await eventPopover.textContent())?.includes("Read-only"), false);

  await page.getByTestId("calendar-actions-menu").filter({ visible: true }).click();
  await page.getByTestId("calendar-source-toggle-us-holidays").waitFor();
  const evercommerceToggle = page.getByTestId("calendar-source-toggle-evercommerce");
  await evercommerceToggle.click();
  await expectHidden(page, "Platform standup");
  await evercommerceToggle.click();
  await page.getByText("Platform standup").first().waitFor();

  const syncResponse = page.waitForResponse((response) => response.url().includes("/api/calendar/sync") && response.request().method() === "POST");
  await page.getByTestId("calendar-sync-button").click();
  assert.equal((await syncResponse).ok(), true);
}

async function verifyAttendeeRoster(page: Page, baseUrl: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseUrl}${FIXTURE_CALENDAR_PATH}`, { waitUntil: "networkidle" });
  await page.getByText("Client review").first().waitFor({ timeout: 20_000 });
  await page.getByText("Client review").first().click();
  const eventPopover = page.getByTestId("calendar-event-popover");
  await eventPopover.getByTestId("calendar-attendees-toggle").click();
  await eventPopover.getByTestId("calendar-attendee-list").getByText("Alex Example").waitFor();
  await eventPopover.getByTestId("calendar-attendee-list").getByText("Accepted").waitFor();
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

async function verifyOverlappingEventsUseSeparateLanes(page: Page) {
  await page.getByText("Overlap Alpha").first().waitFor({ timeout: 20_000 });
  const events = await page.evaluate(() => {
    const titles = ["Overlap Alpha", "Overlap Beta", "Overlap Gamma"];
    return titles.map((title) => {
      const element = Array.from(document.querySelectorAll(".sx__time-grid-event"))
        .find((node) => node.textContent?.includes(title));
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        title,
        className: element.className,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  });

  assert.equal(events.every(Boolean), true, "overlap fixture events should render");
  const renderedEvents = events.filter((event): event is NonNullable<typeof event> => Boolean(event));
  assert.equal(renderedEvents.every((event) => event.className.includes("is-event-overlap")), true, "overlap events should use Schedule-X non-overlap lane mode");

  for (let i = 0; i < renderedEvents.length; i++) {
    for (let j = i + 1; j < renderedEvents.length; j++) {
      const a = renderedEvents[i];
      const b = renderedEvents[j];
      const verticallyOverlap = a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const horizontallyOverlap = a.left < b.right - 1 && b.left < a.right - 1;
      assert.equal(!verticallyOverlap || !horizontallyOverlap, true, `${a.title} and ${b.title} should not visually overlap`);
    }
  }
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

async function isViewingToday(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector(".sx__week-grid__date--is-today") instanceof HTMLElement);
}

async function verifyActiveDayHighlight(page: Page, mode: string) {
  const result = await page.waitForFunction((activeMode) => {
    if (activeMode === "day") {
      const selectedColumn = document.querySelector(".sx__time-grid-day.is-selected");
      const dateMarker = document.querySelector(".sx__week-grid__date--is-today .sx__week-grid__date-number");
      if (!(dateMarker instanceof HTMLElement)) {
        return selectedColumn instanceof HTMLElement && selectedColumn.offsetHeight > 0;
      }
      const columnBg = selectedColumn instanceof HTMLElement ? getComputedStyle(selectedColumn).backgroundColor : "transparent";
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
  await page.goto(`${baseUrl}${FIXTURE_CALENDAR_PATH}`, { waitUntil: "networkidle" });
  await page.getByTestId("calendar-view").waitFor();
  await page.getByTestId("schedule-x-calendar").waitFor();
  await page.getByText("Platform standup").first().waitFor({ timeout: 20_000 });

  const isMobile = width <= 640;
  const metrics = await page.evaluate((mobileViewport) => {
    const frameRect = document.querySelector('[data-testid="calendar-frame"]')?.getBoundingClientRect();
    const navRect = document.querySelector("[data-mobile-chrome-bottom] nav")?.getBoundingClientRect();
    const periodNavigation = document.querySelector('[data-testid="calendar-period-navigation"]');
    const titleRect = document.querySelector('[data-testid="calendar-title"]')?.getBoundingClientRect();
    const periodNavRect = periodNavigation?.getBoundingClientRect();
    const periodNavigationState = periodNavigation?.getAttribute("data-period-position") ?? null;
    const pressedPeriodButtons = Array.from(document.querySelectorAll('[data-testid^="calendar-period-"]'))
      .filter((element) => element.getAttribute("aria-pressed") === "true")
      .map((element) => element.getAttribute("data-period-position"));
    const timeGridLefts = Array.from(document.querySelectorAll(".sx__time-grid-day")).map((element) => element.getBoundingClientRect().left);
    const headerDividerMetrics = Array.from(document.querySelectorAll(".sx__week-grid__date")).map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        aligned: timeGridLefts[index] == null || Math.abs(rect.left - timeGridLefts[index]) <= 1,
        visible: parseFloat(getComputedStyle(element).borderLeftWidth) >= 1,
      };
    });
    const allDayDividerMetrics = Array.from(document.querySelectorAll(".sx__date-grid-day")).map((element, index) => {
      const rect = element.getBoundingClientRect();
      const beforeStyle = getComputedStyle(element, "::before");
      return {
        aligned: timeGridLefts[index] == null || Math.abs(rect.left - timeGridLefts[index]) <= 1,
        visible: parseFloat(beforeStyle.width) >= 1 && beforeStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
      };
    });
    const headerMetrics = Array.from(document.querySelectorAll(".hilt-week-grid-date-header")).map((header) => {
      const headerRect = header.getBoundingClientRect();
      const cellRect = header.closest(".sx__week-grid__date")?.getBoundingClientRect();
      const headerStyle = getComputedStyle(header);
      const cellStyle = cellRect ? getComputedStyle(header.closest(".sx__week-grid__date") as Element) : null;
      const horizontalInset = parseFloat(headerStyle.paddingLeft);
      const verticalInset = cellStyle ? parseFloat(cellStyle.paddingTop) : horizontalInset;
      const dayRect = header.querySelector(".sx__week-grid__day-name")?.getBoundingClientRect();
      const dateRect = header.querySelector(".sx__week-grid__date-number")?.getBoundingClientRect();
      const weatherRect = header.querySelector('[data-testid^="calendar-weather-"]')?.getBoundingClientRect();
      return {
        headerFillsColumn: !cellRect || headerRect.width >= cellRect.width - 1,
        dateLeftAligned: !dateRect || Math.abs(dateRect.left - (headerRect.left + horizontalInset)) <= 1,
        dayLeftAligned: !dayRect || Math.abs(dayRect.left - (headerRect.left + horizontalInset)) <= 1,
        weatherRightAligned: !weatherRect || Math.abs(weatherRect.right - (headerRect.right - horizontalInset)) <= 1,
        balancedInset: Number.isFinite(horizontalInset)
          && Number.isFinite(verticalInset)
          && Math.abs(horizontalInset - verticalInset) <= 1,
      };
    });
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
      periodNavigationNextToTitle: !titleRect || !periodNavRect ? false : (
        periodNavRect.left >= titleRect.right
        && periodNavRect.left - titleRect.right <= 12
        && Math.abs(periodNavRect.top - titleRect.top) <= 12
      ),
      periodNavigationActiveMatchesState: periodNavigationState !== null
        && pressedPeriodButtons.length === 1
        && pressedPeriodButtons[0] === periodNavigationState,
      periodNavigationSegmented: periodNavigation ? getComputedStyle(periodNavigation).backgroundColor !== "rgba(0, 0, 0, 0)" : false,
      headerFillsColumn: headerMetrics.every((item) => item.headerFillsColumn),
      dateLeftAligned: headerMetrics.every((item) => item.dateLeftAligned),
      dayLeftAligned: headerMetrics.every((item) => item.dayLeftAligned),
      weatherRightAligned: headerMetrics.every((item) => item.weatherRightAligned),
      balancedInset: headerMetrics.every((item) => item.balancedInset),
      headerDividersVisible: headerDividerMetrics.length > 0 && headerDividerMetrics.every((item) => item.visible && item.aligned),
      allDayDividersVisible: allDayDividerMetrics.length > 0 && allDayDividerMetrics.every((item) => item.visible && item.aligned),
      frameClearsMobileNav: !mobileViewport || !frameRect || !navRect ? true : frameRect.bottom <= navRect.top - 6,
    };
  }, isMobile);
  assert.ok(metrics.calendarRect, `calendar missing at ${width}x${height}`);
  assert.ok(metrics.toolbarRect, `toolbar missing at ${width}x${height}`);
  assert.ok(metrics.horizontalOverflow <= 4, `horizontal overflow at ${width}x${height}: ${metrics.horizontalOverflow}`);
  assert.equal(metrics.periodNavigationNextToTitle, true, `period navigation should sit directly beside the date title at ${width}x${height}`);
  assert.equal(metrics.periodNavigationActiveMatchesState, true, `period navigation should highlight exactly one temporal state at ${width}x${height}`);
  assert.equal(metrics.periodNavigationSegmented, true, `period navigation should use segmented styling at ${width}x${height}`);
  assert.equal(metrics.headerFillsColumn, true, `date header should fill the day column at ${width}x${height}`);
  assert.equal(metrics.dayLeftAligned, true, `day label should align with the date at ${width}x${height}`);
  assert.equal(metrics.dateLeftAligned, true, `date should align left in its header at ${width}x${height}`);
  assert.equal(metrics.weatherRightAligned, true, `weather should align right in its header at ${width}x${height}`);
  assert.equal(metrics.balancedInset, true, `date header horizontal inset should match vertical inset at ${width}x${height}`);
  assert.equal(metrics.headerDividersVisible, true, `date header dividers should align with time-grid columns at ${width}x${height}`);
  assert.equal(metrics.allDayDividersVisible, true, `all-day dividers should align with time-grid columns at ${width}x${height}`);

  if (isMobile) {
    assert.equal(metrics.activeMode, "day", `mobile should open in day mode at ${width}x${height}`);
    assert.equal(metrics.renderedDateHeaders, 1, `mobile day mode should render one date column at ${width}x${height}`);
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
