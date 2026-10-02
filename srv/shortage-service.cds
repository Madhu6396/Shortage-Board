using { shortage as db } from '../db/schema';

service ShortageService @(path: '/shortage') {

  // Cases are created by the sync. Users work on them through the actions below.
  @readonly
  entity ShortageCases as projection on db.ShortageCases actions {
    action commitETA(committedDate : Date,
                     committedQty  : Decimal(13,3),
                     givenBy       : String(80),
                     channel       : String(20),
                     remarks       : String(255)) returns ShortageCases;
    action escalate(reason : String(120)) returns ShortageCases;
    action resolve() returns ShortageCases;
  };

  @readonly entity Commitments   as projection on db.Commitments;
  @readonly entity Escalations   as projection on db.Escalations;
  @readonly entity SupplierStats as projection on db.SupplierStats;

  // Admin-maintained configuration (editable)
  entity EscalationMatrix as projection on db.EscalationMatrix;
  entity RiskConfig       as projection on db.RiskConfig;

  // Pulls shortages from the source system (mock S/4 for now)
  action sync() returns String;

  event EscalationRaised { caseID : UUID; level : Integer; role : String; }
}