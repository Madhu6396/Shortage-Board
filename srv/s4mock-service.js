import cds from '@sap/cds'

// Mock only: turns "days from today" into real dates on every read,
// so the demo data never goes stale. Delete this file when using real S/4.
export default class S4MockService extends cds.ApplicationService {
  init() {
    const DAY = 86400000
    const iso = (days) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

    this.after('READ', 'ShortageCandidates', (data) => {
      const rows = Array.isArray(data) ? data : [data]
      for (const r of rows) {
        if (!r || r.needInDays == null || r.poInDays == null) continue
        r.needDate = iso(r.needInDays)
        r.poScheduleDate = iso(r.poInDays)
      }
    })

    return super.init()
  }
}