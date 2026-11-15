"""End-to-end browser check for Gully Sixes.

Opens the built game in headless Chrome, walks every screen, plays full matches with a
scripted batter and fails on any page error. Needs Python with Playwright and a Chrome
binary:  python3 tools/e2e.py [output-folder-for-screenshots]
"""
import json, os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else None
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--disable-background-networking"]
# The game is stepped by hand so the test does not depend on the speed of software rendering.
STEP = "(n)=>{const g=__gs.game; for(let i=0;i<n;i++) g.update(1/60); return {s:g.state, ph:g.play&&g.play.phase, runs:g.match&&g.match.runs, legal:g.match&&g.match.legal};}"
RENDER = "()=>{const g=__gs.game; g.renderer.render(g.scene,g.camera); const i=g.renderer.info.render; return {calls:i.calls, tris:i.triangles, level:g.level};}"
failures = []

def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond: failures.append(msg)

def click(pg, sel):
    ok = pg.evaluate("(s)=>{const e=document.querySelector(s); if(!e) return false; e.click(); return true;}", sel)
    check(ok, "click " + sel)

def shot(pg, name):
    if not OUT: return
    os.makedirs(OUT, exist_ok=True)
    pg.evaluate(RENDER); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(OUT, name + ".png"))

def play_out(pg, limit=3000):
    st = None
    for _ in range(limit):
        st = pg.evaluate(STEP, 30)
        if st["s"] == "ended": break
    return st

def bot(pg, kind):
    scripts = {
        "ace": "(play)=>({aim:0, loft:true, offset:0})",
        "mixed": "(play,m)=>{const k=m.seq%5; return {aim:[0,0.5,-0.5,0.2,0][k], loft:k<2, offset:[0,0.03,-0.04,0.0,0.05][k]};}",
        "none": "null",
    }
    pg.evaluate("()=>{__gs.game.auto=" + scripts[kind] + ";}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS)

    print("phone, first visit")
    ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=1)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("file://" + ROOT + "/index.html"); pg.wait_for_timeout(1200)
    info = pg.evaluate(RENDER)
    check(info["calls"] < 120, "draw calls stay low (%d)" % info["calls"])
    check(pg.evaluate("document.querySelector('.rules') !== null"), "help shows on first visit")
    click(pg, "[data-act=home]"); shot(pg, "home")
    for scr in ["levels", "practice", "shop", "trophies", "settings", "help"]:
        click(pg, "[data-act=%s]" % scr); shot(pg, scr); click(pg, "[data-act=home]")

    print("settings")
    click(pg, "[data-act=settings]")
    for key in ["sound", "guide", "hand", "controls", "quality", "quality", "quality", "hand", "sound", "guide", "controls"]:
        click(pg, "[data-act=toggle][data-arg=%s]" % key)
    s = pg.evaluate("__gs.store.data.settings")
    check(s["quality"] == "auto" and s["hand"] == "R" and s["sound"] and s["guide"] and s["controls"] == "swipe", "toggles cycle back to defaults")
    pg.evaluate("__gs.game.setQuality('low')"); shot(pg, "fast-graphics-menu")
    check(pg.evaluate("__gs.game.level") == 0, "fast graphics applies at once")
    pg.evaluate("__gs.game.setQuality('high')")
    click(pg, "[data-act=home]")

    print("real input: swipe, tap, keyboard, buttons")
    def to_live():
        for _ in range(500):
            st = pg.evaluate(STEP, 2)
            if st["s"] == "live": return
    def next_ball():
        for _ in range(400):
            st = pg.evaluate(STEP, 4)
            if st["s"] == "runup": break
        to_live()
    swing = "(()=>{const s=__gs.game.play.swing; return s ? {aim:+s.aim.toFixed(2), loft:s.loft} : null;})()"
    click(pg, "[data-act=practice]"); click(pg, "[data-act=playPractice][data-arg=rookie]")
    to_live()
    pg.mouse.move(200, 600); pg.mouse.down(); pg.mouse.move(262, 520, steps=3); pg.mouse.up()
    sw = pg.evaluate(swing); check(sw is not None and sw["aim"] > 0.3, "a swipe to the right swings to the right (%s)" % sw)
    next_ball(); pg.mouse.click(200, 500)
    sw = pg.evaluate(swing); check(sw is not None and sw["aim"] == 0, "a plain tap swings straight (%s)" % sw)
    next_ball(); pg.keyboard.down("Shift"); pg.keyboard.press("ArrowLeft"); pg.keyboard.up("Shift")
    sw = pg.evaluate(swing); check(sw is not None and sw["aim"] < 0 and sw["loft"], "Shift + left arrow lofts to the left (%s)" % sw)
    pg.evaluate("__gs.store.setSetting('controls','tap')")
    next_ball(); pg.mouse.move(350, 500); pg.mouse.down()
    sw = pg.evaluate(swing); check(sw is not None and sw["aim"] > 0.5, "tap controls: touching the right side swings right at once (%s)" % sw)
    pg.mouse.up(); pg.evaluate("__gs.store.setSetting('controls','swipe')")
    print("stance")
    # Steps until a newly bowled ball is in the air (the page also runs on its own clock, so
    # the test waits for a new ball object rather than counting frames).
    def fresh_ball():
        pg.evaluate("()=>{window.__old=__gs.game.play;}")
        for _ in range(900):
            st = pg.evaluate("(n)=>{const g=__gs.game; for(let i=0;i<n;i++) g.update(1/60); return {s:g.state, fresh:g.play!==window.__old};}", 3)
            if st["fresh"] and st["s"] == "live": return
    force = "()=>{const m=__gs.game.match; if(!m.__orig) m.__orig=m.nextPlay.bind(m); m.nextPlay=(h)=>{ for(let i=0;i<900;i++){ const p=m.__orig(h); if(%s) { %s return p; } } return m.__orig(h); };}"
    fresh_ball()
    pg.keyboard.down("c"); pg.evaluate(STEP, 12); pg.keyboard.up("c")
    st1 = pg.evaluate("__gs.game.stance")
    check(st1 > 0.2, "holding C moves the batter across (%.2f m)" % st1)
    pg.evaluate(STEP, 5)
    check(abs(pg.evaluate("__gs.game.stance") - st1) < 1e-6, "the batter stops when the key is released")
    box = pg.evaluate("(()=>{const r=document.getElementById('moveL').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2, r.width];})()")
    check(box[2] > 40, "move buttons are shown on touch screens")
    pg.mouse.move(box[0], box[1]); pg.mouse.down()
    for _ in range(100):
        pg.evaluate(STEP, 6)
        if pg.evaluate("__gs.game.stance") <= -0.549: break
    check(abs(pg.evaluate("__gs.game.stance") + 0.55) < 0.01, "holding the left button moves to the limit and no further")
    check(pg.evaluate("Math.abs(__gs.game.batter.kid.group.position.x - (-0.4 + __gs.game.stance)) < 0.02"), "the batter model follows the stance")
    shot(pg, "stance-left")
    pg.mouse.up()
    check(pg.evaluate("__gs.game.moveDir") == 0, "releasing the button stops the movement")

    print("no ball, free hit and wide")
    pg.evaluate(force % ("!p.d.wideBall", "p.d.noBall=true;"))
    fresh_ball()                                   # the no ball is in the air
    pg.evaluate(force % ("!p.d.wideBall && !p.d.noBall", ""))
    check(pg.evaluate("document.getElementById('call').textContent.includes('NO BALL')"), "a no ball is called as the ball is released")
    shot(pg, "no-ball-call")
    fresh_ball()                                   # the free hit is in the air
    last = pg.evaluate("__gs.game.match.log[__gs.game.match.log.length-1]")
    check(last["noBall"] and last["runs"] >= 1 and last["out"] is None, "the no ball adds a run and takes no wicket (%s)" % json.dumps(last))
    check(pg.evaluate("__gs.game.play.freeHit && !document.getElementById('freeHit').hidden"), "the next ball is a free hit and the badge shows")
    shot(pg, "free-hit")
    legal_before = pg.evaluate("__gs.game.match.legal")
    pg.evaluate(force % ("p.d.wideBall && !p.d.noBall", ""))
    fresh_ball()                                   # a wide is in the air
    pg.evaluate("()=>{const m=__gs.game.match; m.nextPlay=m.__orig;}")
    last = pg.evaluate("__gs.game.match.log[__gs.game.match.log.length-1]")
    check(last["out"] is None, "nothing on a free hit is out (%s)" % json.dumps(last))
    check(pg.evaluate("__gs.game.match.legal") == legal_before + 1 and not pg.evaluate("__gs.game.match.freeHit"), "the free hit is used up by a legal ball")
    check(pg.evaluate("__gs.game.play.d.wideBall && document.getElementById('freeHit').hidden"), "a wide delivery is bowled and the badge is gone")
    fresh_ball()
    last = pg.evaluate("__gs.game.match.log[__gs.game.match.log.length-1]")
    check(last["wide"] and last["runs"] == 1, "a ball outside the wide line that is not hit is a wide (%s)" % json.dumps(last))
    check(pg.evaluate("[...document.querySelectorAll('#hOver i.extra')].length") >= 1, "extras are marked in the over tracker")

    pg.click("#loftBtn", timeout=30000); check(pg.evaluate("__gs.game.loft") is True, "the loft button toggles")
    pg.click("#pauseBtn", timeout=30000); check(pg.evaluate("__gs.game.paused && !document.getElementById('pause').hidden"), "the pause button pauses")
    pg.keyboard.press("Escape"); check(not pg.evaluate("__gs.game.paused"), "Escape resumes")
    pg.evaluate("()=>{const g=__gs.game; const e=g.renderer.getContext().getExtension('WEBGL_lose_context'); if(e){ window.__lost=e; e.loseContext(); }}")
    pg.wait_for_timeout(500)
    check(pg.evaluate("!window.__lost || (__gs.game.contextLost && __gs.game.paused)"), "losing the graphics context pauses the game")
    pg.evaluate("()=>{ if(window.__lost) window.__lost.restoreContext(); }"); pg.wait_for_timeout(1000)
    check(pg.evaluate("!__gs.game.contextLost && !__gs.game.dead"), "the game recovers when the context returns")
    pg.evaluate("()=>__gs.game.pause(true)")
    click(pg, "[data-act=home]")

    print("chase level 1")
    click(pg, "[data-act=levels]"); click(pg, "[data-act=level][data-arg='0']"); shot(pg, "level")
    bot(pg, "ace")
    click(pg, "[data-act=playLevel]")
    check(pg.evaluate("__gs.game.guide") is True, "timing guide is on for the first level")
    for _ in range(300):
        st = pg.evaluate(STEP, 3)
        if st["s"] == "live": break
    pg.evaluate(STEP, 10); shot(pg, "live-guide")
    check(pg.evaluate("__gs.game.ringOut.visible"), "guide ring is visible while the ball is in the air")
    st = play_out(pg)
    r = pg.evaluate("({reason:__gs.game.match.reason, stars:__gs.game.match.stars(), runs:__gs.game.match.runs})")
    check(r["reason"] == "won" and r["stars"] >= 1, "level 1 can be won (%s)" % json.dumps(r))
    shot(pg, "result-chase")
    check(pg.evaluate("__gs.store.data.stars[0]") >= 1, "stars are saved")
    click(pg, "[data-act=home]")

    print("daily challenge")
    bot(pg, "mixed")
    click(pg, "[data-act=daily]")
    for _ in range(200):
        st = pg.evaluate(STEP, 10)
        if st["ph"] == "struck": break
    shot(pg, "live-struck")
    pg.evaluate("()=>__gs.game.pause(true)"); shot(pg, "pause")
    before = pg.evaluate("__gs.game.time"); pg.wait_for_timeout(300)
    check(pg.evaluate("__gs.game.paused"), "pause holds the game")
    click(pg, "[data-act=resume]")
    st = play_out(pg)
    m = pg.evaluate("({reason:__gs.game.match.reason, legal:__gs.game.match.legal, wk:__gs.game.match.wickets, runs:__gs.game.match.runs, log:__gs.game.match.log.map(l=>l.out?'W':l.wide?'wd':l.runs).join(' ')})")
    print("     ", m)
    check(m["reason"] in ("overs", "allout"), "daily innings ends on overs or wickets")
    check(m["legal"] == 24 or m["wk"] == 3, "daily is 24 balls or 3 wickets")
    shot(pg, "result-daily")
    text = pg.evaluate("__gs.ui.shareText()")
    check(text.startswith("Gully Sixes Daily #"), "share text is produced")
    check(pg.evaluate("!!document.querySelector('a.wa') && document.querySelector('a.wa').href.startsWith('https://wa.me/?text=')"), "WhatsApp share link is present")
    click(pg, "[data-act=home]"); shot(pg, "home-after-daily")
    check(pg.evaluate("!!document.querySelector('.week i.today')"), "seven-day strip appears after a daily game")

    print("super over")
    bot(pg, "ace")
    click(pg, "[data-act=superover]")
    st = play_out(pg)
    so = pg.evaluate("({legal:__gs.game.match.legal, wk:__gs.game.match.wickets, runs:__gs.game.match.runs, best:__gs.store.data.superBest, theme:__gs.game.match.cfg.theme})")
    print("     ", so)
    check(so["legal"] <= 6 and so["best"] == so["runs"], "super over is six balls and saves the best")
    shot(pg, "result-superover")
    click(pg, "[data-act=again]")
    check(pg.evaluate("__gs.game.state") != "menu", "another over starts")
    pg.evaluate("()=>__gs.game.pause(true)")
    click(pg, "[data-act=home]")
    check(pg.evaluate("__gs.game.state") == "menu", "quitting from pause returns to the menu")

    print("survival")
    bot(pg, "none")
    click(pg, "[data-act=survival]")
    st = play_out(pg)
    sv = pg.evaluate("({reason:__gs.game.match.reason, wk:__gs.game.match.wickets})")
    check(sv["reason"] == "allout" and sv["wk"] == 3, "survival ends after three wickets")
    click(pg, "[data-act=home]")

    print("saved data")
    d = pg.evaluate("(()=>{const d=__gs.store.data; return {coins:d.coins, stars:d.stars, streak:d.streak, ach:Object.keys(d.achievements).length, innings:d.stats.innings};})()")
    print("     ", d)
    check(d["coins"] > 0 and d["streak"] == 1 and d["innings"] >= 4, "coins, streak and stats are recorded")
    pg.reload(); pg.wait_for_timeout(1000)
    check(pg.evaluate("__gs.store.data.coins") == d["coins"], "progress survives a reload")
    check(pg.evaluate("document.querySelector('.rules') === null"), "help is not shown again")
    check(len(errs) == 0, "no page errors on phone (%s)" % errs[:3])
    ctx.close()

    print("landscape phone and desktop, challenge link, left hand, night")
    for name, vp in [("landscape", {"width": 844, "height": 390}), ("desktop", {"width": 1366, "height": 768})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=1)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("if(!localStorage.getItem('gullySixes.save.v1')) localStorage.setItem('gullySixes.save.v1', JSON.stringify({settings:{hand:'L', quality:'high'}, seenHelp:true, stars:[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3]}))")
        pg.goto("file://" + ROOT + "/index.html"); pg.wait_for_timeout(900)
        today = pg.evaluate("Math.floor((Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - Date.UTC(2026,10,15))/86400000)")
        pg.goto("file://" + ROOT + "/index.html#beat-%d-31-Rohan" % today); pg.reload(); pg.wait_for_timeout(900)
        check(pg.evaluate("!!document.querySelector('.challenge') && document.querySelector('.challenge').textContent.includes('Rohan')"), name + ": challenge banner shows")
        shot(pg, name + "-home")
        click(pg, "[data-act=levels]"); click(pg, "[data-act=level][data-arg='12']"); click(pg, "[data-act=playLevel]")
        check(pg.evaluate("__gs.game.world.themeName") == "night" and pg.evaluate("__gs.game.world.fairy.visible"), name + ": festival night level uses the night theme")
        bot(pg, "ace")
        for _ in range(300):
            st = pg.evaluate(STEP, 6)
            if st["ph"] == "struck": break
        pg.evaluate(STEP, 40); shot(pg, name + "-night")
        st = play_out(pg); shot(pg, name + "-night-result")
        check(st["s"] == "ended", name + ": night chase finishes")
        check(len(errs) == 0, name + ": no page errors (%s)" % errs[:3])
        ctx.close()
    b.close()

print("\n%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
