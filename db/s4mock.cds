namespace s4mock;

/**
 * MOCK of the custom CDS view you would build in ADT on the real S/4HANA system.
 * In production this entity does not exist in CAP - it is read remotely from S/4.
 * needInDays / poInDays exist only so the demo dates always look fresh.
 */
entity ShortageCandidates {
  key material   : String(40);
  key plant      : String(4);
  key poNumber   : String(10);
  key poItem     : String(5);
  supplier       : String(10);
  supplierName   : String(80);
  materialName   : String(80);
  buyer          : String(60);
  stockOnHand    : Decimal(13,3);
  shortfallQty   : Decimal(13,3);
  supplierCount  : Integer;
  needInDays     : Integer;
  poInDays       : Integer;
  virtual needDate       : Date;
  virtual poScheduleDate : Date;
}

