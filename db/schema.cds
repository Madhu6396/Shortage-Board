using { cuid, managed } from '@sap/cds/common';

namespace shortage;

type RiskLevel  : String(10) enum { Red; Amber; Green; }
type CaseStatus : String(12) enum { Open; Committed; Escalated; Resolved; }

/**
 * One row per shortage = material + plant + PO item.
 * S/4 keys are stored as plain strings - master data is never copied as a master.
 */
entity ShortageCases : cuid, managed {
  material        : String(40)     @title: 'Material';
  plant           : String(4)      @title: 'Plant';
  supplier        : String(10)     @title: 'Supplier';
  poNumber        : String(10)     @title: 'PO';
  poItem          : String(5)      @title: 'PO Item';
  materialName    : String(80)     @title: 'Material Name';
  supplierName    : String(80)     @title: 'Supplier Name';
  buyer           : String(60)     @title: 'Buyer';
  stockOnHand     : Decimal(13,3)  @title: 'Stock On Hand';
  shortfallQty    : Decimal(13,3)  @title: 'Shortfall Qty';
  needDate        : Date           @title: 'Need Date';
  poScheduleDate  : Date           @title: 'PO Delivery Date';
  singleSource    : Boolean        @title: 'Single Source';
  status          : CaseStatus default #Open @title: 'Status';
  riskScore       : Integer        @title: 'Risk Score';
  riskLevel       : RiskLevel      @title: 'Risk';
  riskCriticality : Integer;
  lastSyncedAt    : Timestamp      @title: 'Last Synced';
  commitments     : Composition of many Commitments on commitments.parent = $self;
  escalations     : Composition of many Escalations  on escalations.parent  = $self;
}

/** Supplier ETA promises. Insert-only: the row with isCurrent = true is the live promise. */
entity Commitments : cuid, managed {
  parent        : Association to ShortageCases;
  committedDate : Date            @title: 'Committed Date';
  committedQty  : Decimal(13,3)   @title: 'Committed Qty';
  givenBy       : String(80)      @title: 'Given By';
  channel       : String(20)      @title: 'Channel';
  remarks       : String(255)     @title: 'Remarks';
  isCurrent     : Boolean default true  @title: 'Current';
  missed        : Boolean default false @title: 'Missed';
}

entity Escalations : cuid, managed {
  parent    : Association to ShortageCases;
  escLevel  : Integer     @title: 'Level';
  raisedTo  : String(40)  @title: 'Raised To';
  reason    : String(120) @title: 'Reason';
  raisedAt  : Timestamp   @title: 'Raised At';
}

/** Configuration: who gets escalated to, and after how many hours open. */
entity EscalationMatrix {
  key plant     : String(4);
  key riskLevel : RiskLevel;
  key escLevel  : Integer;
  roleName      : String(40);
  afterHours    : Integer;
}

/** Configuration: risk score weights and Red/Amber thresholds. */
entity RiskConfig {
  key factor  : String(20);
  configValue : Integer;
  description : String(120);
}

/** Supplier history of kept vs. missed commitments (feeds the risk score). */
entity SupplierStats {
  key supplier : String(10);
  supplierName : String(80);
  totalCount   : Integer;
  missedCount  : Integer;
}