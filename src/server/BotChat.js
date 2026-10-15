// ============================================================================
//  BOT CHAT — social-deduction banter for Humanlike bots.
//
//  Bots only say things they could plausibly know:
//    • their own faction knowledge (Blood Pact, inspections, flogging) via Bots.trust()
//    • public information (who nominated whom, the sacrificed captive's faction/curse)
//    • what they OBSERVED during the Work Phase (player.obs: idle time, abandoned tasks, finished tasks)
//  and they LIE when it suits them: an Executioner who threw an opposing captive or triggered a
//  harmful curse bluffs about the captive it did NOT choose (the one nobody can inspect) or about
//  which side it threw; hostile bots scapegoat players with invented evidence; accused bots deny.
//
//  Every spoken line is kept in `log` with a `lie` flag so tests (and curious devs) can audit it.
// ============================================================================
import { PHASE, CER, FACTIONS, FACTION_INFO, CURSES } from '../shared/constants.js';
import { pick, rand } from './util.js';

const L = arr => pick(arr);
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '?');
export const HARMFUL = new Set(['TOXIC_FUMES', 'MANA_DRAIN', 'GAGGING_SEAL']);
const SCARY = ['TOXIC_FUMES', 'MANA_DRAIN', 'GAGGING_SEAL'];
// words that actually accuse someone (nomination chatter like "mutiny" / "vote" does not)
const ACCUSE_WORDS = /\b(sus|suspect|suspicious|liar|lying|lie|lied|idle|idling|standing|loitering|traitor|cultist|fishy|shifty|explain|why|blame|guilty|slacking|lazy|abandon(ed)?|walk(ed)? off|don'?t trust|not who)\b|\?/i;
const FACTION_ACCUSE = /\b(is|are|you'?re|youre|must be|looks?)\s+(a\s+)?(fire|blood|chaos)\b/i;
// bot-to-bot lines that can provoke an answer (never defences, nominations or announcements → no ping-pong)
const PROVOKING = new Set(['suspect', 'scapegoat', 'react']);

export class BotChat {
  constructor(m) { this.m = m; this.log = []; this.reset(); }

  reset() {
    this.speaking = null; this.recent = [];
    this.q = []; this.lastAny = -99; this.cd = new Map(); this.said = new Map();   // botId → {ceremony, n}
    this.outcome = null; this.debateEnd = 0; this.debateMsgs = 0;
  }

  get enabled() { return this.m.dbg.botChat !== false && this.m.dbg.botMode === 'human'; }
  get brain() { return this.m.bots; }
  bots() { return this.m.list.filter(p => p.isBot && !p.ghost); }
  nm(p) { return p?.name ?? '?'; }
  think(scale = 1) { return this.brain.think() * scale; }
  side(n) { return n.x < -0.3 ? 'west' : n.x > 0.3 ? 'east' : 'middle'; }

  /** Is this outcome bad for bot b's cult (opposing captive, or a curse that hurts the Executioner)? */
  badFor(b, faction, curse, counted = true) {
    if (HARMFUL.has(curse)) return true;
    if (faction === FACTIONS.CHAOS) return false;
    if (b.faction === FACTIONS.CHAOS) {                       // Chaos wants Fire = Blood: bad if this widens the gap
      const T = this.m.tally, other = faction === FACTIONS.FIRE ? FACTIONS.BLOOD : FACTIONS.FIRE;
      return (T[faction] + (counted ? 0 : 1)) - T[other] >= 2;
    }
    return faction !== b.faction;
  }

  // ----------------------------------------------------------------------- scheduler
  /** Run a line generator until it yields wording nobody used recently (keeps bots from echoing each other). */
  uniq(gen) {
    let r;
    for (let i = 0; i < 8; i++) { r = gen(); const t = typeof r === 'string' ? r : r?.text; if (!t || !this.recent.includes(t)) break; }
    return r;
  }
  say(b, text, delay = 0, { kind = 'say', lie = false, ttl = 10, allowWork = false } = {}) {
    if (!this.enabled || !b?.isBot) return;
    const m = this.m;
    if (kind !== 'exec' && kind !== 'exec-debate' && this.recent.includes(text)) return;          // already said by someone
    this.recent.push(text); if (this.recent.length > 16) this.recent.shift();
    this.q.push({ id: b.id, text, at: m.time + delay, exp: m.time + delay + ttl, kind, lie, allowWork, ceremony: m.ceremonyIndex });
  }

  tick() {
    if (!this.q.length) return;
    const m = this.m;
    if (!this.enabled) { this.q = []; return; }
    this.q = this.q.filter(e => e.exp > m.time);
    if (m.time - this.lastAny < 1.15) return;
    const i = this.q.findIndex(e => e.at <= m.time);
    if (i < 0) return;
    const e = this.q.splice(i, 1)[0], b = m.P(e.id);
    if (!b || b.ghost || b.muted || b.gagged) return;
    if (m.phase === PHASE.WORK && !e.allowWork) return;
    if (m.phase !== PHASE.WORK && m.phase !== PHASE.CEREMONY) return;
    if ((this.cd.get(b.id) ?? 0) > m.time && e.kind !== 'exec') { this.q.push({ ...e, at: m.time + 1.2 }); return; }   // per-bot breather
    this.lastAny = m.time; this.cd.set(b.id, m.time + 3);
    this.log.push({ at: +m.time.toFixed(1), bot: b.name, text: e.text, kind: e.kind, lie: e.lie });
    if (this.log.length > 400) this.log.shift();
    this.speaking = e.kind;
    try { m.chat(b, e.text); } finally { this.speaking = null; }
  }

  /** At most `max` ceremony-related lines per bot per ceremony. */
  budget(b, max, pool = 'said') {
    const k = pool + b.id, s = this.said.get(k);
    if (!s || s.ceremony !== this.m.ceremonyIndex) { this.said.set(k, { ceremony: this.m.ceremonyIndex, n: 0 }); return max > 0; }
    return s.n < max;
  }
  spend(b, pool = 'said') { const s = this.said.get(pool + b.id); if (s) s.n++; }

  // ----------------------------------------------------------------------- nomination
  onNomination(master, exec, by) {
    if (!this.enabled) return;
    const m = this.m, B = this.brain;
    // The Master explains the pick
    if (master?.isBot && exec) {
      const t = B.trust(master, exec);
      const lines = t > 0 || master.faction === exec.faction
        ? [`${exec.name}, you're my Executioner. I know you'll choose wisely.`, `I trust ${exec.name} with this. Don't let us down.`]
        : [`${exec.name} — steady hands, I hope. Executioner.`, `Going with ${exec.name}. Nothing personal to anyone.`, `${exec.name} has been pulling their weight. You're up.`, `I watched ${exec.name} work. Executioner it is.`];
      this.say(master, L(lines), this.think(0.7), { kind: 'nominate', ttl: 8 });
    }
    // The nominee acknowledges
    if (exec?.isBot) this.say(exec, L([`Understood. I'll make it count.`, `Alright, I'll handle it — trust me.`, `Me? Fine. Watch the portal.`]), this.think(1.1), { kind: 'nominate', ttl: 8 });
    // Everyone else reacts by their faction knowledge: ally / skeptic / mutiny call
    const speakers = m.list.filter(q => q.isBot && !q.ghost && q !== master && q !== exec).filter(b => this.budget(b, 3));
    let n = 0;
    for (const b of speakers.sort(() => Math.random() - 0.5)) {
      if (n >= 3 || Math.random() > (b.brain.persona?.chatty ?? 0.6)) continue;
      const t = B.trust(b, exec), mut = B.wantsMutiny(b), secret = b.faction !== FACTIONS.FIRE;
      let text, lie = false;
      const L = arr => this.uniq(() => pick(arr));
      if (mut && t < 0) text = L([`${exec.name}?! No way — I'm calling a mutiny!`, `Mutiny! ${master.name}, we can't trust ${exec.name} with the blade.`, `Not ${exec.name}. Someone back me up on this mutiny.`]);
      else if (mut) text = L([`Something feels off about ${exec.name}... I might rebel.`, `${master.name} picked ${exec.name} awfully fast. Suspicious. I'm thinking mutiny.`]);
      else if (t > 0 && secret && Math.random() < 0.6) { text = L([`No objection. Let's see what ${exec.name} does.`, `Fine by me, I guess.`]); lie = true; }   // hides a secret alliance
      else if (t > 0) text = L([`Good pick, ${master.name}. ${exec.name} is solid.`, `${exec.name}! Yes. Fine by me.`, `I like it — ${exec.name} won't let us down.`]);
      else text = L([`Hmm... ${exec.name}. We'll see.`, `${exec.name}, huh? Don't mess this up.`, `I'll reserve judgement on ${exec.name}.`, `No objection... for now.`]);
      this.say(b, text, this.think(0.5) + n * 0.9 + rand(0.2, 1.2), { kind: 'nominate-react', lie, ttl: 9 }); this.spend(b); n++;
    }
  }

  // ----------------------------------------------------------------------- executioner picks a captive
  onExecChoice(b, n) {
    if (!this.enabled || !b?.isBot) return;
    const m = this.m, other = m.npcs.altar().find(x => x.id !== n.id);
    const side = this.side(n), oSide = other ? this.side(other) : (side === 'west' ? 'east' : 'west');
    const cname = CURSES[n.curse].name, bad = this.badFor(b, n.faction, n.curse, false);
    const plan = { npcId: n.id, side, claimSide: side, bad, fake: null };
    let text, lie = false;
    if (!bad) {
      text = fill(L([
        `I'm taking the {side} captive — it carries {c}, and I like what that does for us.`,
        `{side} one for me. {c} is the better stigma of the two.`,
        `Going {side}. {c} — no downside I can see.`,
      ]), { side, c: cname });
    } else {
      lie = true;
      plan.fake = CURSES[L(SCARY.filter(c => c !== n.curse))].name;
      if (Math.random() < 0.4) {                                      // announce the wrong captive
        plan.claimSide = oSide;
        text = fill(L([`Taking the {s} captive. Its glyph is the cleaner one.`, `{s} one, no hesitation. The curse is harmless.`]), { s: oSide });
      } else {
        text = fill(L([`{side} one. The other has {f} — this is the lesser evil.`, `Taking {side}. Trust me, you don't want the other one's curse ({f}).`]), { side, f: plan.fake });
      }
    }
    b.brain.plan = plan;
    this.say(b, text, this.think(0.35), { kind: 'exec', lie, ttl: 7 });
  }

  /** Remember the public outcome; the Executioner will talk about it in the debate. */
  onSacrifice(n) {
    const m = this.m, e = m.P(m.execId);
    this.outcome = { ceremony: m.ceremonyIndex, faction: n.faction, curse: n.curse, execId: m.execId, masterId: m.masterId,
      bad: !!(e && e.isBot && this.badFor(e, n.faction, n.curse)), side: this.side(n) };
  }

  // ----------------------------------------------------------------------- debate
  onDebateStart() {
    if (!this.enabled) return;
    const m = this.m, B = this.brain, cer = m.cer, dur = Math.min(cer.t || 30, 60);
    this.debateEnd = m.time + dur; this.debateMsgs = 0;
    const o = this.outcome && this.outcome.ceremony === m.ceremonyIndex ? this.outcome : null;
    const exec = o ? m.P(o.execId) : null, master = o ? m.P(o.masterId) : m.P(m.masterId);
    const ttl = dur + 2;
    // 1) Executioner explains (and bluffs when the result was bad for them)
    if (exec?.isBot && o) {
      const plan = exec.brain.plan || {}, F = FACTION_INFO[o.faction], C = CURSES[o.curse];
      let text, lie = false;
      if (!o.bad) text = fill(L([`That went well — a {f} captive with {c}. No complaints from me.`, `See? {side} one, just like I said. {c} did its job.`, `A {f} offering. The crypt is happy.`]), { f: F.short, c: C.name, side: plan.side || o.side });
      else {
        lie = true;
        const fake = plan.fake || CURSES[L(SCARY)].name;
        const opts = [
          `I had no choice — both options had terrible curses!`,
          fill(`The other captive had {f}! I picked the lesser evil, honest.`, { f: fake }),
          `Blame the Master for the pool. I worked with what I was given.`,
        ];
        if (plan.claimSide && plan.claimSide !== plan.side) opts.push(fill(`I threw the {s} one, exactly as I told you. Don't twist it!`, { s: plan.claimSide }));
        text = L(opts);
      }
      this.say(exec, text, this.think(0.6), { kind: 'exec-debate', lie, ttl });
    }
    // 2) Everyone else: react to the curse and cast suspicion (some of it invented)
    const room = this.bots().filter(b => b !== exec && this.budget(b, 4));
    let k = 0;
    for (const b of room.sort(() => Math.random() - 0.5)) {
      if (Math.random() > (b.brain.persona?.chatty ?? 0.6) + 0.15) continue;
      const lines = [];
      if (o && Math.random() < 0.4) {
        const r = this.curseReaction(b, o, exec, master); if (r) lines.push(r);
      }
      const s = this.uniq(() => this.suspicion(b, o, exec));
      if (s) lines.push(s);
      lines.slice(0, 2).forEach((ln, i) => {
        const at = this.think(0.8) + rand(1, Math.max(2, dur - 4)) * (0.35 + 0.65 * Math.random()) + i * 3 + k * 0.5;
        this.say(b, ln.text, Math.min(at, Math.max(this.think(), dur - 2)), { kind: ln.kind, lie: ln.lie, ttl });
        this.spend(b);
      });
      k++;
    }
  }

  curseReaction(b, o, exec, master) {
    const en = this.nm(exec), mn = this.nm(master);
    switch (o.curse) {
      case 'TOXIC_FUMES': return { kind: 'react', text: L([`Ugh, the fumes! ${mn} and ${en} stumbling about — convenient, isn't it?`, `Toxic Fumes... ${mn} lost the staff. Who benefits?`]) };
      case 'MANA_DRAIN': return { kind: 'react', text: L([`${en} lost a crystal? Hmm. Suspicious choice.`, `Mana Drain on ${en}. Did they know?`]) };
      case 'MANA_BOOST': return { kind: 'react', text: L([`${en} gained a crystal... suspicious luck.`, `Mana Boost for ${en}. I'll be watching their pouch.`]) };
      case 'GAGGING_SEAL': return { kind: 'react', text: L([`${en} is gagged! Can't defend themselves now.`, `Gagging Seal on ${en} — quiet, finally.`]) };
      case 'EYE_OF_TRUTH': return { kind: 'react', text: L([`${en} got the Insight Eye. Who did they look at, I wonder?`]) };
      default: return null;
    }
  }

  /** Who looks guilty? Real observations first; hostile bots scapegoat with invented evidence. */
  suspicion(b, o, exec) {
    const m = this.m, B = this.brain;
    const cands = m.living.filter(q => q !== b && q.obs);
    if (!cands.length) return null;
    const scored = cands.map(q => {
      const ob = q.obs, t = B.trust(b, q);
      let s = (ob.total > 10 ? (ob.idle / ob.total) * 14 : 0) + ob.bails * 4 + (ob.total > 25 && ob.tasks === 0 ? 3 : 0) + (t < 0 ? 8 : 0) - (t > 0 ? 25 : 0);
      if (o?.bad && exec && q === exec && b.faction !== exec.faction) s += 6;
      return { q, s: s + Math.random() * 1.5 };
    }).sort((x, y) => y.s - x.s);
    // not everybody fixates on the same minion: usually the prime suspect, sometimes the runner-up
    const top = (scored[1] && scored[1].s >= 3 && Math.random() < 0.4) ? scored[1] : scored[0];
    if (!top || top.s < 1.2) return null;
    const q = top.q, ob = q.obs, t = B.trust(b, q);
    const idleS = Math.round(ob.idle);
    if (ob.idle >= 8 && ob.idle / Math.max(1, ob.total) > 0.2) return { kind: 'suspect', text: L([`${q.name}, you were just standing around for ${idleS}s. What were you doing?`, `I watched ${q.name} idle for like ${idleS} seconds while the Red Bar crept up. Sus.`]) };
    if (ob.bails > 0) return { kind: 'suspect', text: L([`I saw ${q.name} walk off the ${ob.lastBail ?? 'task'} halfway. Sus.`, `${q.name} abandoned the ${ob.lastBail ?? 'job'} mid-way. Why?`]) };
    if (ob.total > 25 && ob.tasks === 0) return { kind: 'suspect', text: L([`${q.name} hasn't finished a single task this round...`, `Not one task from ${q.name} all round. Explain.`]) };
    if (t < 0) return { kind: 'suspect', text: L([`I have a bad feeling about ${q.name}. Call it a hunch.`, `${q.name} is not who they say they are. Mark my words.`]) };
    if (o?.bad && exec && q === exec) return { kind: 'suspect', text: L([`${q.name} threw the wrong captive for my taste. Explain?`, `That sacrifice helped nobody I trust. ${q.name}?`]) };
    // scapegoat: no evidence at all → invent some (a lie), but only against someone who is not a known friend
    return { kind: 'scapegoat', lie: true, text: L([`${q.name} was acting shifty near the portal, I'm telling you.`, `I saw ${q.name} loitering instead of working. Don't trust them.`, `${q.name} ran off when the steam went off — typical.`]) };
  }

  // ----------------------------------------------------------------------- accused? defend yourself
  onChat(sender, text) {
    if (!this.enabled) return;
    const m = this.m;
    if (sender?.isBot && !PROVOKING.has(this.speaking)) return;             // bots only react to accusations, not to each other's small talk
    for (const b of this.bots()) {
      if (b === sender) continue;
      if (!new RegExp(`\\b${b.name.replace(/[^\w]/g, '')}\\b`, 'i').test(text.replace(/[^\w\s?!.,]/g, ''))) continue;
      if (!this.budget(b, 4, 'defend') || (this.cd.get('d' + b.id) ?? 0) > m.time) continue;
      const accusatory = ACCUSE_WORDS.test(text) || FACTION_ACCUSE.test(text);
      if (!accusatory && (sender?.isBot || Math.random() > 0.35)) continue;
      if ((this.cd.get(`d${b.id}:${sender?.id}`) ?? 0) > m.time) continue;      // already answered this person recently
      this.cd.set('d' + b.id, m.time + 7); this.cd.set(`d${b.id}:${sender?.id}`, m.time + 25);
      const r = this.defend(b, sender, text, accusatory);
      this.say(b, r.text, 0.7 + this.think(0.45), { kind: 'defend', lie: r.lie, ttl: 9, allowWork: true }); this.spend(b, 'defend');
    }
  }

  defend(b, accuser, text, accusatory) {
    const ob = b.obs ?? { tasks: 0, idle: 0, total: 1, bails: 0 }, an = accuser?.name ?? 'you';
    const sayFaction = (text.match(FACTION_ACCUSE) || [])[3]?.toLowerCase();
    const L = arr => this.uniq(() => pick(arr));
    if (sayFaction) {                                        // "X is Blood!" → deny
      const truth = b.faction === sayFaction, F = FACTION_INFO[sayFaction].short;
      return truth ? { lie: true, text: L([`I'm not ${F}. Prove it, ${an}.`, `${F}? Me? ${an}, you're deflecting.`]) } : { lie: false, text: L([`I'm not ${F}, ${an}. Check who's pushing this and ask why.`, `Wrong ${F}. I've been working all round.`]) };
    }
    if (!accusatory) return { lie: false, text: L([`Yes? I'm here, ${an}.`, `Talking about me, ${an}?`, `Did someone say my name?`]) };
    const n = ob.tasks, ts = `${n} task${n > 1 ? 's' : ''}`;
    if (n > 0) return { lie: false, text: L([`Me? I finished ${ts} this round. Check the board, ${an}!`, `${an}, I've done ${ts} so far. What have you done?`, `Ask the task board, ${an} — ${ts} from me.`, `I've been working! ${ts}, ${an}. Don't point fingers at me.`]) };
    if (ob.idle / Math.max(1, ob.total) > 0.25) return { lie: true, text: L([`I was keeping watch for hazards, ${an}! Someone has to.`, `Scouting the wings for the next breakdown. You're welcome, ${an}.`]) };
    return { lie: false, text: L([`I was hauling tools around, ${an}. That's rich coming from you.`, `That's rich coming from ${an}. Where were YOU?`, `Easy, ${an}. What did you actually see?`, `Careful, ${an} — accusing the wrong minion helps the cult.`]) };
  }

  // ----------------------------------------------------------------------- work phase: ask for a partner
  onNeedPartner(b, inst) {
    if (!this.enabled || (this.cd.get('p' + b.id) ?? 0) > this.m.time) return;
    if (this.m.list.some(q => q !== b && q.hold && q.hold.uid === inst.uid)) return;                  // a partner is already here
    this.cd.set('p' + b.id, this.m.time + 30);
    this.say(b, fill(L([`Anyone free to help with the {t}? I'm waiting at the handle.`, `Need a partner for the {t}! Quick job, I promise.`, `Hey — {t} needs two. Who's coming?`]), { t: inst.def.name }), 0, { kind: 'partner', ttl: 4, allowWork: true });
  }
}
