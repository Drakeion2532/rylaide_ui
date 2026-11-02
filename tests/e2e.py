"""End-to-end test of the Figma-based UI: two riders on two phones, fake mic + GPS, map services mocked.

Run:  npm run test:e2e   (starts the mock services and server for you)
"""
import asyncio, os, re, sys, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:3100')
SHOTS = os.environ.get('SHOTS', '')
ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
        '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
        await page.wait_for_timeout(450)  # let slides and colour fades finish
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
    await expect(page.locator('[data-screen=terms]')).to_be_visible()
    await tap(page, '[data-screen=terms] .cbox input')
    await tap(page, 'text=Agree and continue')
    # 05 Sign in or create → 06 Create account → 07 Setup → 07a Bikes → 07b Permissions → Home
    await tap(page, '[data-screen=signin] [data-create]')
    await expect(page.locator('[data-screen=profile]')).to_be_visible()
    await page.fill(f'{TOP} input[name=name]', name)
    await tap(page, f'{TOP} button[type=submit]')
    await expect(page.locator('[data-screen=acctsetup]')).to_contain_text(f'Set up Rylaide, {name}', timeout=6000)
    await tap(page, '[data-setup=setupbikes]')
    await expect(page.locator('.sheet input[name=make]')).to_be_visible(timeout=5000)
    await page.fill('.sheet input[name=make]', make)
    await page.fill('.sheet input[name=model]', model)
    await page.fill('.sheet input[name=odometer]', '31220')
    await tap(page, '.sheet button[type=submit]')
    await expect(page.locator('[data-screen=setupbikes] .veh-row')).to_have_count(1, timeout=5000)
    await tap(page, '[data-screen=setupbikes] .screen-foot .btn')
    await tap(page, '[data-setup=permissions]')
    await tap(page, '[data-screen=permissions] .screen-foot .btn')
    await expect(page.locator('[data-setup=setupbikes].done')).to_be_visible()
    await tap(page, '[data-screen=acctsetup] .screen-foot .btn')
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
            await expect(pg.locator('[data-screen=terms] .btn.filled')).to_be_disabled()
            await tap(pg, '[data-screen=terms] >> text=Terms of use')
            await expect(pg.locator('[data-screen=legal]')).to_contain_text('Riding safely')
            await pg.go_back(); await pg.wait_for_timeout(400)
            await tap(pg, '[data-screen=terms] .cbox input')
            await tap(pg, 'text=Agree and continue')
            await expect(pg.locator('[data-screen=signin]')).to_contain_text('Already riding with Rylaide')
            await tap(pg, '[data-screen=signin] [data-create]')
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
            await expect(A.locator('[data-screen=newgroup]')).to_contain_text('Name your group')
            await A.fill('[data-screen=newgroup] input[name=name]', 'Weekend Riders')
            await tap(A, '[data-screen=newgroup] button[type=submit]')
            await expect(A.locator('[data-screen=newgroup] .code-big')).to_have_text(re.compile(r'^[A-Z0-9]{6}$'))
            code = (await A.locator('[data-screen=newgroup] .code-big').inner_text()).strip()
            await expect(A.locator('[data-screen=newgroup] img.qr-box')).to_have_attribute('src', re.compile('^blob:'))
            await shot(A, '02-group-invite')
            await tap(A, '[data-screen=newgroup] >> text=Go to the group')
            await expect(A.locator(f'{TOP}[data-screen=group]')).to_be_visible()
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

        async def bike_photo():
            await tap(B, '[data-screen=home] .hero [aria-label="Add a photo of your bike"]')
            await expect(B.locator('.sheet input[name=model]')).to_have_value('Adventure 390')
            await expect(B.locator('.sheet select[name=type]')).to_have_value('adventure')
            await B.locator('.sheet input[type=file]').set_input_files(os.path.join(ROOT, 'web/img/bike-sport.jpg'))
            await expect(B.locator('.sheet .bike-preview')).to_have_attribute('style', re.compile('data:image/jpeg'), timeout=5000)
            await tap(B, '.sheet button[type=submit]')
            await expect(B.locator('[data-screen=home] .hero')).to_have_attribute('style', re.compile(r'/photos/[\w-]+\.jpg'), timeout=6000)
            src = await B.evaluate("window.__rylaide.ctx.user.vehicle.photo")
            r = await B.request.get(f'{BASE}/photos/{src}.jpg')
            assert r.status == 200 and r.headers['content-type'].startswith('image/jpeg')
            await shot(B, '03-own-bike-photo')
        await step('Owner bike photo: add from Home, shown as the Home hero', bike_photo())

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
            await tap(A, f'{TOP} [role=tab][data-value=members]')
            await expect(A.locator(f'{TOP} .list-item', has_text='Bilal')).to_contain_text('away', timeout=8000)
            await ctxB.set_geolocation({'latitude': 18.5400, 'longitude': 73.8700})
            await A.wait_for_function("() => { const l=[...window.__rylaide.ctx.locs.values()][0]; return l && Math.abs(l.lat-18.54)<1e-6 }", timeout=8000)
            await shot(A, '04-riders')
            await tap(A, f'{TOP} .topbar .icon-btn')
            await tap(A, '.nav-item[data-tab=home]')
            await tap(B, f'{TOP} .topbar .icon-btn')
        await step('Live location: riders list shows distance and follows moves', riders_live())

        async def group_tools():
            # A (leader): group info → expenses: Fuel ₹600 split between both
            await tap(A, '.nav-item[data-tab=groups]')
            await tap(A, '[data-screen=groups] .list-item')
            await tap(A, f'{TOP} [aria-label="Group info"] >> nth=-1')
            await expect(A.locator('[data-screen=groupinfo]')).to_contain_text('Weekend Riders')
            await tap(A, '[data-screen=groupinfo] [data-page=expenses]')
            await tap(A, '[data-screen=expenses] .fab')
            await A.fill('.sheet input[name=title]', 'Fuel')
            await A.fill('.sheet input[name=amount]', '600')
            await expect(A.locator('.sheet')).to_contain_text('₹300 each')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('[data-screen=expenses] .you-get')).to_contain_text('₹300')
            await expect(A.locator('[data-screen=expenses]')).to_contain_text('Bilal → you')
            await shot(A, '04b-expenses')
            await tap(A, '[data-screen=expenses] [aria-label=Back]')
            # members: leader gets options for Bilal
            await tap(A, '[data-screen=groupinfo] [data-page=members]')
            await expect(A.locator('[data-screen=members] .list-item', has_text='Bilal')).to_be_visible()
            await tap(A, '[data-screen=members] .list-item:has-text("Bilal")')
            await expect(A.locator('.sheet')).to_contain_text('Make group leader')
            await A.keyboard.press('Escape')
            await A.wait_for_timeout(300)
            await tap(A, '[data-screen=members] [aria-label=Back]')
            await tap(A, '[data-screen=groupinfo] [aria-label=Back]')
            # B sees what they owe, and shares a place; A sees it appear
            await tap(B, '.nav-item[data-tab=groups]')
            await tap(B, '[data-screen=groups] .list-item')
            await tap(B, f'{TOP} [aria-label="Group info"] >> nth=-1')
            await expect(B.locator('[data-screen=groupinfo]')).to_contain_text('you owe ₹300', timeout=5000)
            await tap(B, '[data-screen=groupinfo] [aria-label=Back]')
            await tap(A, f'{TOP} [role=tab][data-value=shared]')
            await tap(B, f'{TOP} [role=tab][data-value=shared]')
            await tap(B, f'{TOP} >> text=Share a place')
            await B.fill('.sheet input[name=name]', 'Sharma Dhaba')
            await tap(B, '.sheet .chip:has-text("Food")')
            await tap(B, '.sheet button[type=submit]')
            await expect(A.locator(f'{TOP} .list-item', has_text='Sharma Dhaba')).to_contain_text('Bilal', timeout=6000)
            await shot(A, '04c-shared')
            await tap(A, f'{TOP} [role=tab][data-value=chat]')
            await expect(A.locator('.bubble.system').last).to_contain_text('shared a place')
            await tap(A, f'{TOP} .topbar .icon-btn')
            await tap(A, '.nav-item[data-tab=home]')
            await tap(B, f'{TOP} .topbar .icon-btn')
            await tap(B, '.nav-item[data-tab=home]')
        await step('Group tools: group info, expenses split, leader options, shared places live', group_tools())

        async def setup_flow():
            P = lambda name: f'[data-screen=setup] [data-page={name}]'
            async def settle(): await A.wait_for_timeout(350)
            await tap(A, '.hero .btn')
            await expect(A.locator('[data-screen=setup] .step-caption')).to_have_text('Start a ride')
            await expect(A.locator(P('start') + ' [data-vehicle-pick]')).to_contain_text('Classic 350')
            await expect(A.locator('[data-mode]')).to_have_count(3)
            await expect(A.locator('[data-mode=solo]')).to_have_attribute('style', re.compile('bike-classic'))
            await expect(A.locator('[data-mode=quick]')).to_contain_text('Weekend Riders')
            await shot(A, '04-ride-type')
            # solo: 19 Conditions (pillion) → 20 Checklist; Back goes step by step
            await tap(A, '[data-mode=solo]')
            await expect(A.locator('.step-caption')).to_have_text('Step 1 of 5 · Conditions')
            await expect(A.locator(P('conditions'))).to_contain_text('27°')
            await tap(A, '[data-pillion=yes]')
            await expect(A.locator('.step-caption')).to_have_text('Step 2 of 5 · Checklist')
            await expect(A.locator(P('check'))).to_contain_text('Pillion helmet')
            await settle(); await tap(A, '.setup-head [aria-label=Back]')
            await expect(A.locator('.step-caption')).to_have_text('Step 1 of 5 · Conditions')
            await settle(); await tap(A, '.setup-head [aria-label=Back]')
            await expect(A.locator('.step-caption')).to_have_text('Start a ride')
            await settle()
            # group: 15 group → 17 select riders → 18 ready → 19 → 20 → 21 → 22 → 23 → 24
            await tap(A, '[data-mode=group]')
            await expect(A.locator('.step-caption')).to_have_text('Group ride · Your group')
            await expect(A.locator('.rider-row.selected')).to_contain_text('Weekend Riders')
            await tap(A, P('group') + ' .screen-foot .btn')
            await expect(A.locator('.step-caption')).to_have_text('Group ride · Who’s riding')
            await expect(A.locator('[data-select-riders] .rider-row.picked')).to_have_count(2)
            await shot(A, '04b-select-riders')
            await tap(A, P('riders') + ' .screen-foot .btn')
            await expect(A.locator(P('ready'))).to_contain_text('2 of 2 ready')
            await tap(A, P('ready') + ' .screen-foot .btn')
            await expect(A.locator('.step-caption')).to_have_text('Step 1 of 5 · Conditions')
            await tap(A, '[data-pillion=no]')
            ready = A.locator(P('check') + ' .screen-foot .btn.filled')
            await expect(ready).to_be_disabled()
            n = await A.locator('.check-item.req').count()
            assert n >= 9, f'expected required items, got {n}'
            for i in range(n):
                await A.locator('.check-item.req input').first.check()
            await expect(A.locator('.check-hero')).to_contain_text('All required items done')
            await expect(ready).to_be_enabled()
            await shot(A, '05-checklist')
            await tap(A, P('check') + ' .screen-foot .btn.filled')
            await expect(A.locator('.step-caption')).to_have_text('Step 3 of 5 · Headset')
            await expect(A.locator(P('headset') + ' [role=status], ' + P('headset') + ' .mini-meter')).to_be_visible()
            # 21: sound from the headset (default) or the phone speaker for car rides; watch mics never used
            await expect(A.locator(P('headset'))).to_contain_text('Sound comes from')
            await expect(A.locator(P('headset'))).to_contain_text('smartwatch')
            await tap(A, P('headset') + ' [aria-label="Sound comes from"] [data-value=speaker]')
            await expect(A.locator(P('headset'))).to_contain_text('For car rides')
            assert await A.evaluate("JSON.parse(localStorage.getItem('rylaide.audioOut'))") == 'speaker'
            await tap(A, P('headset') + ' [aria-label="Sound comes from"] [data-value=headset]')
            await tap(A, P('headset') + ' .screen-foot .btn')
            await expect(A.locator('.step-caption')).to_have_text('Step 4 of 5 · Where to')
            await A.fill('.search-bar input', 'nowhere')
            await expect(A.locator(P('where') + ' .empty')).to_contain_text('Nothing found', timeout=5000)
            await A.fill('.search-bar input', 'Sinhagad')
            await expect(A.locator(P('where') + ' .list-item').nth(1)).to_contain_text('Sinhagad', timeout=5000)
            await tap(A, P('where') + ' .list-item.tappable >> nth=1')
            await expect(A.locator('.step-caption')).to_have_text('Step 4 of 5 · Where to · Place')
            await expect(A.locator(P('place'))).to_contain_text('Sinhagad Fort')
            await expect(A.locator(P('place'))).to_contain_text('27°', timeout=5000)
            await shot(A, '05b-place')
            await tap(A, P('place') + ' >> text=See routes')
            await expect(A.locator('.route-opt')).to_have_count(3, timeout=8000)
            await expect(A.locator('.route-sheet')).to_contain_text('Step 5 of 5 · Route · Group ride · Royal Enfield Classic 350')
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
            await expect(B.locator('.snackbar', has_text='Asha started a ride')).to_be_visible(timeout=6000)
            # voice guidance button on the map (Google-Maps style): Sound on → Muted
            await tap(A, '.map-card .vg-btn')
            await tap(A, '.vg-menu [data-mode=off]')
            await expect(A.locator('.map-card .vg-btn')).to_have_attribute('data-voice-guide', 'off')
            assert await A.evaluate("window.__rylaide.engine.voiceGuide()") == 'off'
            await tap(A, '.map-card .vg-btn')
            await tap(A, '.vg-menu [data-mode=on]')
            await expect(A.locator('.map-card .vg-btn')).to_have_attribute('data-voice-guide', 'on')
        await step('Ride setup per Figma: 13 bike + type, 15–18 group, 19 conditions, 20 checklist, 21 headset, 22–23 place, 24 routes; voice mute on map', setup_flow())

        async def hub_views():
            await expect(A.locator('.hub-top .timer')).to_contain_text(re.compile(r'00:0\d:\d\d'))
            await expect(A.locator('.rider-pin[data-rider]')).to_have_count(1, timeout=8000)
            await shot(A, '07-hub-map')
            await tap(A, '[role=tab][data-value=speed]')
            await expect(A.locator('.gauge .readout')).to_contain_text('km/h')
            await tap(A, '[role=tab][data-value=group]')
            await expect(A.locator('.rider-row', has_text='Bilal')).to_contain_text(re.compile('away|with you'))
            await expect(A.locator('.rider-row', has_text='You')).to_contain_text(re.compile('Mic on|Talking'))
            await shot(A, '08-hub-group')
            # 28 full-screen group
            await tap(A, '.hub-content .btn.tonal')
            await expect(A.locator('[data-screen=ridegroup] .rider-row', has_text='Bilal')).to_contain_text('away')
            await expect(A.locator('[data-screen=ridegroup] .speed-chip').first).to_contain_text('km/h')
            await shot(A, '09b-fullscreen-group')
            await tap(A, '[data-screen=ridegroup] [aria-label="Close full screen"]')
            await expect(A.locator(f'{TOP}[data-screen=ride]')).to_be_visible()
            # 29 full-screen speedometer
            await tap(A, '[role=tab][data-value=speed]')
            await tap(A, '.speed-view .btn.tonal')
            await expect(A.locator('[data-screen=ridegauge] .gauge .readout')).to_contain_text('km/h')
            await shot(A, '09c-fullscreen-gauge')
            await tap(A, '[data-screen=ridegauge] [aria-label="Close full screen"]')
            # 25 full-screen map
            await tap(A, '[role=tab][data-value=map]')
            await tap(A, '.map-card .fs-btn')
            await expect(A.locator('[data-screen=ridemap] .ride-panel')).to_contain_text('km left')
            await expect(A.locator('[data-screen=ridemap] .vg-btn')).to_be_visible()
            await shot(A, '09-fullscreen')
            await tap(A, '[data-screen=ridemap] [aria-label="Close full screen"]')
            await expect(A.locator('[data-screen=ride]')).to_be_visible()
            await tap(A, '.nav-item[data-tab=home]') if await A.locator('.nav-item').first.is_visible() else None
            await tap(A, '[aria-label="Minimise ride"]')
            await expect(A.locator('.ride-bar')).to_contain_text('Ride in progress')
            await tap(A, '.ride-bar .btn')
            await expect(A.locator('[data-screen=ride]')).to_be_visible()
        await step('Ride hub: timer, rider on map, speed gauge, group view, 28/29/25 full screens, minimise + resume', hub_views())

        async def map_turns():
            # Default: the map turns with you. Turning the phone to face east (compass) turns the map to 90°.
            await tap(A, '[role=tab][data-value=map]') if await A.locator('[role=tab][data-value=map][aria-selected=false]').count() else None
            btn = '[data-screen=ride] .map-card .compass-btn'
            await expect(A.locator(f'{btn}[data-map-turns=true]')).to_be_visible(timeout=6000)
            bearing = "(() => { const m = document.querySelector('[data-screen=ride] .map-card .map').__rideMap?.map; return m ? m.getBearing() : null })()"
            await A.evaluate("""async () => { for (let i = 0; i < 60; i++) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 270, beta: 80, gamma: 0, absolute: true })); await new Promise(r => setTimeout(r, 16)); } }""")
            await A.wait_for_function(f"() => {{ const b = {bearing}; return b !== null && Math.abs(((b - 90) % 360 + 540) % 360 - 180) < 6 }}", timeout=6000)
            assert abs(await A.evaluate("window.__rylaide.ctx.heading.deg") - 90) < 3
            await shot(A, '09d-map-turns')
            # One tap: north up again (remembered).
            await tap(A, btn)
            await expect(A.locator(f'{btn}[data-map-turns=false]')).to_be_visible()
            await A.wait_for_function(f"() => Math.abs({bearing}) < 1", timeout=4000)
            assert await A.evaluate("JSON.parse(localStorage.getItem('rylaide.mapHeading'))") is False
            await tap(A, btn)
            await expect(A.locator(f'{btn}[data-map-turns=true]')).to_be_visible()
        await step('Map turns with you: compass heading rotates the map; one tap for north up, remembered', map_turns())

        async def live_voice():
            await A.wait_for_timeout(450)  # let the hub finish sliding in (300 ms)
            # Group ride: the mic is open on its own — no button to hold. (Chromium's fake mic beeps once a second.)
            await expect(A.locator('.mic-ctl[data-mic=live]')).to_be_visible(timeout=8000)
            await expect(A.locator('.mic-ctl')).to_contain_text(re.compile('Mic on|Talking'))
            assert await A.evaluate("window.__rylaide.engine.ptt.chain.rnnoise"), 'RNNoise noise cancel should be loaded'
            await A.wait_for_function("() => { const s = window.__rylaide.engine.voiceStats().mic; return s && s.opus && s.sent > 10 && s.spurts >= 1 }", timeout=8000)
            # B hears A live: Opus packets arrive, decode and play; A shows as speaking.
            await B.wait_for_function("() => { const p = window.__rylaide.engine.voiceStats().player; return p.packets > 10 && p.played > 5 }", timeout=8000)
            a_id = await A.evaluate("window.__rylaide.ctx.user.id")
            await B.wait_for_function(f"() => window.__rylaide.ctx.speakers.has('{a_id}')", timeout=6000, polling=40)
            await shot(A, '10-mic-on')
            # One tap mutes: the mic closes and nothing more is sent.
            await tap(A, '.mic-ctl')
            await expect(A.locator('.mic-ctl[data-mic=muted]')).to_contain_text('Muted')
            await expect(A.locator('.snackbar').last).to_contain_text('Mic muted')
            assert await A.evaluate("JSON.parse(localStorage.getItem('rylaide.micMuted'))") is True, 'mute is remembered'
            await A.wait_for_timeout(400)
            n0 = await B.evaluate("window.__rylaide.engine.voiceStats().player.packets")
            await A.wait_for_timeout(1800)
            n1 = await B.evaluate("window.__rylaide.engine.voiceStats().player.packets")
            assert n1 - n0 <= 2, f'muted mic still sending ({n1 - n0} packets)'
            assert await A.evaluate("window.__rylaide.engine.ptt.chain.stream === null"), 'mic released when muted'
            await shot(A, '10b-muted')
            # Tap again: live again.
            await tap(A, '.mic-ctl')
            await expect(A.locator('.mic-ctl[data-mic=live]')).to_be_visible(timeout=6000)
            await B.wait_for_function(f"() => window.__rylaide.engine.voiceStats().player.packets > {n1 + 5}", timeout=8000)
        await step('Live voice: mic open on group rides, B hears A (Opus, RNNoise), tap to mute / unmute, remembered', live_voice())

        async def sos():
            await tap(B, '.hero .btn')
            await tap(B, '[data-mode=quick]')
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
            await expect(B.locator(f'{TOP}[data-screen=ride]')).to_be_visible()
            await B.wait_for_timeout(500)  # hub slides back in (300 ms)
            await hold(B, '.sos-ctl', 1800)
            await tap(B, 'text=I’m OK, cancel')
            await A.wait_for_timeout(5500)
            await expect(A.locator('.sos-alert')).to_have_count(0)
        await step('SOS: tap refused, hold + countdown alerts group, cancel clears it', sos())

        async def arrived():
            await ctxA.set_geolocation({'latitude': 18.3663, 'longitude': 73.7559})
            await expect(A.locator('[data-screen=arrived]')).to_be_visible(timeout=8000)
            await expect(A.locator('[data-screen=arrived]')).to_contain_text('Sinhagad Fort')
            await shot(A, '11b-arrived')
            await tap(A, '[data-screen=arrived] button:has-text("Keep riding")')
            await expect(A.locator(f'{TOP}[data-screen=ride]')).to_be_visible()
            await expect(A.locator('.maneuver')).to_have_count(0)
            await ctxA.set_geolocation({'latitude': 18.5204, 'longitude': 73.8567})
        await step('Arrived: reaching the destination opens 32 Arrived; Keep riding drops directions', arrived())

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
            await tap(A, '[data-screen=garage] .veh-row')
            await tap(A, '[data-screen=vehicle] .list-item:has-text("Fuel log")')
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
            await expect(A.locator('[data-screen=vehicle] .stat-row')).to_contain_text('32,060', timeout=5000)
            await tap(A, f'{TOP} .topbar .icon-btn')
            await expect(A.locator('[data-screen=garage] .hero')).to_contain_text('32,060')
        await step('Fuel log: mileage, stats, duplicate blocked, odometer updates bike', fuel())

        async def vehicles():
            await tap(A, '[data-screen=garage] [aria-label="Add a vehicle"]')
            await A.fill('.sheet input[name=make]', 'Ather')
            await A.fill('.sheet input[name=model]', '450X')
            await expect(A.locator('.sheet select[name=type]')).to_have_value('ev-scooter')
            await A.fill('.sheet input[name=reg]', 'MH12 AB 1234')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('[data-screen=garage] .veh-row')).to_have_count(2, timeout=5000)
            await tap(A, '[data-screen=garage] .veh-row:has-text("450X")')
            await expect(A.locator('[data-screen=vehicle]')).to_contain_text('MH12 AB 1234')
            await tap(A, '[data-screen=vehicle] .list-item:has-text("Service")')
            await tap(A, '[data-screen=service] .fab')
            await A.select_option('.sheet select[name=type]', 'oil')
            await A.fill('.sheet input[name=odometer]', '1200')
            await A.fill('.sheet input[name=nextKm]', '1400')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('[data-screen=service]')).to_contain_text('in 200 km', timeout=5000)
            await tap(A, f'{TOP} .topbar .icon-btn')
            await expect(A.locator('[data-screen=vehicle] .banner.warn')).to_contain_text('Engine oil due soon', timeout=5000)
            await tap(A, f'{TOP} .topbar .icon-btn')
            # switch the bike on Home
            await tap(A, '.nav-item[data-tab=home]')
            await tap(A, '[data-screen=home] [aria-label="Switch vehicle"]')
            await tap(A, '.sheet .list-item:has-text("450X")')
            await expect(A.locator('[data-screen=home] .hero')).to_contain_text('450X', timeout=5000)
            await shot(A, '13b-home-switched')
            await tap(A, '[data-screen=home] [aria-label="Switch vehicle"]')
            await tap(A, '.sheet .list-item:has-text("Classic 350")')
            await expect(A.locator('[data-screen=home] .hero')).to_contain_text('Classic 350', timeout=5000)
            await tap(A, '.nav-item[data-tab=garage]')
        await step('Garage: second vehicle, service reminder, switch the bike on Home', vehicles())

        async def quick_refill_history_support():
            # 25q quick ride: Map · Speed only, log a refill, 34q summary shows it
            await tap(A, '.nav-item[data-tab=home]')
            await tap(A, '[data-screen=home] .hero .btn')
            await tap(A, '[data-mode=quick]')
            await expect(A.locator(f'{TOP}[data-screen=ride]')).to_be_visible()
            await expect(A.locator('.hub-switch [role=tab]')).to_have_count(2)
            await tap(A, '[data-refill]')
            await A.fill('.sheet input[name=litres]', '5')
            await A.fill('.sheet input[name=price]', '105')
            await tap(A, '.sheet button[type=submit]')
            await expect(A.locator('[data-refill]')).to_contain_text('Refills 1', timeout=5000)
            for i in range(1, 5):
                await ctxA.set_geolocation({'latitude': 18.5204 + i * 0.0007, 'longitude': 73.8567})
                await A.wait_for_timeout(1100)
            await tap(A, f'{TOP} .hub-top .btn')
            await tap(A, '.dialog .btn >> nth=1')
            await expect(A.locator('[data-screen=summary] .summary-hero')).to_contain_text('Quick ride', timeout=8000)
            await expect(A.locator('[data-screen=summary] [data-refills]')).to_contain_text('1 refill')
            await shot(A, '13c-quick-summary')
            await tap(A, '[data-screen=summary] >> text=View in history')
            # 36 History: filter by bike
            await expect(A.locator('[data-screen=history] .bike-filter .chip')).to_have_count(3)
            await A.wait_for_timeout(500)  # tab fades in and refreshes
            await tap(A, '[data-screen=history] .chip:has-text("450X")')
            await expect(A.locator(f'{TOP}[data-screen=history]')).to_contain_text('No rides on this bike yet', timeout=5000)
            await tap(A, '[data-screen=history] .chip[data-bike=all]')
            await expect(A.locator(f'{TOP}[data-screen=history] .list-item').first).to_contain_text('Classic 350', timeout=5000)
            # 58d contact support without any email
            await tap(A, '.nav-item[data-tab=home]')
            await tap(A, '[data-screen=home] [aria-label=Settings]')
            await tap(A, '[data-screen=settings] [data-page=care]')
            await tap(A, '[data-screen=care] >> text=Contact support')
            await A.fill('[data-screen=careemail] textarea', 'Voice cut out on the ghat section')
            await tap(A, '[data-screen=careemail] .screen-foot .btn')
            await expect(A.locator('[data-screen=caresent]')).to_contain_text(re.compile(r'R-[A-Z0-9]{5}'), timeout=5000)
            assert ('rel' + 'aide') not in (await A.content()).lower()  # old spelling must be gone
            await tap(A, '[data-screen=caresent] .btn')
            await A.wait_for_timeout(350)
            await tap(A, '[data-screen=care] [aria-label=Back]')
            await A.wait_for_timeout(350)
            await tap(A, '[data-screen=settings] [aria-label=Back]')
            await expect(A.locator(f'{TOP}[data-screen=home]')).to_be_visible()
            await tap(A, '.nav-item[data-tab=garage]')
        await step('Quick ride 25q with refill → 34q summary; History by bike; support report without email', quick_refill_history_support())

        async def settings():
            await tap(A, '[data-screen=garage] [aria-label=Settings]')
            await tap(A, '[data-screen=settings] [data-page=appearance]')
            await tap(A, '[data-screen=appearance] .list-item:has-text("Glove Mode") input')
            assert await A.evaluate("document.documentElement.classList.contains('glove')")
            await tap(A, '[data-screen=appearance] [role=tab][data-value=dark]')
            assert await A.evaluate("document.documentElement.dataset.light") == 'night'
            await tap(A, '[data-screen=appearance] .swatch[aria-label=Orange]')
            assert (await A.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary')")).strip().lower() == '#ff8f3a'
            await shot(A, '14-settings-dark')
            await A.reload()
            await expect(A.locator('[data-screen=home]')).to_be_visible(timeout=8000)
            assert await A.evaluate("document.documentElement.classList.contains('glove') && document.documentElement.dataset.light === 'night'")
            await tap(A, '[data-screen=home] .hero .btn')
            await tap(A, '[data-mode=quick]')
            await A.wait_for_timeout(450)
            w = await A.evaluate("document.querySelector('.ride-control .ctl').getBoundingClientRect().width")
            assert w >= 79, f'glove mode ride controls should be 80 dp, got {w}'
            await shot(A, '15-glove-night-hub')
            await tap(A, f'{TOP} .hub-top .btn')
            await tap(A, '.dialog .btn >> nth=1')
        await step('Settings: Glove Mode 80 dp, Night theme, accent, persist after reload', settings())

        async def smartwatch():
            # The Android app's bridge, stood in for: watch notifications are recorded instead of posted.
            await A.evaluate("""window.__watch = []; window.RylaideAndroid = {
                watchNotify: (t, x, k) => window.__watch.push([t, x, k]), watchClear: () => window.__watch.push(['clear']),
                watchSetup: () => { window.__watch.push(['setup']); return true }, speak() {}, vibrate() {}, keepAwake() {},
                rideStart: (w) => window.__watch.push(['ride', w]), rideStop: () => window.__watch.push(['ridestop']),
                watchDisplay: (a, b, c) => (window.__disp ||= []).push([a, b, c]), watchDisplayOn: () => {} }""")
            await A.wait_for_timeout(1200)  # the last ride's summary finishes opening first
            await A.evaluate("window.__rylaide.router.push('riding')")
            await expect(A.locator(f'{TOP}[data-screen=riding]')).to_contain_text('Show on my watch')
            await tap(A, '[data-screen=riding] .list-item:has-text("Show on my watch") input')
            await expect(A.locator('.snackbar').last).to_contain_text('Sent a test')
            await tap(A, '[data-screen=riding] .list-item:has-text("Send a test to my watch")')
            await shot(A, '14b-watch-settings')
            got = [w for w in await A.evaluate("window.__watch") if w not in (['clear'], ['ridestop'])]
            assert got[0] == ['setup'] and got[1][0] == 'Test from Rylaide', got
            # A rider's SOS buzzes the watch once, even if the same alert arrives again (reconnect).
            await A.evaluate("""() => { const rt = window.__rylaide.rt; const a = { userId: 'u_test_sos', name: 'Bilal', lat: 18.52, lng: 73.85, ts: Date.now() };
                rt.emit('sos', { alert: a }); rt.emit('sos', { alert: { ...a } }); rt.emit('sos_cancel', { userId: 'u_test_sos' }) }""")
            sos = await A.evaluate("window.__watch.filter(w => w[2] === 'sos')")
            assert len(sos) == 1 and 'Bilal' in sos[0][0], sos
            # Ride on the watch's music screen: pages, the watch's buttons, and the app's own GPS (phone in a pocket).
            await tap(A, '[data-screen=riding] .list-item:has-text("music screen") input')
            await A.evaluate("window.__rylaide.engine.startRide({ quick: true, solo: true })")
            await A.wait_for_function("(window.__disp || []).length > 0", timeout=3000)
            assert ['ride', True] in await A.evaluate("window.__watch"), 'ride service started with the watch display'
            await A.evaluate("window.__rylaideRide.position(JSON.stringify({ lat: 18.5310, lng: 73.8450, acc: 5, speed: 12.5, heading: 90, ts: Date.now() }))")
            await A.wait_for_function("window.__disp.some(d => d[0] === '45 km/h')", timeout=4000)
            assert await A.evaluate("window.__rylaide.ctx.pos.lat") == 18.531, 'app GPS fixes drive the ride'
            n = await A.evaluate("window.__disp.length")
            await A.evaluate("window.__rylaideRide.button('next')")  # solo quick ride: one page, stays on speed
            assert (await A.evaluate("window.__disp[window.__disp.length - 1][0]")) == '45 km/h'
            await A.evaluate("window.__rylaide.engine.endRide()")
            assert ['ridestop'] in await A.evaluate("window.__watch")
            await A.evaluate("delete window.RylaideAndroid; window.__rylaide.router.back()")
        await step('Smartwatch: notifications (test, group SOS once), ride on the watch music screen, app GPS with the screen off', smartwatch())

        async def offline():
            await tap(B, '[data-screen=home] .hero .btn') if await B.locator('[data-screen=home]').is_visible() else None
            await tap(B, '[data-mode=quick]')
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

        async def pillion_and_crash():
            await tap(B, '[data-screen=home] .hero .btn')
            await tap(B, '[data-mode=solo]')
            await tap(B, '[data-pillion=yes]')
            await B.wait_for_timeout(400)
            await tap(B, '[data-screen=setup] [data-page=check] >> text=Skip for now')
            await B.wait_for_timeout(400)
            await tap(B, '[data-screen=setup] [data-page=headset] .screen-foot .btn')
            await B.wait_for_timeout(400)
            await tap(B, 'text=Ride without a destination')
            await expect(B.locator('[data-screen=ride] [role=tab][data-value=pillion]')).to_be_visible()
            await tap(B, '[role=tab][data-value=pillion]')
            await expect(B.locator('.break-card')).to_contain_text('Next break')
            await B.fill('.inline-input', 'Sana')
            await shot(B, '16b-pillion')
            # a hard impact while riding, then no movement → 30a countdown; cancel
            await B.evaluate("window.__rylaide.engine.crash.suspect(4.2)")
            await expect(B.locator('[data-screen=crash]')).to_contain_text('Possible crash detected', timeout=9000)
            await shot(B, '16c-crash')
            await tap(B, '[data-screen=crash] >> text=I’m OK, cancel')
            await expect(B.locator(f'{TOP}[data-screen=ride]')).to_be_visible()
            await tap(B, f'{TOP} .hub-top .btn')
            await tap(B, '.dialog .btn >> nth=1')
        await step('Pillion ride: 25u Pillion tab with breaks; crash detection countdown and cancel', pillion_and_crash())

        async def leave_and_session():
            await tap(B, '.nav-item[data-tab=groups]')
            await tap(B, '[data-screen=groups] .list-item')
            await tap(B, f'{TOP} [aria-label="Group info"] >> nth=-1')
            await tap(B, '[data-screen=groupinfo] >> text=Leave group')
            await tap(B, '.dialog .btn >> nth=1')
            await expect(B.locator('[data-screen=groups] .empty')).to_contain_text('No groups yet', timeout=5000)
            await A.wait_for_function("() => window.__rylaide.ctx.group.members.length === 1", timeout=5000)
            await A.set_viewport_size({'width': 1280, 'height': 800})
            await shot(A, '17-desktop')
            acc = await B.evaluate("fetch('/api/me/account', {headers: {authorization: 'Bearer ' + JSON.parse(localStorage.getItem('rylaide.token'))}}).then(r => r.json())")
            await B.evaluate("localStorage.setItem('rylaide.token', JSON.stringify('bogus'))")
            await B.reload()
            await expect(B.locator('[data-screen=welcome]')).to_be_visible(timeout=10000)
            # 05 Sign in on the "new phone" with the account code
            for _ in range(2): await tap(B, 'text=Next')
            await tap(B, 'text=Get started')
            await tap(B, '[data-screen=terms] .cbox input')
            await tap(B, 'text=Agree and continue')
            await expect(B.locator('[data-screen=signin]')).to_contain_text('Already riding with Rylaide')
            await B.fill('[data-screen=signin] input', 'AAAAAAAA')
            await tap(B, '[data-screen=signin] button[type=submit]')
            await expect(B.locator('[data-screen=signin] .field.error')).to_contain_text('doesn’t match', timeout=5000)
            await B.fill('[data-screen=signin] input', acc['code'].replace('-', ''))
            await expect(B.locator('[data-screen=signin] input')).to_have_value(acc['code'])
            await tap(B, '[data-screen=signin] button[type=submit]')
            await expect(B.locator('[data-screen=home] .home-head')).to_contain_text('Bilal', timeout=8000)
            await expect(B.locator('[data-screen=home] .hero')).to_have_attribute('style', re.compile(r'/photos/'))
        await step('Leave group, desktop layout, expired session, sign back in with the account code', leave_and_session())

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
