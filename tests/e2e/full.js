// End-to-end test of manager, technician and customer flows against a local server.
const { chromium, devices } = require("playwright");
const path = require("path");
const assert = require("assert");

const BASE = process.env.BASE || "http://localhost:3100";
const DIR = __dirname;
const OUT = process.env.E2E_OUT || __dirname;
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `full-${name}.png`), fullPage: true });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const plus = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const errors = [];
async function noSideScroll(p, name) { const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert.ok(sw <= iw + 1, `${name} scrolls sideways (${sw} > ${iw})`); }
const pages = {};
const log = (...a) => console.log("•", ...a);

async function ok(page) {
  const err = await page.locator(".notice.bad").first().textContent({ timeout: 300 }).catch(() => null);
  if (err) throw new Error(`Page error on ${page.url()}: ${err}`);
}
async function submitForm(page, form, button) {
  await Promise.all([page.waitForLoadState("networkidle"), (button ? form.locator("button", { hasText: button }) : form.locator("button[type=submit]").first()).click()]);
  await page.waitForTimeout(300);
  await ok(page);
}
async function pickOption(select, labelText) {
  const opts = await select.locator("option").evaluateAll((os) => os.map((o) => [o.value, o.textContent.trim()]));
  const hit = opts.find(([, t]) => t === labelText) || opts.find(([v, t]) => v && t.startsWith(labelText));
  if (!hit) throw new Error(`No option ${labelText} in ${JSON.stringify(opts)}`);
  const value = hit[0];
  await select.selectOption(value);
}

(async () => {
  const browser = await chromium.launch();
  const mgrCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const m = await mgrCtx.newPage();
  pages.m = m;
  m.on("pageerror", (e) => errors.push(`manager: ${e.message}`));

  // Manager sign-in
  await m.goto(`${BASE}/`);
  await m.click('.role-card[href="/manager"]');
  await m.fill('input[name="passcode"]', "wrong");
  await m.click("button:has-text('Sign in')");
  await m.waitForSelector(".error, .notice.bad");
  await m.fill('input[name="passcode"]', "boss-pass");
  await m.click("button:has-text('Sign in')");
  await m.waitForSelector(".mgr-nav");
  log("manager signed in");

  // Marina, gates, docks
  await m.goto(`${BASE}/manager/marinas`);
  await m.fill('form input[name="name"]', "Clipper Yacht Harbor");
  await submitForm(m, m.locator("form", { has: m.locator('input[name="address"]') }), "Add marina");
  await m.waitForSelector("text=New gate");
  const gateForm = m.locator("form", { has: m.locator("button:has-text('Add gate')") });
  await gateForm.locator('input[name="name"]').fill("Gate 3");
  await gateForm.locator('input[name="code"]').fill("4417");
  await submitForm(m, gateForm, "Add gate");
  for (const d of ["C", "D"]) {
    const dockForm = m.locator("form", { has: m.locator("button:has-text('Add dock')") });
    await dockForm.locator('input[name="name"]').fill(d);
    await pickOption(dockForm.locator('select[name="gate_id"]'), "Gate 3");
    await submitForm(m, dockForm, "Add dock");
  }
  log("marina, gate and docks created");

  // Crews and technicians
  await m.goto(`${BASE}/manager/crews`);
  for (const c of ["Crew A", "Crew B"]) {
    const f = m.locator("form", { has: m.locator("button:has-text('Add crew')") });
    await f.locator('input[name="name"]').fill(c);
    await submitForm(m, f, "Add crew");
  }
  for (const [t, c] of [["Maria", "Crew A"], ["Jon", "Crew B"]]) {
    const f = m.locator("form", { has: m.locator("button:has-text('Add technician')") });
    await f.locator('input[name="name"]').fill(t);
    await pickOption(f.locator('select[name="crew_id"]'), c);
    await submitForm(m, f, "Add technician");
  }
  log("crews and technicians created");

  // Customers with a plan starting today, both on Crew B
  async function newCustomer(name, phone, boat, slip, dock) {
    await m.goto(`${BASE}/manager/customers/new`);
    await m.fill('input[name="name"]', name);
    await m.fill('input[name="phone"]', phone);
    await m.fill('input[name="boat_name"]', boat);
    await pickOption(m.locator('select[name="marina_id"]'), "Clipper");
    await pickOption(m.locator('select[name="dock_id"]'), dock);
    await m.fill('input[name="slip"]', slip);
    await pickOption(m.locator('select[name="service_id"]'), "Exterior wash");
    await pickOption(m.locator('select[name="crew_id"]'), "Crew B");
    await m.fill('input[name="first_date"]', today);
    await m.locator('select[name="interval_weeks"]').selectOption("2");
    await submitForm(m, m.locator("form", { has: m.locator('input[name="boat_name"]') }), "Save customer");
    assert.match(m.url(), /\/manager\/customers\/[0-9a-f-]{36}/, "lands on customer page");
  }
  await newCustomer("Dana Whitfield", "415-555-0111", "Sea Breeze", "C-14", "C");
  const danaUrl = m.url();
  const portalHref = await m.locator('a[href^="/portal/"]').first().getAttribute("href");
  assert.ok(portalHref, "customer page links to the portal");
  await newCustomer("Luis Ortega", "415-555-0122", "Marlin", "D-3", "D");
  // Missing slip must be refused
  await m.goto(`${BASE}/manager/customers/new`);
  await m.fill('input[name="name"]', "No Slip");
  await m.fill('input[name="boat_name"]', "Nowhere");
  await pickOption(m.locator('select[name="marina_id"]'), "Clipper");
  await m.locator("button:has-text('Save customer')").click();
  await m.waitForSelector(".notice.bad");
  log("customers created; missing slip refused");

  // Schedule: both boats today on Crew B. Assign them to Crew A with the bulk bar.
  await m.goto(`${BASE}/manager/schedule?date=${today}`);
  assert.ok(await m.locator("text=Sea Breeze").count(), "Sea Breeze scheduled today");
  for (const b of ["Sea Breeze", "Marlin"]) await m.check(`input[aria-label="Select ${b}"]`);
  await pickOption(m.locator('select[name="bulk_crew_id"]'), "Crew A");
  await Promise.all([m.waitForLoadState("networkidle"), m.click("button[value=assign]")]);
  await ok(m);
  await shot(m, "01-schedule");
  const crewAGroup = await m.locator(".crew-group", { hasText: "Crew A" }).textContent();
  assert.ok(crewAGroup.includes("Sea Breeze") && crewAGroup.includes("Marlin"), "both jobs under Crew A");
  log("bulk-assigned both jobs to Crew A");

  // Next visit in 2 weeks exists; move it with "this visit only" to Crew B, then back.
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 14)}`);
  assert.ok(await m.locator("text=Sea Breeze").count(), "recurring visit generated 2 weeks out");
  await m.click(".job-line a:has-text('Sea Breeze'), .week-job a:has-text('Sea Breeze')");
  await m.waitForSelector("text=Save visit");
  await pickOption(m.locator('select[name="crew_id"]'), "Crew B");
  await submitForm(m, m.locator("form", { has: m.locator("button:has-text('Save visit')") }), "Save visit");
  log("single visit reassigned on the job page");

  // Technician (phone)
  const techCtx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  const t = await techCtx.newPage();
  pages.t = t;
  t.on("pageerror", (e) => errors.push(`tech: ${e.message}`));
  await t.goto(`${BASE}/`);
  await t.click('.role-card[href="/crew"]');
  await t.waitForSelector("text=Technician sign-in");
  await t.waitForSelector('select option:has-text("Maria")', { state: "attached" });
  await pickOption(t.locator("select"), "Maria");
  await t.fill('input[type="password"]', "crispclean");
  await t.click("button:has-text('Sign in')");
  await t.waitForSelector(".crew-card");
  assert.equal(await t.locator(".crew-card").count(), 2, "Maria sees two jobs today");
  await shot(t, "02-crew-list");
  log("technician signed in and sees 2 jobs");

  async function photo(trigger, file) {
    const [chooser] = await Promise.all([t.waitForEvent("filechooser"), trigger()]);
    await chooser.setFiles(path.join(DIR, file));
    await t.waitForTimeout(500);
  }

  // Job 1: before photos for all 4 slots, start, after photos, finish
  await t.click(".crew-card:has-text('Sea Breeze')");
  await t.waitForSelector("text=Gate code");
  assert.ok((await t.textContent("body")).includes("4417"), "gate code shown");
  for (const slot of ["Bow", "Stern", "Cockpit", "Port side"]) {
    await photo(() => t.click(`[data-slot="before-${slot}"]`), slot === "Bow" || slot === "Cockpit" ? "before1.jpg" : "before2.jpg");
  }
  await t.waitForSelector("button:has-text('Start job'):not([disabled])");
  await t.click("button:has-text('Start job')");
  await t.waitForSelector("text=After photos");
  for (const slot of ["Bow", "Stern"]) {
    await t.click(`[data-slot="after-${slot}"]`);
    await t.waitForSelector(".guide");
    await photo(() => t.click(".guide button:has-text('Open camera')"), slot === "Bow" ? "after1.jpg" : "after2.jpg");
  }
  await shot(t, "03-crew-job");
  await noSideScroll(t, "crew job");
  // Flag an issue with a photo, visible to the customer
  await t.click("button:has-text('Flag an issue')");
  await photo(() => t.click("button:has-text('Photo of the issue')"), "before2.jpg");
  await t.locator(".option").first().click();
  await t.fill("textarea", "Starboard fender line frayed");
  await t.click("button:has-text('Submit flag')");
  await t.waitForSelector("text=Issue saved");
  await t.click("button:has-text('Finish job')");
  await t.waitForSelector("text=Message for the customer");
  await t.locator(".option").first().click();
  await t.click("button.big-btn:has-text('Finish job')");
  await t.waitForSelector(".done-card");
  const custLink = (await t.textContent(".link-box")).trim();
  assert.match(custLink, /\/j\/[A-Za-z0-9_-]{22}$/);
  await t.waitForSelector(".sync-bar.good", { timeout: 30000 });
  log("job 1 finished, uploads synced:", custLink);

  // Job 2 offline: skip with "Boat not in slip" and a photo, then come back online
  await t.click("button:has-text('Next job')");
  await t.click(".crew-card:has-text('Marlin')");
  await techCtx.setOffline(true);
  await t.click("button:has-text(\"Can't do this job\")");
  await t.click(".option:has-text('Boat not in slip')");
  await photo(() => t.click("button:has-text('Photo of empty slip')"), "before1.jpg");
  await t.click("button:has-text('Skip this job')");
  await t.waitForSelector(".sync-bar.bad");
  await shot(t, "04-crew-offline");
  log("offline skip queued");
  await techCtx.setOffline(false);
  await t.evaluate(() => window.dispatchEvent(new Event("online")));
  await t.click("button:has-text('Sync now')").catch(() => {});
  await t.waitForSelector(".sync-bar.good", { timeout: 30000 });
  log("offline work synced after reconnecting");

  // Customer photo page
  const custCtx = await browser.newContext({ ...devices["iPhone 13"] });
  const c = await custCtx.newPage();
  c.on("pageerror", (e) => errors.push(`customer: ${e.message}`));
  await c.goto(custLink.replace(/^https?:\/\/[^/]+/, BASE));
  await c.waitForSelector("h1:has-text('Sea Breeze')");
  assert.equal(await c.locator(".compare").count(), 2, "two before/after pairs");
  await c.waitForSelector(".share-preview", { timeout: 15000 });
  await shot(c, "05-customer-photos");
  log("customer photo page shows 2 compare pairs and share image");

  // Manager: needs attention + reschedule queue + publish the issue to the portal
  await m.goto(`${BASE}/manager`);
  await shot(m, "06-attention");
  await m.goto(`${BASE}/manager/reschedule`);
  assert.ok(await m.locator("text=Marlin").count(), "skipped job in reschedule queue");
  await m.goto(`${BASE}/manager/issues`);
  const issue = m.locator("form.issue").first();
  await issue.locator('textarea[name="manager_note"]').fill("We noticed a frayed line. We can replace it.");
  await issue.locator('input[name="quote_text"]').fill("$45 including line");
  await issue.locator('select[name="visibility"]').selectOption("portal");
  await issue.locator('select[name="status"]').selectOption("quoted");
  await submitForm(m, issue, "Save");
  log("issue quoted and shown on portal");

  // Customer portal: issue visible, request extra service and a pause
  await c.goto(`${BASE}${portalHref}`);
  await c.waitForSelector("text=Flagged issues");
  assert.ok((await c.textContent("body")).includes("$45 including line"), "quote on portal");
  assert.ok(await c.locator(`a[href="${custLink.replace(/^https?:\/\/[^/]+/, "")}"]`).count(), "history links to photo page");
  await c.check('input[name="service_ids"] >> nth=0');
  await c.fill('input[name="preferred_date"]', plus(today, 3));
  await Promise.all([c.waitForLoadState("networkidle"), c.click("button:has-text('Send request')")]);
  await c.waitForSelector("text=Request sent");
  await c.fill('input[name="until_date"]', plus(today, 30));
  await c.fill('input[name="note"]', "Haul-out");
  await Promise.all([c.waitForLoadState("networkidle"), c.click("button:has-text('Request a pause')")]);
  await c.waitForSelector("text=Pause request sent");
  await shot(c, "07-portal");
  await noSideScroll(c, "portal");
  log("portal requests sent");

  // Manager approves the service request with a crew
  await m.goto(`${BASE}/manager/requests`);
  const svc = m.locator("form", { has: m.locator("button:has-text('Approve and schedule')") }).first();
  await pickOption(svc.locator('select[name="crew_id"]'), "Crew A");
  await submitForm(m, svc, "Approve and schedule");
  const pause = m.locator("form", { has: m.locator("button:has-text('Approve pause')") }).first();
  await submitForm(m, pause, "Approve pause");
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 14)}`);
  const sb = m.locator(".job-line, .week-job", { hasText: "Sea Breeze" });
  assert.ok((await sb.count()) === 0 || /Cancelled/.test(await sb.first().textContent()), "paused boat's visit cancelled");
  log("service request approved, pause approved and future visits cleared");

  // Weather day: move tomorrow-and-later? Use the bulk move on Luis's next visit
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 14)}`);
  if (await m.locator('input[aria-label="Select Marlin"]').count()) {
    await m.check('input[aria-label="Select Marlin"]');
    await m.fill('input[name="bulk_date"]', plus(today, 15));
    await Promise.all([m.waitForLoadState("networkidle"), m.click("button[value=move]")]);
    await ok(m);
    await m.goto(`${BASE}/manager/schedule?date=${plus(today, 15)}`);
    assert.ok(await m.locator("text=Marlin").count(), "Marlin moved a day");
    log("bulk move worked");
  }

  // Public sign-up, then manager activation
  const s = await custCtx.newPage();
  pages.s = s;
  await s.goto(`${BASE}/customer`);
  await s.click("a:has-text('Sign up for cleanings')");
  await s.fill('input[name="name"]', "Priya Nair");
  await s.fill('input[name="phone"]', "(415) 555-0199");
  await s.fill('input[name="boat_name"]', "Wavelength");
  await pickOption(s.locator('select[name="marina_id"]'), "Clipper");
  await s.fill('input[name="slip"]', "C-22");
  // A phone number that is too short is refused by the server, and nothing typed is lost.
  await pickOption(s.locator('select[name="dock_id"]'), "C");
  await s.fill('input[name="phone"]', "555");
  await s.click("button:has-text('Send sign-up')");
  await s.waitForSelector(".notice.bad:has-text('mobile number')");
  assert.equal(await s.inputValue('input[name="boat_name"]'), "Wavelength", "sign-up keeps typed values after an error");
  assert.equal(await s.inputValue('input[name="slip"]'), "C-22");
  await s.fill('input[name="phone"]', "(415) 555-0199");
  await noSideScroll(s, "sign-up");
  await s.check('input[name="sms_consent"]');
  await Promise.all([s.waitForURL(/signup\/thanks/), s.click("button:has-text('Send sign-up')")]);
  await s.click("a:has-text('Open my boat page')");
  await s.waitForSelector("text=reviewing your details");
  log("sign-up created a pending customer");

  await m.goto(`${BASE}/manager/customers?status=pending`);
  await m.click("a:has-text('Priya Nair')");
  const act = m.locator("form", { has: m.locator("button:has-text('Activate and schedule')") });
  await act.locator('input[name="first_date"]').fill(plus(today, 2));
  await pickOption(act.locator('select[name="crew_id"]'), "Crew B");
  await submitForm(m, act, "Activate and schedule");
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 2)}`);
  assert.ok(await m.locator("text=Wavelength").count(), "activated customer scheduled");
  log("manager activated sign-up and visit scheduled");

  // ---------- Messaging ----------
  // Dana never agreed to texts and has no email, so the "photos ready" notice was blocked, with the reason shown.
  await m.goto(`${BASE}/manager/messages?tab=problems`);
  await m.waitForSelector("text=No consent to texts on record");
  assert.ok(await m.locator(".card", { hasText: "Dana Whitfield" }).count(), "blocked notice listed for Dana");
  // Recording consent needs a note of how it was given.
  await m.goto(danaUrl);
  await m.click("summary:has-text('Mailing address, contact preference')");
  const cs = m.locator("form", { has: m.locator("button:has-text('Save contact settings')") });
  await cs.locator('input[name="address1"]').fill("12 Bridgeway");
  await cs.locator('input[name="city"]').fill("Sausalito");
  await cs.locator('input[name="state"]').fill("ca");
  await cs.locator('input[name="postal_code"]').fill("94965");
  await cs.locator('input[name="sms_consent"]').check();
  await Promise.all([m.waitForLoadState("networkidle"), cs.locator("button:has-text('Save contact settings')").click()]);
  await m.waitForSelector(".notice.bad:has-text('Say how the customer gave consent')");
  await m.click("summary:has-text('Mailing address, contact preference')");
  const cs2 = m.locator("form", { has: m.locator("button:has-text('Save contact settings')") });
  await cs2.locator('input[name="address1"]').fill("12 Bridgeway");
  await cs2.locator('input[name="city"]').fill("Sausalito");
  await cs2.locator('input[name="state"]').fill("ca");
  await cs2.locator('input[name="postal_code"]').fill("94965");
  await cs2.locator('input[name="sms_consent"]').check();
  await cs2.locator('input[name="consent_method"]').fill("Signed service agreement, Nov 3");
  await Promise.all([m.waitForLoadState("networkidle"), cs2.locator("button:has-text('Save contact settings')").click()]);
  await m.waitForSelector(".notice.good:has-text('Contact settings saved')");
  // Conversation: the sign-up confirmation went out, then a typed text, then the customer replies.
  await m.click(".page-head a.btn:has-text('Message')");
  await m.waitForSelector(".bubble.out:has-text('signed up for texts')");
  const send = m.locator("form", { has: m.locator("button:has-text('Send')") }).first();
  await send.locator('textarea[name="body"]').fill("Hi Dana, we found your fender line frayed. Want us to replace it?");
  await Promise.all([m.waitForLoadState("networkidle"), send.locator("button:has-text('Send')").click()]);
  await ok(m);
  await m.waitForSelector(".bubble.out:has-text('fender line frayed')");
  assert.ok((await m.textContent(".thread")).includes("test mode, not delivered"), "test mode is labelled");
  const danaId = danaUrl.split("/").pop();
  const inbound = (body, from, secret = "e2e-inbound") =>
    m.evaluate(async ([b, f, s]) => (await fetch("/api/messaging/inbound/test", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s}` }, body: JSON.stringify({ from: f, to: "", body: b, id: "e2e-" + Math.random() }) })).status, [body, from, secret]);
  assert.equal(await inbound("hack", "4155550111", "wrong-secret"), 403, "incoming messages need the provider's secret");
  assert.equal(await inbound("Yes please, go ahead", "4155550111"), 200);
  await m.goto(`${BASE}/manager`);
  assert.match(await m.textContent(".tiles"), /1\s*new message/, "new message shows on Needs attention");
  await m.goto(`${BASE}/manager/messages`);
  await m.click(".thread-row.unread:has-text('Dana Whitfield')");
  await m.waitForSelector(".bubble.in:has-text('Yes please, go ahead')");
  // STOP ends texting at once; the next text is refused.
  assert.equal(await inbound("STOP", "4155550111"), 200);
  await m.reload();
  await m.waitForSelector(".bubble.out:has-text('unsubscribed')");
  const send2 = m.locator("form", { has: m.locator("button:has-text('Send')") }).first();
  await send2.locator('select[name="channel"]').selectOption("sms");
  await send2.locator('textarea[name="body"]').fill("One more thing");
  await Promise.all([m.waitForLoadState("networkidle"), send2.locator("button:has-text('Send')").click()]);
  await m.waitForSelector(".notice.bad:has-text('opted out')");
  log("consent, conversation, incoming reply and STOP all behave");

  // Prospect with email only, then a marketing template sent to prospects through approval.
  await m.goto(`${BASE}/manager/prospects/new`);
  await m.fill('input[name="name"]', "Morgan Reyes");
  await m.fill('input[name="phone"]', "415-555-0177");
  await m.fill('input[name="email"]', "morgan@example.com");
  await m.fill('input[name="source"]', "Boat show");
  await m.fill('input[name="address1"]', "500 Gate 5 Rd");
  await m.fill('input[name="city"]', "Sausalito");
  await m.fill('input[name="state"]', "CA");
  await m.fill('input[name="postal_code"]', "94965");
  await Promise.all([m.waitForLoadState("networkidle"), m.click("button:has-text('Save prospect')")]);
  await ok(m);
  await m.waitForSelector("h2:has-text('Prospect')");
  await m.goto(`${BASE}/manager/customers`);
  assert.equal(await m.locator("a:has-text('Morgan Reyes')").count(), 0, "prospects are kept out of the customer list");
  await m.goto(`${BASE}/manager/customers?status=prospect`);
  assert.equal(await m.locator("a:has-text('Morgan Reyes')").count(), 1);
  await m.goto(`${BASE}/manager/templates`);
  const nt = m.locator("form", { has: m.locator("button:has-text('Create template')") });
  await nt.locator('input[name="name"]').fill("Winter wash offer");
  await nt.locator('select[name="purpose"]').selectOption("marketing");
  await nt.locator('textarea[name="sms_body"]').fill("Winter wash slots are open, {first_name}.");
  await nt.locator('input[name="email_subject"]').fill("Winter wash slots are open");
  await nt.locator('textarea[name="email_body"]').fill("Hi {first_name},\n\nWinter wash slots are open. Reply to book.");
  await Promise.all([m.waitForLoadState("networkidle"), nt.locator("button:has-text('Create template')").click()]);
  await ok(m);
  await m.waitForSelector("text=Reply STOP to opt out");
  await m.locator('select[name="audience"]').selectOption("prospects");
  await Promise.all([m.waitForLoadState("networkidle"), m.click("button:has-text('Prepare for approval')")]);
  await m.waitForSelector(".notice.good:has-text('1 message(s) ready for your approval')");
  // Morgan gave a number but never agreed to texts, so the marketing message goes by email, not text.
  const pending = m.locator("form.msg-approve", { hasText: "Morgan Reyes" });
  assert.match(await pending.textContent(), /Email to morgan@example\.com/);
  assert.equal(await pending.locator('textarea[name="body"]').inputValue(), "Hi Morgan,\n\nWinter wash slots are open. Reply to book.");
  await Promise.all([m.waitForLoadState("networkidle"), m.click("button:has-text('Approve all 1')")]);
  await ok(m);
  await m.goto(`${BASE}/manager/messages`);
  await m.click(".thread-row:has-text('Morgan Reyes')");
  await m.waitForSelector(".bubble.out:has-text('Winter wash slots are open')");
  assert.match(await m.textContent(".thread"), /marketing/);
  log("prospect added; marketing template went through approval and by email only");

  // Exports
  const contacts = await m.evaluate(async () => (await fetch("/api/manager/export?what=contacts")).text());
  assert.match(contacts, /Prospect,prospect,Morgan Reyes,Morgan,415-555-0177,morgan@example\.com,500 Gate 5 Rd,,Sausalito,CA,94965/);
  assert.match(contacts, /Customer,active,Dana Whitfield,Dana,415-555-0111,,12 Bridgeway,,Sausalito,CA,94965,text,yes,[^,]+,no,,yes,/, "Dana: consent yes, then opted out yes");
  const consent = await m.evaluate(async () => (await fetch("/api/manager/export?what=consent")).text());
  assert.match(consent, /Dana Whitfield,\+14155550111,sms,service,granted,"Recorded by manager: Signed service agreement/);
  assert.match(consent, /Dana Whitfield,\+14155550111,sms,all,revoked/);
  const msgs = await m.evaluate(async () => (await fetch("/api/manager/export?what=messages")).text());
  assert.match(msgs, /Yes please, go ahead/);
  const anonExport = await (await browser.newContext()).request.get(`${BASE}/api/manager/export?what=contacts`);
  assert.equal(anonExport.status(), 401, "exports need a manager sign-in");
  log("contact, consent and message exports ok");

  // The sign-up customer ticked the text box: confirmation text recorded, preferences editable on their page.
  await m.goto(`${BASE}/manager/messages`);
  await m.click(".thread-row:has-text('Priya Nair')");
  await m.waitForSelector(".bubble.out:has-text('signed up for texts')");
  await s.goto(s.url());
  await s.uncheck('input[name="sms_consent"]');
  await Promise.all([s.waitForLoadState("networkidle"), s.click("#contact button:has-text('Save')")]);
  await s.waitForSelector(".notice.bad:has-text('no email address')");
  assert.equal((await s.goto(`${BASE}/sms-terms`)).status(), 200);
  assert.match(await s.textContent("body"), /Reply STOP/);
  log("sign-up confirmation sent; customer preference page and terms page work");

  // Billing export
  const csv = await m.evaluate(async (month) => (await fetch(`/api/manager/billing?month=${month}`)).text(), today.slice(0, 7));
  assert.ok(csv.includes("Sea Breeze"), "billing CSV lists completed job");
  log("billing CSV ok");

  // Customer cannot reach the manager
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${BASE}/manager/customers`);
  assert.ok(await anon.locator('input[name="passcode"]').count(), "manager pages need sign-in");
  // Asking for the inner page alone (as a browser with the manager frame already loaded does) must not return data.
  for (const hdrs of [{ RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }, { RSC: "1", "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(["", { children: ["manager", { children: ["customers", { children: ["__PAGE__", {}] }] }] }, null, null, true])) }]) {
    const body = await anon.evaluate(async (h) => (await fetch("/manager/customers?_rsc=x", { headers: h, redirect: "manual" })).text().catch(() => ""), hdrs);
    assert.ok(!/Dana|Whitfield|Luis|555-01/.test(body), "no customer data without a manager sign-in");
  }
  log("manager pages protected");

  // Deletes
  async function del(summary, button) {
    await m.click(`summary:has-text("${summary}")`);
    const f = m.locator("form.delete-form", { has: m.locator(`button:has-text("${button}")`) }).first();
    await f.locator('input[name="confirm"]').check();
    await Promise.all([m.waitForLoadState("networkidle"), f.locator("button").click()]);
    await m.waitForTimeout(300);
  }
  // A recurring visit cannot be deleted; a one-off visit can.
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 14)}`);
  await m.click(".job-line a:has-text('Marlin'), .week-job a:has-text('Marlin')").catch(() => {});
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 3)}`);
  await m.click(".job-line a:has-text('Sea Breeze')");
  await del("Delete this visit", "Delete visit");
  await ok(m);
  await m.waitForSelector("text=deleted");
  await m.goto(`${BASE}/manager/schedule?date=${plus(today, 3)}`);
  assert.equal(await m.locator(".job-line", { hasText: "Sea Breeze" }).count(), 0, "one-off visit deleted");
  log("one-off visit deleted");
  // Marina with boats cannot be deleted
  await m.goto(`${BASE}/manager/marinas`);
  await m.click("a:has-text('Clipper Yacht Harbor')");
  await del("Delete this marina", "Delete marina");
  await m.waitForSelector(".notice.bad:has-text('boat(s) are at this marina')");
  log("marina delete blocked while boats are there");
  // Customer delete removes them
  await m.goto(`${BASE}/manager/customers`);
  await m.click("a:has-text('Priya Nair')");
  await del("Delete this customer", "Delete customer");
  await ok(m);
  assert.ok(m.url().includes("/manager/customers?ok="), "back on customer list");
  assert.equal(await m.locator("a:has-text('Priya Nair')").count(), 0, "customer gone");
  // Unticked checkbox: browser blocks submit (required), server would also refuse
  await m.goto(`${BASE}/manager/crews`);
  await del("Delete technician", "Delete Jon");
  await ok(m);
  assert.equal(await m.locator('input[name="name"][value="Jon"]').count(), 0, "technician gone");
  log("customer and technician deleted");

  // Replace a customer's portal link: old link dies, new one works
  await m.goto(danaUrl);
  await m.click("summary:has-text('Replace the customer')");
  const rf = m.locator("form", { has: m.locator("button:has-text('Replace link')") });
  await rf.locator('input[name="confirm"]').check();
  await Promise.all([m.waitForLoadState("networkidle"), rf.locator("button").click()]);
  await ok(m);
  const newPortal = await m.locator('a[href^="/portal/"]').first().getAttribute("href");
  assert.notEqual(newPortal, portalHref, "portal link changed");
  const gone = await c.goto(`${BASE}${portalHref}`);
  assert.equal(gone.status(), 404, "old portal link stops working");
  assert.ok((await c.textContent("body")).includes("can't find that page"), "friendly not-found page");
  assert.equal((await c.goto(`${BASE}${newPortal}`)).status(), 200, "new portal link works");
  log("portal link replaced; old link shows the not-found page");

  // A technician cannot post work to another crew's job outside the current window
  const far = await m.evaluate(async (d) => {
    const html = await (await fetch(`/manager/schedule?date=${d}`)).text();
    return (html.match(/\/manager\/jobs\/([0-9a-f-]{36})/) || [])[1] || null;
  }, plus(today, 28));
  assert.ok(far, "found a future visit");
  const denied = await t.evaluate(async (jobId) => (await fetch("/api/crew/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: crypto.randomUUID(), jobId, type: "start", at: new Date().toISOString(), data: {} }) })).status, far);
  assert.equal(denied, 403, "technician blocked from another crew's future job");
  log("technician blocked from another crew's job");

  // Expired manager sign-in: saving a form goes to the sign-in screen, not an error page
  const m2ctx = await browser.newContext();
  const m2 = await m2ctx.newPage();
  pages.m2 = m2;
  await m2.goto(`${BASE}/manager`);
  await m2.fill('input[name="passcode"]', "boss-pass");
  await Promise.all([m2.waitForLoadState("networkidle"), m2.click("button:has-text('Sign in')")]);
  await m2.goto(`${BASE}/manager/crews`);
  await m2ctx.clearCookies();
  const cf = m2.locator("form", { has: m2.locator("button:has-text('Add crew')") });
  await cf.locator('input[name="name"]').fill("Ghost crew");
  await Promise.all([m2.waitForLoadState("networkidle"), cf.locator("button:has-text('Add crew')").click()]);
  await m2.waitForSelector('input[name="passcode"]');
  await m.goto(`${BASE}/manager/crews`);
  assert.equal(await m.locator('input[name="name"][value="Ghost crew"]').count(), 0, "nothing saved without a sign-in");
  log("expired manager sign-in returns to the sign-in screen");

  // Lockout after 5 wrong passcodes (run last: it locks this address out)
  for (let i = 0; i < 4; i++) {
    await m2.fill('input[name="passcode"]', `guess-${i}`);
    await m2.click("button:has-text('Sign in')");
    await m2.waitForSelector(".error");
    await m2.waitForTimeout(250);
  }
  await m2.fill('input[name="passcode"]', "boss-pass");
  await m2.click("button:has-text('Sign in')");
  await m2.waitForSelector(".error:has-text('Too many wrong tries')");
  log("sign-in locks after 5 wrong passcodes, even for the right one");

  await shot(m, "08-final");
  await browser.close();
  if (errors.length) { console.log("Browser errors:\n" + errors.join("\n")); process.exit(1); }
  console.log("ALL PASSED");
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  for (const [k, p] of Object.entries(pages)) { await p.screenshot({ path: path.join(OUT, `fail-${k}.png`), fullPage: true }).catch(() => {}); console.log(k, p.url(), (await p.textContent("body").catch(() => "")).slice(0, 600)); }
  console.log(errors.join("\n"));
  process.exit(1);
});
