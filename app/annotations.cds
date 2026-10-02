using ShortageService as service from '../srv/shortage-service';

annotate service.ShortageCases with @(
  UI.HeaderInfo : {
    TypeName       : 'Shortage Case',
    TypeNamePlural : 'Shortage Cases',
    Title          : { Value : materialName },
    Description    : { Value : supplierName }
  },

  UI.PresentationVariant : {
    SortOrder      : [{ Property : riskScore, Descending : true }],
    Visualizations : ['@UI.LineItem']
  },

  UI.SelectionFields : [ plant, riskLevel, status, supplier ],

  UI.LineItem : [
    { Value : riskScore,      Label : 'Score', Criticality : riskCriticality },
    { Value : riskLevel,      Criticality : riskCriticality },
    { Value : materialName },
    { Value : plant },
    { Value : supplierName },
    { Value : needDate },
    { Value : poScheduleDate },
    { Value : shortfallQty },
    { Value : status },
    { Value : buyer },
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.commitETA', Label : 'Commit ETA' },
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.escalate',  Label : 'Escalate' },
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.resolve',   Label : 'Resolve' }
  ],

  UI.Identification : [
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.commitETA', Label : 'Commit ETA' },
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.escalate',  Label : 'Escalate' },
    { $Type : 'UI.DataFieldForAction', Action : 'ShortageService.resolve',   Label : 'Resolve' }
  ],

  UI.FieldGroup #Details : {
    Data : [
      { Value : material },
      { Value : plant },
      { Value : poNumber },
      { Value : poItem },
      { Value : supplier },
      { Value : buyer },
      { Value : stockOnHand },
      { Value : shortfallQty },
      { Value : needDate },
      { Value : poScheduleDate },
      { Value : singleSource },
      { Value : riskScore,  Criticality : riskCriticality },
      { Value : riskLevel,  Criticality : riskCriticality },
      { Value : status },
      { Value : lastSyncedAt }
    ]
  },

  UI.Facets : [
    { $Type : 'UI.ReferenceFacet', Label : 'Details',     Target : '@UI.FieldGroup#Details' },
    { $Type : 'UI.ReferenceFacet', Label : 'Commitments',  Target : 'commitments/@UI.LineItem' },
    { $Type : 'UI.ReferenceFacet', Label : 'Escalations',  Target : 'escalations/@UI.LineItem' }
  ]
);

annotate service.Commitments with @(
  UI.LineItem : [
    { Value : committedDate },
    { Value : committedQty },
    { Value : givenBy },
    { Value : channel },
    { Value : remarks },
    { Value : isCurrent },
    { Value : missed }
  ]
);

annotate service.Escalations with @(
  UI.LineItem : [
    { Value : raisedAt },
    { Value : escLevel },
    { Value : raisedTo },
    { Value : reason }
  ]
);