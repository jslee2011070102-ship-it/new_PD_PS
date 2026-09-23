/* Start the Python dashboard before running this optional browser regression test. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const base = process.env.DASHBOARD_URL || "http://127.0.0.1:3000";
    await page.goto(base);
    await page.waitForSelector(".stats-grid");
    assert.equal(await page.locator(".stat-card").count(), 4);
    await page.selectOption("#role-category", "캡슐세제");
    assert.match(await page.locator("#role-chart").innerText(), /25/);

    await page.locator('[data-page="market"]').click();
    await page.waitForSelector("#product-search");
    assert.match(await page.locator("#result-count").innerText(), /150/);
    await page.locator('[data-category="캡슐세제"]').click();
    assert.match(await page.locator("#result-count").innerText(), /25/);
    await page.locator("#product-search").fill("맘스럽");
    assert.ok((await page.locator("tr[data-product]").count()) > 0);
    await page.locator("tr[data-product]").first().click();
    assert.match(await page.locator(".detail-title").innerText(), /맘스럽/);
    await page.keyboard.press("Escape");
    await page.locator("#product-search").fill("존재하지않는상품");
    assert.match(
      await page.locator("#market-results").innerText(),
      /검색 조건에 맞는 제품이 없습니다/,
    );
    await page.locator('[data-action="reset-filters"]').click();
    await page.selectOption("#validation-filter", "표기없음");
    assert.equal(await page.locator("tr[data-product]").count(), 5);
    await page.selectOption("#validation-filter", "");
    await page.selectOption("#basis-filter", "100g당");
    assert.equal(await page.locator("tr[data-product]").count(), 1);
    await page.selectOption("#basis-filter", "");
    await page.getByRole("button", { name: "2페이지", exact: true }).click();
    assert.match(await page.locator(".table-foot").innerText(), /13–24/);
    await page.selectOption("#sort-filter", "price");
    const values = (
      await page.locator("tr[data-product] td:nth-child(3)").allTextContents()
    ).map((s) => Number(s.replace(/[^\d]/g, "")));
    assert.deepEqual(
      values,
      [...values].sort((a, b) => a - b),
    );

    await page.locator('[data-page="specs"]').click();
    await page.waitForSelector(".spec-card");
    assert.equal(await page.locator(".spec-card").count(), 12);
    await page.locator('[data-spec-category="세탁세제"]').click();
    assert.equal(await page.locator(".spec-card").count(), 2);
    await page.locator(".spec-card [data-spec]").first().click();
    await page.locator("#simulation-price").fill("14000");
    await page.locator("#simulation-form button").click();
    await page.waitForSelector(".simulation-result");
    assert.match(
      await page.locator(".simulation-result").innerText(),
      /4,000원/,
    );
    await page.keyboard.press("Escape");

    await page.locator('[data-page="data"]').click();
    await page.locator('[data-action="upload"]').first().click();
    await page.locator('dialog [data-action="json-upload"]').click();
    await page
      .locator("#upload-file")
      .setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from('[{"brand":"missing"}]'),
      });
    await page.waitForSelector(".form-error");
    assert.equal(await page.locator("#apply-import").isDisabled(), true);
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../data/extracted/세탁세제.json"),
        "utf8",
      ),
    )[0];
    fixture.product_name = "<img src=x onerror=alert(1)> 테스트제품";
    fixture.product_url = "javascript:alert(1)";
    await page
      .locator("#upload-file")
      .setInputFiles({
        name: "sample.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify([fixture])),
      });
    await page.waitForSelector(".form-success");
    await page.locator("#apply-import").click();
    await page.waitForSelector(".session-banner");
    assert.match(await page.locator(".section-heading").last().innerText(), /126/);
    await page.locator('[data-category-go="세탁세제"]').click();
    await page.waitForSelector("tr[data-product]");
    assert.equal(await page.locator("tr[data-product]").count(), 1);
    assert.equal(await page.locator("tr[data-product] img").count(), 0);
    await page.locator("tr[data-product]").click();
    assert.ok(
      (
        await page.locator('dialog a[target="_blank"]').getAttribute("href")
      ).startsWith("https://www.coupang.com/np/search"),
    );
    await page.keyboard.press("Escape");
    const xlsxEvent = page.waitForEvent("download");
    await page.locator('[data-action="export"]').click();
    const xlsx = await xlsxEvent;
    assert.equal(await xlsx.failure(), null);
    assert.ok(xlsx.suggestedFilename().endsWith(".xlsx"));
    await page.locator('[data-action="reset-data"]').click();
    assert.match(await page.locator("#result-count").innerText(), /150/);
    await page.locator('[data-page="documents"]').click();
    const docEvent = page.waitForEvent("download");
    await page.locator('a[href="/api/document"]').click();
    assert.equal((await docEvent).suggestedFilename(), "product_quote.docx");
    await page.locator('[data-page="usp"]').click();
    assert.match(
      await page.locator(".empty-state").innerText(),
      /아직 수집된 데이터가 없어/,
    );
    await page.locator('[data-action="usp-guide"]').click();
    assert.match(await page.locator("dialog").innerText(), /Ctrl\+P/);
    await page.keyboard.press("Escape");

    // The server must not expose source, Git metadata, or arbitrary filesystem paths.
    for (const url of [
      "/.git/config",
      "/dashboard/server.py",
      "/api/unknown",
    ]) {
      assert.equal((await page.request.get(base + url)).status(), 404);
    }
    assert.equal(
      (
        await page.request.post(base + "/api/import", {
          data: { overrides: { bad: [] } },
        })
      ).status(),
      400,
    );
    assert.equal(
      (
        await page.request.post(base + "/api/simulate", {
          data: { index: 0, price: -1 },
        })
      ).status(),
      400,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await page.locator('[data-action="menu"]').click();
    await page.locator('[data-page="overview"]').click();
    await page.waitForSelector(".stats-grid");
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await page.locator('[data-action="menu"]').click();
    await page.locator('[data-page="market"]').click();
    await page.waitForSelector("#product-search");
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real data, search, filters, pagination, sorting, details, simulation, invalid/valid imports, XSS escaping, restoration, downloads, USP guide, API safety, and mobile navigation/overflow.",
    );
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
