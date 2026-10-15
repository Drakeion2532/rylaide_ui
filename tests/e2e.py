"""End-to-end test of the Figma-based UI: two riders on two phones, fake mic + GPS, map services mocked.

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
TOP = '#stage > .screen:last-child'   # the screen currently on top


async def step(name, coro):
    t = time.time()
    try:
        await coro
        results.append(('PASS', name)); print(f'  PASS  {name} ({time.time() - t:.1f}s)', flush=True)
    except Exception as e:
        results.append(('FAIL', name)); print(f'  FAIL  {name}: {str(e)[:900]}', flush=True)
        for i, pg in enumerate(pages):
            try: await pg.screenshot(path=os.path.join(SHOTS or '.', f'FAIL-{i}.png'))
            except Exception: pass
        raise


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, f'{name}.png'))


async def tap(page, selector):
    """Click; if headless Chrome's pointer stalls while the WebGL map animates, fall back to a DOM click."""
    loc = page.locator(selector).first
    await loc.wait_for(state='visible', timeout=8000)
    try:
        await loc.click(timeout=4000)
    except Exception:
        await loc.evaluate('el => el.click()')


async def hold(page, selector, ms):
    box = await page.locator(selector).first.bounding_box()
    await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + 30)
    await page.mouse.down()
    await page.wait_for_timeout(ms)
    await page.mouse.up()


async def rider(browser, name, make, model, geo, url='/', theme='light'):
    ctx = await browser.new_context(viewport={'width': 412, 'height': 892}, device_scale_factor=2, geolocation=geo,
                                    permissions=['geolocation', 'microphone'], color_scheme='light')
    await ctx.add_init_script(f"localStorage.getItem('rylaide.theme') || localStorage.setItem('rylaide.theme', JSON.stringify('{theme}'))")
    page = await ctx.new_page()
    pages.append(page)
    def on_console(m):
        if m.type == 'error' and not any(s in m.text for s in ('ERR_FAILED', 'openfreemap', 'ERR_INTERNET_DISCONNECTED')):
            page_errors.append(f'[{name}] console: {m.text}')
    page.on('console', on_console)
    page.on('pageerror', lambda e: page_errors.append(f'[{name}] pageerror: {e}'))
    await page.goto(BASE + url)
    await expect(page.locator('[data-screen=welcome]')).to_be_visible(timeout=8000)
    await tap(page, 'text=Skip')
    await expect(page.locator('[data-screen=profile]')).to_be_visible()
    await page.fill(f'{TOP} form input >> nth=0', name)
    await page.fill(f'{TOP} form input >> nth=1', make)
    await page.fill(f'{TOP} form input >> nth=2', model)
    await page.fill(f'{TOP} form input >> nth=3', '31220')
    await tap(page, f'{TOP} button[type=submit]')
    await expect(page.locator('[data-screen=permissions]')).to_be_visible()
    await tap(page, f'{TOP} .screen-foot .btn')
    await expect(page.locator('[data-screen=home]')).to_be_visible(timeout=8000)
    await page.wait_for_function("() => window.__rylaide.rt.status === 'online'", timeout=8000)
    return ctx, page


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        print('Rylaide end-to-end test (Figma UI)', flush=True)
        A = B = ctxA = ctxB = None
        code = None

        async def onboarding():
            nonlocal A, ctxA
            c = await browser.new_context(viewport={'width': 412, 'height': 892}, geolocation=PUNE, permissions=['geolocation'])
            pg = await c.new_page()
            await pg.goto(BASE)
            await expect(pg.locator('[data-screen=welcome]')).to_be_visible(timeout=8000)
            await expect(pg.locator('.page-dots i.on')).to_have_count(1)
            await tap(pg, 'text=Next')
            await expect(pg.locator('.onb-text')).to_contain_text('Talk without signal')
            await tap(pg, 'text=Skip')
            await tap(pg, f'{TOP} button[type=submit]')
            await expect(pg.locator(f'{TOP} .field.error')).to_contain_text('Enter your name')
            await c.close()
            ctxA, A = await rider(browser, 'Asha', 'Royal Enfield', 'Classic 350', PUNE)
            await expect(A.locator('.hero')).to_contain_text('Classic 350')
            await expect(A.locator('.hero')).to_contain_text('31,220')
            await expect(A.locator('.home-head')).to_contain_text('27°')
            await expect(A.locator('.nav-item[aria-current=page]')).to_contain_text('Home')
            await shot(A, '01-home')
        await step('Onboarding: pages, validation, bike on Home, weather', onboarding())

        async def create_group():
            nonlocal code
            await tap(A, '.nav-item[data-tab=groups]')
            await expect(A.locator('[data-screen=groups] .empty')).to_contain_text('No groups yet')
            await tap(A, '[data-screen=groups] .fab')
            await A.fill('.sheet input', 'Weekend Riders')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('[data-screen=group] .code-big')).to_have_text(re.compile(r'^[A-Z0-9]{6}$'))
            code = (await A.locator('[data-screen=group] .code-big').inner_text()).strip()
            await expect(A.locator('[data-screen=group] img.qr-box')).to_have_attribute('src', re.compile('^blob:'))
            await shot(A, '02-group-invite')
        await step('Create group: invite code + QR', create_group())

        async def join():
            nonlocal B, ctxB
            ctxB, B = await rider(browser, 'Bilal', 'KTM', 'Adventure 390', {'latitude': 18.5300, 'longitude': 73.8600}, url=f'/?join={code}')
            await expect(B.locator('.bento')).to_contain_text('Weekend Riders', timeout=8000)
            await expect(B.locator('.hero')).to_have_attribute('style', re.compile('bike-adventure'))
            assert '?join' not in B.url
            await tap(B, '.nav-item[data-tab=groups]')
            await tap(B, '[data-screen=groups] [aria-label="Join with a code"]')
            await B.fill('.sheet input', 'ZZZZZZ')
            await tap(B, '.sheet button[type=submit]')
            await expect(B.locator('.sheet .field.error')).to_contain_text('No group has that code')
            await B.keyboard.press('Escape')
            await tap(B, '.nav-item[data-tab=home]')
        await step('Second rider joins by invite link; wrong code explained', join())

        async def chat():
            await tap(A, f'{TOP} [role=tab][data-value=chat]')
            await tap(B, '.bento .card >> nth=1')
            await expect(B.locator('[data-screen=group]')).to_be_visible()
            await B.fill('.composer input', 'Fuel stop at Khadakwasla in 10 min')
            await B.press('.composer input', 'Enter')
            await expect(A.locator('.bubble:not(.mine):not(.system)')).to_contain_text('Fuel stop at Khadakwasla', timeout=5000)
            await expect(A.locator('.bubble.system').first).to_contain_text('Bilal joined')
            await A.fill('.composer input', '<img src=x onerror=alert(1)> on my way')
            await A.press('.composer input', 'Enter')
            await expect(B.locator('.bubble', has_text='on my way')).to_contain_text('<img src=x')
            await shot(B, '03-chat')
        await step('Group chat both ways; HTML shown as text', chat())

        async def riders_live():
            await tap(A, f'{TOP} [role=tab][data-value=riders]')
            await expect(A.locator(f'{TOP} .list-item', has_text='Bilal')).to_contain_text('away', timeout=8000)
            await ctxB.set_geolocation({'latitude': 18.5400, 'longitude': 73.8700})
            await A.wait_for_function("() => { const l=[...window.__rylaide.ctx.locs.values()][0]; return l && Math.abs(l.lat-18.54)<1e-6 }", timeout=8000)
            await shot(A, '04-riders')
            await tap(A, f'{TOP} .topbar .icon-btn')
            await tap(A, '.nav-item[data-tab=home]')
            await tap(B, f'{TOP} .topbar .icon-btn')
        await step('Live location: riders list shows distance and follows moves', riders_live())

        async def setup_flow():
            await tap(A, '.hero .btn')
            await expect(A.locator('[data-screen=setup] .step-caption')).to_have_text('Step 1 of 5 · Where to')
            await A.fill('.search-bar input', 'nowhere')
            await expect(A.locator('[data-screen=setup] .empty')).to_contain_text('Nothing found', timeout=5000)
            await A.fill('.search-bar input', 'Sinhagad')
            await expect(A.locator('[data-screen=setup] .list-item').nth(1)).to_contain_text('Sinhagad', timeout=5000)
            await tap(A, '[data-screen=setup] .list-item.tappable >> nth=1')
            await expect(A.locator('.step-caption')).to_have_text('Step 2 of 5 · Who’s riding')
            await expect(A.locator('.rider-row.selected')).to_contain_text('Weekend Riders')
            await tap(A, 'text=Continue')
            await expect(A.locator('.step-caption')).to_have_text('Step 3 of 5 · Checklist')
            ready = A.locator('[data-screen=setup] .screen-foot .btn.filled')
            await expect(ready).to_be_disabled()
            n = await A.locator('.check-item.req').count()
            assert n >= 9, f'expected required items, got {n}'
            for i in range(n):
                await A.locator('.check-item.req input').first.check()
            await expect(A.locator('.check-hero')).to_contain_text('All required items done')
            await expect(ready).to_be_enabled()
            await shot(A, '05-checklist')
            await tap(A, '[data-screen=setup] .screen-foot .btn.filled')
            await expect(A.locator('.step-caption')).to_have_text('Step 4 of 5 · Mic check')
            await expect(A.locator('[data-screen=setup] [role=status]')).to_contain_text(re.compile('Listening|hear you'), timeout=6000)
            await tap(A, 'text=Sounds good')
            await expect(A.locator('.route-opt')).to_have_count(3, timeout=8000)
            await expect(A.locator('.route-opt >> nth=0')).to_contain_text('Best')
            await expect(A.locator('.route-opt >> nth=1')).to_contain_text('Fastest')
            await expect(A.locator('.route-opt >> nth=2')).to_contain_text('Scenic')
            await tap(A, '.route-opt >> nth=1')
            await expect(A.locator('.route-opt.on')).to_contain_text('Fastest')
            await shot(A, '06-route')
            await tap(A, '.route-opt >> nth=0')
            await tap(A, '.route-sheet .btn.filled')
            await expect(A.locator('[data-screen=ride]')).to_be_visible(timeout=8000)
            await expect(A.locator('.maneuver')).to_contain_text('Ganeshkhind Road')
            await expect(A.locator('.trip-strip')).to_contain_text('km left')
            await expect(B.locator('.bento')).to_contain_text('Weekend Riders')
        await step('Ride setup: search, who, checklist gates Ready, mic check, 3 routes, start', setup_flow())

        async def hub_views():
            await expect(A.locator('.hub-top .timer')).to_contain_text(re.compile(r'00:0\d:\d\d'))
            await expect(A.locator('.rider-pin[data-rider]')).to_have_count(1, timeout=8000)
            await shot(A, '07-hub-map')
            await tap(A, '[role=tab][data-value=speed]')
            await expect(A.locator('.gauge .readout')).to_contain_text('km/h')
            await tap(A, '[role=tab][data-value=group]')
            await expect(A.locator('.rider-row', has_text='Bilal')).to_contain_text(re.compile('away|with you'))
            await expect(A.locator('.rider-row', has_text='You')).to_contain_text('Listening')
            await shot(A, '08-hub-group')
            await tap(A, '.hub-content .btn.tonal')
            await expect(A.locator('[data-screen=ridemap] .ride-panel')).to_contain_text('km left')
            await shot(A, '09-fullscreen')
            await tap(A, '[aria-label="Close full screen"]')
            await expect(A.locator('[data-screen=ride]')).to_be_visible()
            await tap(A, '.nav-item[data-tab=home]') if await A.locator('.nav-item').first.is_visible() else None
            await tap(A, '[aria-label="Minimise ride"]')
            await expect(A.locator('.ride-bar')).to_contain_text('Ride in progress')
            await tap(A, '.ride-bar .btn')
            await expect(A.locator('[data-screen=ride]')).to_be_visible()
        await step('Ride hub: timer, rider on map, speed gauge, group view, full screen, minimise + resume', hub_views())

        async def push_to_talk():
            await A.wait_for_timeout(450)  # let the hub finish sliding in (300 ms)
            await hold(A, '.mic-ctl', 150)
            await expect(A.locator('.snackbar').last).to_contain_text('Hold the mic')
            await hold(A, '.mic-ctl', 1600)
            await B.wait_for_function("() => window.__rylaide.ctx.messages.some(m => m.type === 'voice')", timeout=8000)
            await B.wait_for_function("() => window.__rylaide.ctx.speaking || document.querySelector('.snackbar')", timeout=6000)
        await step('Push-to-talk: short press refused; voice delivered and played', push_to_talk())

        async def sos():
            await tap(B, '.hero .btn')
            await tap(B, 'text=Just ride')
            await expect(B.locator('[data-screen=ride]')).to_be_visible()
            await tap(B, '.sos-ctl')
            await expect(B.locator('.snackbar').last).to_contain_text('Hold SOS')
            await hold(B, '.sos-ctl', 1800)
            await expect(B.locator('[data-screen=sos]')).to_be_visible()
            await expect(B.locator('[data-screen=sos]')).to_contain_text('Alerting your group in')
            await expect(A.locator('.sos-alert')).to_contain_text('SOS from Bilal', timeout=9000)
            await expect(B.locator('[data-screen=sos]')).to_contain_text('Help on the way')
            await expect(B.locator('[data-screen=sos]')).to_contain_text('Call 112')
            await shot(B, '10-sos-sent'); await shot(A, '11-sos-received')
            await tap(B, 'text=I’m safe, cancel SOS')
            await expect(A.locator('.sos-alert')).to_have_count(0, timeout=5000)
            await expect(A.locator('.snackbar').last).to_contain_text('is safe')
            # cancelling during the countdown sends nothing
            await hold(B, '.sos-ctl', 1800)
            await tap(B, 'text=I’m OK, cancel')
            await A.wait_for_timeout(5500)
            await expect(A.locator('.sos-alert')).to_have_count(0)
        await step('SOS: tap refused, hold + countdown alerts group, cancel clears it', sos())

        async def record_and_summary():
            for i in range(1, 7):
                await ctxA.set_geolocation({'latitude': 18.5204 + i * 0.0006, 'longitude': 73.8567})
                await A.wait_for_timeout(1200)
            await tap(A, f'{TOP} .hub-top .btn')
            await tap(A, '.dialog .btn >> nth=1')
            await expect(A.locator('[data-screen=summary]')).to_be_visible(timeout=8000)
            await expect(A.locator('.summary-hero')).to_contain_text('Sinhagad')
            await expect(A.locator('.summary-hero')).to_contain_text('Group ride')
            await expect(A.locator('.summary-top')).to_contain_text('km')
            await shot(A, '12-summary')
            await tap(A, 'text=View in history')
            await expect(A.locator('[data-screen=history] .list-item')).to_have_count(1)
            await expect(A.locator('[data-screen=history] .list-item')).to_contain_text('Sinhagad')
            await tap(B, f'{TOP} .hub-top .btn')
            await tap(B, '.dialog .btn >> nth=1')
            await expect(B.locator('.snackbar').last).to_contain_text('too short')
        await step('Ride recording: end ride, summary, history; too-short ride not saved', record_and_summary())

        async def fuel():
            await tap(A, '.nav-item[data-tab=garage]')
            await tap(A, '[data-screen=garage] .list-item:has-text("Fuel log")')
            await expect(A.locator('[data-screen=fuel] .empty')).to_contain_text('Log each fill-up')
            for odo, l, price in [(31300, 9, 104.5), (31680, 8.5, 105.2), (32060, 9.2, 106)]:
                await tap(A, '[data-screen=fuel] .fab')
                await A.fill('.sheet input[name=odometer]', str(odo))
                await A.fill('.sheet input[name=litres]', str(l))
                await A.fill('.sheet input[name=price]', str(price))
                await tap(A, '.sheet button[type=submit]')
                await expect(A.locator('.sheet')).to_have_count(0)
            await expect(A.locator('[data-screen=fuel] .list-item').first).to_contain_text('41.3 km/l')
            await expect(A.locator('[data-screen=fuel] .stat-row')).to_contain_text('km/l')
            await tap(A, '[data-screen=fuel] .fab')
            await A.fill('.sheet input[name=odometer]', '32060'); await A.fill('.sheet input[name=litres]', '1'); await A.fill('.sheet input[name=price]', '1')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('.sheet .field.error')).to_contain_text('already a fill-up')
            await A.keyboard.press('Escape')
            await shot(A, '13-fuel')
            await tap(A, f'{TOP} .topbar .icon-btn')
            await expect(A.locator('[data-screen=garage] .hero')).to_contain_text('32,060')
        await step('Fuel log: mileage, stats, duplicate blocked, odometer updates bike', fuel())

        async def settings():
            await tap(A, '[data-screen=garage] [aria-label=Settings]')
            await tap(A, '[data-screen=settings] .list-item:has-text("Glove Mode") input')
            assert await A.evaluate("document.documentElement.classList.contains('glove')")
            await tap(A, '[data-screen=settings] [role=tab][data-value=dark]')
            assert await A.evaluate("document.documentElement.dataset.light") == 'night'
            await tap(A, '[data-screen=settings] .swatch[aria-label=Orange]')
            assert (await A.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary')")).strip().lower() == '#ff8f3a'
            await shot(A, '14-settings-dark')
            await A.reload()
            await expect(A.locator('[data-screen=home]')).to_be_visible(timeout=8000)
            assert await A.evaluate("document.documentElement.classList.contains('glove') && document.documentElement.dataset.light === 'night'")
            await tap(A, '[data-screen=home] .hero .btn')
            await tap(A, 'text=Just ride')
            await A.wait_for_timeout(450)
            w = await A.evaluate("document.querySelector('.ride-control .ctl').getBoundingClientRect().width")
            assert w >= 79, f'glove mode ride controls should be 80 dp, got {w}'
            await shot(A, '15-glove-night-hub')
            await tap(A, f'{TOP} .hub-top .btn')
            await tap(A, '.dialog .btn >> nth=1')
        await step('Settings: Glove Mode 80 dp, Night theme, accent, persist after reload', settings())

        async def offline():
            await tap(B, '[data-screen=home] .hero .btn') if await B.locator('[data-screen=home]').is_visible() else None
            await tap(B, 'text=Just ride')
            await ctxB.set_offline(True)
            await B.evaluate("window.__rylaide.rt.ws && window.__rylaide.rt.ws.close()")
            await expect(B.locator('.hub-chips .status').first).to_have_attribute('data-state', re.compile('reconnecting|disconnected'), timeout=6000)
            await expect(B.locator('[data-banner-host]')).to_contain_text('Connection lost', timeout=6000)
            await shot(B, '16-offline')
            await ctxB.set_offline(False)
            await expect(B.locator('.hub-chips .status').first).to_have_attribute('data-state', re.compile('internet|connected'), timeout=20000)
            await tap(B, f'{TOP} .hub-top .btn')
            await tap(B, '.dialog .btn >> nth=1')
        await step('Offline: status chip + banner, auto-reconnect', offline())

        async def leave_and_session():
            await tap(B, '.nav-item[data-tab=groups]')
            await tap(B, '[data-screen=groups] .list-item')
            await tap(B, f'{TOP} [role=tab][data-value=riders]')
            await tap(B, 'text=Leave group')
            await tap(B, '.dialog .btn >> nth=1')
            await expect(B.locator('[data-screen=groups] .empty')).to_contain_text('No groups yet', timeout=5000)
            await A.wait_for_function("() => window.__rylaide.ctx.group.members.length === 1", timeout=5000)
            await A.set_viewport_size({'width': 1280, 'height': 800})
            await shot(A, '17-desktop')
            await B.evaluate("localStorage.setItem('rylaide.token', JSON.stringify('bogus'))")
            await B.reload()
            await expect(B.locator('[data-screen=welcome]')).to_be_visible(timeout=10000)
        await step('Leave group, desktop layout, expired session back to setup', leave_and_session())

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
