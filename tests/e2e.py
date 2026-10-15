"""End-to-end test: two riders on two phones, every feature, fake mic + GPS, map services mocked.

Run:  npm run test:e2e   (starts the mock services and server for you)
"""
import asyncio, os, re, sys, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:3100')
SHOTS = os.environ.get('SHOTS', '')
ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
PUNE = {'latitude': 18.5204, 'longitude': 73.8567}
results, page_errors, pages = [], [], []

def ok(name):
    results.append(('PASS', name)); print(f'  PASS  {name}', flush=True)

async def step(name, coro):
    t = time.time()
    try:
        await coro
        ok(f'{name} ({time.time() - t:.1f}s)')
    except Exception as e:
        results.append(('FAIL', name)); print(f'  FAIL  {name}: {str(e)[:900]}', flush=True)
        for i, pg in enumerate(pages):
            try: await pg.screenshot(path=os.path.join(SHOTS or '.', f'FAIL-{i}.png'))
            except Exception: pass
        raise

async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def rider(browser, name, bike, geo, scheme='dark', url='/'):
    ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, geolocation=geo,
                                    permissions=['geolocation', 'microphone'], color_scheme=scheme, has_touch=False)
    page = await ctx.new_page()
    pages.append(page)
    def on_console(m):
        # Map tiles and the OpenFreeMap style are blocked in the test sandbox; anything else is a real error.
        if m.type == 'error' and 'ERR_FAILED' not in m.text and 'openfreemap' not in m.text and 'ERR_INTERNET_DISCONNECTED' not in m.text:
            page_errors.append(f'[{name}] console: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: page_errors.append(f'[{name}] pageerror: {e}'))
    await page.goto(BASE + url)
    await expect(page.locator('#onboard')).to_be_visible(timeout=8000)
    await page.fill('#ob-name', name)
    await page.click(f'#ob-bike [data-v={bike}]')
    await page.click('#onboard-form button[type=submit]')
    await expect(page.locator('#app')).to_be_visible()
    await expect(page.locator('#conn-dot')).to_have_class(re.compile(r'\bon\b'), timeout=8000)
    return ctx, page

async def hold(page, sel, ms):
    box = await page.locator(sel).bounding_box()
    await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    await page.mouse.down()
    await page.wait_for_timeout(ms)
    await page.mouse.up()

async def tab(page, name):
    await page.click(f'.tab[data-sheet="{name}"]')
    if name:
        await expect(page.locator(f'#sheet-{name}')).to_be_visible()
        await page.wait_for_timeout(420)  # let the slide-up finish before clicking inside

async def close_sheet(page):
    await page.keyboard.press('Escape')
    await page.wait_for_timeout(420)

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        print('Rylaide end-to-end test', flush=True)

        # ---------------------------------------------------------------- onboarding
        ctx_a, a = None, None
        async def onboarding():
            nonlocal ctx_a, a
            # empty name is blocked by the form
            c = await browser.new_context(viewport={'width': 390, 'height': 844}, geolocation=PUNE, permissions=['geolocation', 'microphone'])
            pg = await c.new_page()
            await pg.goto(BASE)
            await expect(pg.locator('#onboard')).to_be_visible(timeout=8000)
            await pg.fill('#ob-name', '   ')
            await pg.click('#onboard-form button[type=submit]')
            await expect(pg.locator('#ob-error')).to_contain_text('Enter your name')
            await c.close()
            ctx_a, a = await rider(browser, 'Asha', 'sport', PUNE)
            await shot(a, '01-map-empty')
            await expect(a.locator('#weather')).to_contain_text('27°')
            await expect(a.locator('#map-banner')).to_contain_text('Map tiles couldn’t load')  # graceful fallback in sandbox
            assert await a.evaluate('!!window.__rylaide.map.map'), 'map engine did not start'
            await expect(a.locator('.rider.me')).to_have_count(1)
        await step('Onboarding, map, my marker, weather', onboarding())

        # ---------------------------------------------------------------- group create + join by link
        code = None
        async def create_group():
            nonlocal code
            await expect(a.locator('#btn-ptt')).to_have_class(re.compile('disabled'))
            await hold(a, '#btn-ptt', 300)
            await expect(a.locator('.toast').last).to_contain_text('Join a group')
            await a.click('#group-pill')
            await expect(a.locator('#sheet-group')).to_be_visible()
            await a.wait_for_timeout(420)
            await a.fill('input[name=gname]', 'Sunday Sinhagad')
            await a.click('text=Create group')
            await expect(a.locator('.code-big')).to_have_text(re.compile(r'^[A-Z0-9]{6}$'))
            code = (await a.locator('.code-big').inner_text()).strip()
            await expect(a.locator('.code-card img.qr')).to_have_attribute('src', re.compile('^blob:'))
            await expect(a.locator('#group-pill-text')).to_contain_text('Sunday Sinhagad')
            await expect(a.locator('#group-body')).not_to_contain_text('null')
            await shot(a, '02-group-created')
            await close_sheet(a)
        await step('Create group, code + QR', create_group())

        ctx_b, b = None, None
        async def join_by_link():
            nonlocal ctx_b, b
            ctx_b, b = await rider(browser, 'Bilal', 'adventure', {'latitude': 18.5300, 'longitude': 73.8600}, scheme='light', url=f'/?join={code}')
            await expect(b.locator('#group-pill-text')).to_contain_text('Sunday Sinhagad', timeout=8000)
            await expect(b.locator('#group-pill-text')).to_contain_text('2/2 riding', timeout=8000)
            await expect(a.locator('#group-pill-text')).to_contain_text('2/2 riding', timeout=8000)
            assert '?join' not in b.url, 'join code should be removed from the address bar'
        await step('Second rider joins with invite link', join_by_link())

        async def wrong_code():
            await b.click('#group-pill'); await b.wait_for_timeout(420)
            await b.click('text=Join or create another group')
            await b.fill('input[name=code]', 'ZZZZZZ')
            await b.click('text=Join group')
            await expect(b.locator('.toast.err').last).to_contain_text('No group has that code')
            await close_sheet(b)
        await step('Wrong join code shows a clear error', wrong_code())

        # ---------------------------------------------------------------- live location
        async def live_location():
            await expect(a.locator('.rider:not(.me) .rider-name')).to_have_text('Bilal', timeout=8000)
            await expect(b.locator('.rider:not(.me) .rider-name')).to_have_text('Asha', timeout=8000)
            await ctx_b.set_geolocation({'latitude': 18.5400, 'longitude': 73.8700})
            await a.wait_for_function("() => { const l = [...window.__rylaide.ctx.locs.values()][0]; return l && Math.abs(l.lat - 18.54) < 1e-6; }", timeout=8000)
            await a.click('#btn-fit')
            await a.wait_for_timeout(900)
            await shot(a, '03-two-riders')
            await tab(a, 'group')
            await expect(a.locator('.member', has_text='Bilal')).to_contain_text('away')
            await close_sheet(a)
        await step('Live locations shared both ways and update on move', live_location())

        # ---------------------------------------------------------------- chat
        async def chat():
            await tab(b, 'chat')
            await b.fill('#chat-input', 'Fuel stop at Khadakwasla in 10 min')
            await b.press('#chat-input', 'Enter')
            await expect(b.locator('.msg.mine')).to_contain_text('Fuel stop at Khadakwasla')
            await expect(a.locator('#chat-badge')).to_have_text('1', timeout=5000)
            await tab(a, 'chat')
            await expect(a.locator('#chat-badge')).to_be_hidden()
            await expect(a.locator('.msg:not(.mine):not(.system)')).to_contain_text('Fuel stop at Khadakwasla')
            await expect(a.locator('.msg.system').first).to_contain_text('Bilal joined')
            await a.fill('#chat-input', '<img src=x onerror=alert(1)> on my way')
            await a.press('#chat-input', 'Enter')
            await expect(b.locator('.msg', has_text='on my way')).to_contain_text('<img src=x')  # shown as text, not HTML
            await shot(a, '04-chat')
            await close_sheet(a); await close_sheet(b)
        await step('Group chat, unread badge, HTML is escaped', chat())

        # ---------------------------------------------------------------- push to talk
        async def push_to_talk():
            await hold(a, '#btn-ptt', 150)
            await expect(a.locator('.toast').last).to_contain_text('Hold the button')
            await hold(a, '#btn-ptt', 1600)
            await b.wait_for_function("() => document.querySelector('.msg.voice') !== null", timeout=8000)
            await tab(b, 'chat')
            await expect(b.locator('.msg.voice').last).to_contain_text('Voice message')
            await close_sheet(b)
            # receiver plays it (or offers tap-to-play if autoplay is blocked)
            await b.wait_for_function("() => document.querySelector('#btn-ptt').classList.contains('hearing') || [...document.querySelectorAll('.toast')].some(t => /talking|New voice/.test(t.textContent))", timeout=6000)
        await step('Push-to-talk: too-short press refused, voice delivered and played', push_to_talk())

        # ---------------------------------------------------------------- SOS
        async def sos():
            await b.click('#btn-sos')
            await expect(b.locator('.toast').last).to_contain_text('Hold SOS')
            await hold(b, '#btn-sos', 1700)
            await expect(b.locator('#sos-overlay')).to_be_visible()
            await expect(b.locator('#sos-title')).to_contain_text('Sending SOS in')
            await expect(b.locator('#sos-contacts')).to_contain_text('Call 112')
            await expect(a.locator('#alert-bar')).to_contain_text('SOS from Bilal', timeout=9000)
            await expect(b.locator('#sos-title')).to_contain_text('SOS sent to your group')
            await expect(a.locator('.rider.sos')).to_have_count(1)
            await shot(a, '05-sos-received'); await shot(b, '05-sos-sent')
            await b.click('#sos-cancel')
            await expect(b.locator('#sos-overlay')).to_be_hidden()
            await expect(a.locator('#alert-bar')).to_be_hidden(timeout=5000)
            await expect(a.locator('.rider.sos')).to_have_count(0)
            # cancel during countdown sends nothing
            await hold(b, '#btn-sos', 1700)
            await expect(b.locator('#sos-overlay')).to_be_visible()
            await b.click('#sos-cancel')
            await a.wait_for_timeout(5500)
            await expect(a.locator('#alert-bar')).to_be_hidden()
        await step('SOS: tap refused, hold + countdown alerts group, cancel clears it', sos())

        # ---------------------------------------------------------------- route + navigation + plan
        async def route_nav():
            await tab(a, 'tools')
            await a.click('#tools-tabs [data-tool=route]')
            await a.fill('#route-q', 'nowhere')
            await a.click('#route-form button')
            await expect(a.locator('#route-results')).to_contain_text('No places found')
            await a.fill('#route-q', 'Sinhagad')
            await a.click('#route-form button')
            await a.click('#route-results button >> nth=0')
            await expect(a.locator('#route-preview .route-sum')).to_contain_text(re.compile(r'\b12\b'))
            await shot(a, '06-route-preview')
            await a.click('#route-preview summary >> text=Set as group plan')
            await a.fill('#route-preview input[type=time]', '06:30')
            await a.click('#route-preview >> text=Share plan with group')
            await expect(a.locator('.toast').last).to_contain_text('Ride plan shared')
            await a.click('#route-preview >> text=Start navigation')
            await expect(a.locator('#nav-card')).to_be_visible()
            await expect(a.locator('#nav-instr')).to_have_text('Turn left onto Ganeshkhind Road')
            await expect(a.locator('#nav-remaining')).to_contain_text('to Sinhagad')
            await shot(a, '07-navigation')
            await a.click('#nav-stop')
            await expect(a.locator('#nav-card')).to_be_hidden()
            await tab(b, 'group')
            await expect(b.locator('.plan')).to_contain_text('Ride plan: Sinhagad')
            await expect(b.locator('.plan')).to_contain_text('Meet at 06:30')
            await b.click('.plan >> text=Navigate there')
            await expect(b.locator('#nav-card')).to_be_visible()
            await b.click('#nav-stop')
        await step('Search, route preview, turn-by-turn, group plan shared', route_nav())

        # ---------------------------------------------------------------- ride recording
        async def ride():
            await a.click('#btn-ride')
            await expect(a.locator('#hud')).to_be_visible()
            for i in range(1, 6):
                await ctx_a.set_geolocation({'latitude': 18.5204 + i * 0.002, 'longitude': 73.8567})
                await a.wait_for_timeout(450)
            await expect(a.locator('#hud-dist')).not_to_have_text('0.0')
            await shot(a, '08-ride-recording')
            await a.click('#btn-ride')
            await expect(a.locator('.toast').last).to_contain_text('Ride saved')
            await tab(a, 'tools')
            await a.click('#tools-tabs [data-tool=rides]')
            await expect(a.locator('#rides-list li')).to_have_count(1)
            await expect(a.locator('#rides-list')).to_contain_text('1.1 km')
            await close_sheet(a)
            await b.click('#btn-ride'); await b.click('#btn-ride')
            await expect(b.locator('.toast').last).to_contain_text('too short')
        await step('Ride recording: HUD, save, history; too-short ride not saved', ride())

        # ---------------------------------------------------------------- fuel log
        async def fuel():
            await tab(a, 'tools')
            await a.click('#tools-tabs [data-tool=fuel]')
            await expect(a.locator('#fuel-list')).to_contain_text('Log each fill-up')
            for odo, l, price in [(12000, 9, 104.5), (12380, 8.5, 105.2), (12760, 9.2, 106)]:
                await a.fill('#fuel-form [name=odometer]', str(odo))
                await a.fill('#fuel-form [name=litres]', str(l))
                await a.fill('#fuel-form [name=pricePerLitre]', str(price))
                await a.click('#fuel-form button[type=submit]')
                await expect(a.locator('#fuel-list li').first).to_contain_text(f'{odo:,}'.replace(',', ','))
            await expect(a.locator('#fuel-stats')).to_contain_text('avg km/l')
            await expect(a.locator('#fuel-list li').first).to_contain_text('41.3')
            await expect(a.locator('#fuel-chart svg')).to_have_count(1)
            await a.fill('#fuel-form [name=odometer]', '12760'); await a.fill('#fuel-form [name=litres]', '1'); await a.fill('#fuel-form [name=pricePerLitre]', '1')
            await a.click('#fuel-form button[type=submit]')
            await expect(a.locator('#fuel-error')).to_contain_text('already a fill-up')
            await shot(a, '09-fuel')
        await step('Fuel log: mileage, stats, trend chart, duplicate blocked', fuel())

        # ---------------------------------------------------------------- checklist
        async def checklist():
            await a.click('#tools-tabs [data-tool=check]')
            await expect(a.locator('#ck-context')).to_contain_text('Sport')
            n = await a.locator('#ck-list li').count()
            await a.select_option('#ck-trip', 'multi')
            assert await a.locator('#ck-list li').count() > n, 'multi-day tour should add items'
            await expect(a.locator('#ck-list')).to_contain_text('Puncture kit')
            await a.locator('#ck-list input').first.check()
            await expect(a.locator('#ck-progress')).to_contain_text('1 of')
            await close_sheet(a)
            await tab(a, 'tools')
            await expect(a.locator('#ck-list input').first).to_be_checked()
            await shot(a, '10-checklist')
        await step('Pre-ride checklist adapts to bike + trip, ticks persist', checklist())

        # ---------------------------------------------------------------- mic test
        async def mic():
            await a.click('#tools-tabs [data-tool=mic]')
            await a.click('#mic-start')
            await expect(a.locator('#mic-status')).to_contain_text('Listening on')
            await a.wait_for_function("() => parseFloat(document.querySelector('#mic-meter').style.width) > 0", timeout=5000)
            await a.click('#mic-record')
            await expect(a.locator('#mic-play')).to_be_enabled(timeout=6000)
            await a.click('#mic-play')
            await expect(a.locator('#mic-status')).to_contain_text(re.compile('Playing back|ready to ride'))
            await shot(a, '11-mic-test')
            await close_sheet(a)
            assert await a.evaluate('window.__rylaide.ctx && true')
        await step('Mic test: level meter moves, record + playback', mic())

        # ---------------------------------------------------------------- settings
        async def settings():
            await tab(a, 'you')
            await a.check('#set-glove')
            assert await a.evaluate("document.documentElement.classList.contains('glove')")
            ptt_w = await a.evaluate("document.querySelector('#btn-ptt').getBoundingClientRect().width")
            assert ptt_w >= 120, f'glove mode should enlarge talk button, got {ptt_w}'
            await a.click('#set-theme [data-v=light]')
            assert await a.evaluate("document.documentElement.dataset.theme") == 'light'
            await a.click('#set-accent .swatch >> nth=1')
            assert (await a.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent')")).strip().upper() == '#F98924'
            await a.fill('#pf-name', 'Asha K')
            await a.click('#pf-colors .swatch >> nth=3')
            await a.click('#profile-form button[type=submit]')
            await expect(a.locator('.toast').last).to_contain_text('Profile saved')
            await a.locator('.c-name').first.fill('Mom')
            await a.locator('.c-phone').first.fill('+91 98765 43210')
            await a.click('#contacts-add')
            await a.locator('.c-name').nth(1).fill('Bad')
            await a.locator('.c-phone').nth(1).fill('12')
            await a.click('#contacts-form button[type=submit]')
            await expect(a.locator('.toast').last).to_contain_text('1 skipped')
            await shot(a, '12-settings')
            await a.reload()
            await expect(a.locator('#app')).to_be_visible(timeout=8000)
            assert await a.evaluate("document.documentElement.classList.contains('glove') && document.documentElement.dataset.theme === 'light'"), 'settings should persist'
            await expect(a.locator('#group-pill-text')).to_contain_text('Sunday Sinhagad', timeout=8000)
            await tab(a, 'you')
            await expect(a.locator('#pf-name')).to_have_value('Asha K')
            await close_sheet(a)
            await expect(b.locator('.rider:not(.me) .rider-name')).to_have_text('Asha K', timeout=8000)
        await step('Settings: glove mode, theme, accent, profile, contacts, persist after reload', settings())

        # ---------------------------------------------------------------- offline / reconnect
        async def offline():
            await ctx_b.set_offline(True)
            await b.evaluate("window.__rylaide.rt.ws && window.__rylaide.rt.ws.close()")
            await expect(b.locator('#conn-dot')).not_to_have_class(re.compile(r'\bon\b'), timeout=5000)
            await expect(b.locator('#map-banner')).to_contain_text('Reconnecting')
            await tab(b, 'chat')
            await b.fill('#chat-input', 'hello?')
            await b.press('#chat-input', 'Enter')
            await expect(b.locator('.toast.err').last).to_contain_text('offline')
            await close_sheet(b)
            await ctx_b.set_offline(False)
            await expect(b.locator('#conn-dot')).to_have_class(re.compile(r'\bon\b'), timeout=20000)
            await tab(b, 'chat')
            await b.fill('#chat-input', 'back online')
            await b.press('#chat-input', 'Enter')
            await expect(a.locator('#chat-list')).to_contain_text('back online', timeout=5000)
            await close_sheet(b)
        await step('Offline: clear message, auto-reconnect, chat works again', offline())

        # ---------------------------------------------------------------- leave + desktop + session
        async def leave_and_misc():
            await tab(b, 'group')
            b.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await b.click('text=Leave this group')
            await expect(b.locator('#group-pill-text')).to_have_text('Create or join a group')
            await expect(a.locator('#group-pill-text')).to_contain_text('1/1', timeout=5000)
            await expect(a.locator('.rider:not(.me)')).to_have_count(0, timeout=5000)
            # desktop layout
            await a.set_viewport_size({'width': 1280, 'height': 800})
            await tab(a, 'group')
            await shot(a, '13-desktop')
            await close_sheet(a)
            # expired session sends you back to onboarding
            await b.evaluate("localStorage.setItem('rylaide.token', JSON.stringify('bogus'))")
            await b.reload()
            await expect(b.locator('#onboard')).to_be_visible(timeout=10000)
        await step('Leave group, desktop layout, expired session handled', leave_and_misc())

        await browser.close()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception:
        pass
    real_errors = [e for e in page_errors if 'Failed to load resource' not in e]
    for e in real_errors: print('  ERROR', e)
    fails = [r for r in results if r[0] == 'FAIL']
    print(f'\n{len(results) - len(fails)} passed, {len(fails)} failed, {len(real_errors)} browser errors')
    sys.exit(1 if fails or real_errors or not results else 0)
