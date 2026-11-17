# Permission matrix (generated from `packages/domain/src/permissions.ts`)

Roles across, resources down. Server-side and object-level: every check also requires the same household, except staff. Extra conditions apply beyond this table:

- **Backup** sees the pet and emergency card only through a valid 15-minute look-in link, and the address only if authorised.
- **Helper** sees the emergency card only during a visit or incident.
- **Friend** sees access details and the emergency card only after acceptance and owner authorisation.
- **Nearby member** has no access while PS-062 is OFF.
- **Substitute** and **ad-hoc visitor** (v1.4) act only through a one-time task link: this task only, until it expires or is revoked. Before acceptance and owner approval they see the task, time and tower; address, gate, key and emergency card only after both.
- **Standing approval** (v1.4, PRD 9.5) lets Pawsure message the ordered backup list without a tap each time. It never covers friends, substitutes, ad-hoc numbers or nearby members (`outreachAllowed`).

| Resource | owner | co_owner | backup | family | viewer | helper | friend | nearby_member | substitute | adhoc_visitor | ops | ops_lead | privacy_lead | tech_lead | auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| access_details | Rea App | — | — | — | — | — | Rea | — | Rea | Rea | — | — | — | — | — |
| address | Rea Upd | Rea | — | — | — | — | — | — | — | — | — | — | — | — | — |
| alert | Rea Ack | Rea Ack | Rea Ack | Rea Ack | — | — | — | — | — | — | — | — | — | — | — |
| audit_log | — | — | — | — | — | — | — | — | — | — | — | Rea | Rea Exp | Rea | Rea Exp |
| backup_list | Rea Cre Upd Del Ack App | Rea | — | — | — | — | — | — | — | — | — | — | — | — | — |
| breach | — | — | — | — | — | — | — | — | — | — | — | Rea | Rea Cre Upd | Rea Cre Upd | — |
| care_circle | Rea Cre Upd Del Ack App | Rea | — | — | — | — | — | — | — | — | — | — | — | — | — |
| cluster_advisory | — | — | — | — | — | — | — | — | — | — | Rea Cre | Rea Cre | — | — | — |
| code_card | Rea Cre Upd | Rea | — | — | — | — | — | — | — | — | — | — | — | — | — |
| cover | Rea Cre Upd Del Ack App | Rea Upd Ack | — | — | — | — | — | — | — | — | — | — | — | — | — |
| emergency_card | Rea Cre Upd Del Ack App | Rea Upd | Rea | Rea | — | Rea | Rea | — | Rea | Rea | — | — | — | — | — |
| evidence | Rea | Rea | — | — | — | Cre | — | — | Cre | Cre | — | — | — | — | — |
| feature_flag | — | — | — | — | — | — | — | — | — | — | — | Rea Upd | Rea | Rea Upd | — |
| friend_profile | Rea | Rea | — | — | — | — | Rea Upd Del | — | — | — | — | Rea Upd | — | — | — |
| friend_request | Rea Cre Upd Del Ack App | Rea Cre Upd App | — | — | — | — | Rea Upd | — | — | — | Rea | Rea | — | Rea | — |
| helper_consent | Rea | — | — | — | — | Rea Upd | — | — | — | — | Rea | Rea | — | — | — |
| household | Rea Cre Upd Del Ack App | Rea | — | — | — | — | — | — | — | — | Rea | Rea | Rea | — | — |
| incident | Rea Cre Upd Ack | Rea Cre Upd Ack | Rea Ack Upd | — | — | Cre | — | — | Cre | Cre | Rea Upd | Rea Upd | — | — | — |
| metrics | — | — | — | — | — | — | — | — | — | — | Rea | Rea | Rea | Rea | Rea |
| ops_queue | — | — | — | — | — | — | — | — | — | — | Rea Upd | Rea Cre Upd Del Ack App | — | Rea | Rea |
| pet | Rea Cre Upd Del Ack App | Rea Upd | Rea | Rea | Rea | — | — | — | — | — | — | — | — | — | — |
| rights_request | Rea Cre | — | — | — | — | Cre | Cre | — | — | — | — | — | Rea Upd App | — | — |
| routine | Rea Cre Upd Del Ack App | Rea Cre Upd | — | — | — | — | — | — | — | — | — | — | — | — | — |
| task | Rea Cre Upd Del Ack App | Rea Upd | — | — | — | Rea | — | — | Rea | Rea | — | — | — | — | — |
| timeline | Rea | Rea | Rea | Rea | Rea | — | — | — | — | — | Rea | — | — | — | — |
| wallet | Rea | Rea | — | — | — | Rea | — | — | — | — | — | Rea Upd App | — | — | — |

Key: Rea = read, Cre = create, Upd = update, Del = delete, Ack = acknowledge, App = approve, Exp = export.
