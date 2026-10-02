using { s4mock } from '../db/s4mock';

// Stands in for the S/4HANA OData service. Later: replace with a remote service.
@path: '/s4mock'
service S4MockService {
  @readonly entity ShortageCandidates as projection on s4mock.ShortageCandidates;
}