import cds from '@sap/cds'
const LOG = cds.log('shortage')

const DAY = 86400000
const todayStr = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY) // a minus b
const clamp = (n) => Math.max(0, Math.min(100, n))

const DEFAULTS = { TIME: 40, ETA: 30, SINGLE: 15, SUPPLIER: 15, RED_AT: 70, AMBER_AT: 40 }

export default class ShortageService extends cds.ApplicationService {

  async init() {
    // Database-level entities (namespace 'shortage'), used for reads/writes in the logic below
    const { ShortageCases, Commitments, Escalations, EscalationMatrix, RiskConfig, SupplierStats } =
      cds.entities('shortage')
      // ------------------------------------------------------------------
    // 1. RISK SCORE  (0-100, weights come from the RiskConfig table)
    // ------------------------------------------------------------------
    const loadConfig = async (tx) => {
      const rows = await tx.run(SELECT.from(RiskConfig))
      return { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.factor, r.configValue])) }
    }

    const score = (c, commitment, stats, w) => {
      const daysToNeed = daysBetween(c.needDate, todayStr())          // negative = already late
      const validPromise = commitment && !commitment.missed
      const eta = validPromise ? commitment.committedDate : c.poScheduleDate
      const gap = daysBetween(eta, c.needDate)                        // > 0 = arrives after need date

      const timeScore     = clamp(Math.round((7 - daysToNeed) / 7 * 100))   // 7-day horizon
      const etaScore      = clamp(gap * 20)                                  // 5 days late = 100
      const singleScore   = c.singleSource ? 100 : 0
      const missRate      = stats && stats.totalCount ? stats.missedCount / stats.totalCount : 0.25
      const supplierScore = clamp(Math.round(missRate * 100))

      const weightSum = w.TIME + w.ETA + w.SINGLE + w.SUPPLIER
      const riskScore = Math.round(
        (w.TIME * timeScore + w.ETA * etaScore + w.SINGLE * singleScore + w.SUPPLIER * supplierScore) / weightSum
      )
      const riskLevel = riskScore >= w.RED_AT ? 'Red' : riskScore >= w.AMBER_AT ? 'Amber' : 'Green'
      const riskCriticality = { Red: 1, Amber: 2, Green: 3 }[riskLevel]   // Fiori: 1 error, 2 warning, 3 success
      return { riskScore, riskLevel, riskCriticality }
    }

    const rescore = async (tx, c, cfg) => {
      const commitment = await tx.run(SELECT.one.from(Commitments).where({ parent_ID: c.ID, isCurrent: true }))
      const stats = await tx.run(SELECT.one.from(SupplierStats).where({ supplier: c.supplier }))
      const result = score(c, commitment, stats, cfg)
      await tx.run(UPDATE(ShortageCases).set(result).where({ ID: c.ID }))
      return { ...c, ...result }
    }

    // ------------------------------------------------------------------
    // 2. ESCALATION  (matrix is data, engine is code)
    // ------------------------------------------------------------------
    const raise = async (tx, c, escLevel, roleName, reason, events) => {
      await tx.run(INSERT.into(Escalations).entries({
        parent_ID: c.ID, escLevel, raisedTo: roleName, reason, raisedAt: new Date().toISOString()
      }))
      await tx.run(UPDATE(ShortageCases).set({ status: 'Escalated' }).where({ ID: c.ID }))
      events.push({ caseID: c.ID, level: escLevel, role: roleName })
    }

    const autoEscalate = async (tx, cases, events) => {
      const matrix = await tx.run(SELECT.from(EscalationMatrix))
      const raised = await tx.run(SELECT.from(Escalations).columns('parent_ID', 'escLevel'))
      const done = new Set(raised.map(e => `${e.parent_ID}|${e.escLevel}`))

      for (const c of cases) {
        if (c.riskLevel === 'Green') continue
        const hoursOpen = (Date.now() - Date.parse(c.createdAt)) / 3600000
        const rules = matrix
          .filter(m => m.plant === c.plant && m.riskLevel === c.riskLevel)
          .sort((a, b) => a.escLevel - b.escLevel)
        for (const m of rules) {
          const key = `${c.ID}|${m.escLevel}`
          if (hoursOpen >= m.afterHours && !done.has(key)) {
            await raise(tx, c, m.escLevel, m.roleName, `${c.riskLevel} risk open for ${Math.floor(hoursOpen)}h`, events)
            done.add(key)
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. SYNC  (reads the "S/4" source, upserts cases, rescored + escalated)
    // ------------------------------------------------------------------
    const runSync = async () => {
      // Today: a service in this same project. Later: swap for the real remote S/4 service.
      const s4 = cds.services.S4MockService ?? await cds.connect.to('S4MockService')
      const { ShortageCandidates } = s4.entities
      const candidates = await s4.run(SELECT.from(ShortageCandidates))

      const result = { created: 0, updated: 0, resolved: 0 }
      const events = []
      const keyOf = (x) => [x.material, x.plant, x.poNumber, x.poItem].join('|')

      await cds.tx(async (tx) => {
        const cfg = await loadConfig(tx)
        const existing = await tx.run(SELECT.from(ShortageCases))
        const byKey = new Map(existing.map(c => [keyOf(c), c]))
        const seen = new Set()

        for (const s of candidates) {
          const k = keyOf(s)
          seen.add(k)
          const fromSource = {
            supplier: s.supplier, supplierName: s.supplierName, materialName: s.materialName,
            stockOnHand: s.stockOnHand, shortfallQty: s.shortfallQty,
            needDate: s.needDate, poScheduleDate: s.poScheduleDate,
            singleSource: s.supplierCount === 1,
            lastSyncedAt: new Date().toISOString()
          }
          const found = byKey.get(k)
          if (found) {
            // Still short in S/4 -> refresh source fields (and reopen if it had been resolved)
            const reopen = found.status === 'Resolved' ? { status: 'Open' } : {}
            await tx.run(UPDATE(ShortageCases).set({ ...fromSource, ...reopen }).where({ ID: found.ID }))
            result.updated++
          } else {
            await tx.run(INSERT.into(ShortageCases).entries({
              material: s.material, plant: s.plant, poNumber: s.poNumber, poItem: s.poItem,
              buyer: s.buyer, status: 'Open', ...fromSource
            }))
            result.created++
          }
        }

        // Shortage no longer reported by S/4 -> case resolved
        for (const c of existing) {
          if (!seen.has(keyOf(c)) && c.status !== 'Resolved') {
            await tx.run(UPDATE(ShortageCases).set({ status: 'Resolved' }).where({ ID: c.ID }))
            result.resolved++
          }
        }

        const active = await tx.run(SELECT.from(ShortageCases).where({ status: { '!=': 'Resolved' } }))

        // Promise date passed but shortage still open -> commitment counts as missed
        const today = todayStr()
        for (const c of active) {
          const cur = await tx.run(SELECT.one.from(Commitments)
            .where({ parent_ID: c.ID, isCurrent: true, missed: false }))
          if (cur && cur.committedDate < today) {
            await tx.run(UPDATE(Commitments).set({ missed: true }).where({ ID: cur.ID }))
            await tx.run(UPDATE(SupplierStats)
              .set({ totalCount: { '+=': 1 }, missedCount: { '+=': 1 } })
              .where({ supplier: c.supplier }))
          }
        }

        const scored = []
        for (const c of active) scored.push(await rescore(tx, c, cfg))
        await autoEscalate(tx, scored, events)
      })

      for (const e of events) await this.emit('EscalationRaised', e)
      return result
    }

    this.on('sync', async () => {
      const r = await runSync()
      return `Sync done: ${r.created} new, ${r.updated} updated, ${r.resolved} resolved`
    })

    // ------------------------------------------------------------------
    // 4. USER ACTIONS on a case
    // ------------------------------------------------------------------
    this.on('commitETA', 'ShortageCases', async (req) => {
      const { committedDate, committedQty, givenBy, channel, remarks } = req.data
      if (!committedDate) return req.error(400, 'Committed date is required')
      const { ID } = await SELECT.one.from(req.subject).columns('ID')

      await UPDATE(Commitments).set({ isCurrent: false }).where({ parent_ID: ID })
      await INSERT.into(Commitments).entries({
        parent_ID: ID, committedDate, committedQty, givenBy, channel, remarks, isCurrent: true, missed: false
      })
      await UPDATE(ShortageCases).set({ status: 'Committed' }).where({ ID, status: 'Open' })

      const c = await SELECT.one.from(ShortageCases).where({ ID })
      await rescore(cds.db, c, await loadConfig(cds.db))
      return SELECT.one.from(req.subject)
    })

    this.on('escalate', 'ShortageCases', async (req) => {
      const { ID } = await SELECT.one.from(req.subject).columns('ID')
      const c = await SELECT.one.from(ShortageCases).where({ ID })
      const last = await SELECT.one.from(Escalations).columns('escLevel')
        .where({ parent_ID: ID }).orderBy('escLevel desc')
      const next = (last?.escLevel || 0) + 1
      if (next > 3) return req.error(409, 'Already at the highest escalation level')

      const rule = await SELECT.one.from(EscalationMatrix)
        .where({ plant: c.plant, riskLevel: c.riskLevel, escLevel: next })
      const events = []
      await raise(cds.db, c, next, rule?.roleName || `Level ${next} contact`, req.data.reason || 'Manual escalation', events)
      for (const e of events) await this.emit('EscalationRaised', e)
      return SELECT.one.from(req.subject)
    })

    this.on('resolve', 'ShortageCases', async (req) => {
      const { ID } = await SELECT.one.from(req.subject).columns('ID')
      await UPDATE(ShortageCases).set({ status: 'Resolved' }).where({ ID })
      // Note: if S/4 still reports the shortage, the next sync reopens the case.
      return SELECT.one.from(req.subject)
    })

    // Event-driven notification hook: plug email / Teams / push here later
    this.on('EscalationRaised', (msg) => {
      const { caseID, level, role } = msg.data
      LOG.info(`NOTIFY ${role}: case ${caseID} escalated to level ${level}`)
    })

    // ------------------------------------------------------------------
    // 5. Run the sync at startup and then every 10 minutes
    // ------------------------------------------------------------------
    cds.once('served', () => {
      const go = () => runSync()
        .then(r => LOG.info('sync result', r))
        .catch(e => LOG.error('sync failed', e))
      go()
      cds.spawn({ every: 10 * 60 * 1000 }, go)
    })

    return super.init()
  }
}