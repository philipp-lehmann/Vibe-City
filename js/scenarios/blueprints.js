/* ================================================================
   blueprints.js — Config-driven scenario definitions.
   Each entry in SCENARIOS is a template; ScenarioManager deep-clones
   it on spawn so in-flight mutations never corrupt the source.

   Population loss values are negative (applied to state.pop directly).
   ================================================================ */

export const SCENARIOS = {

  AI_DATA_CENTRE: {
    type: 'AI_DATA_CENTRE',
    stages: [
      {
        id:   'stage_1_setup',
        name: 'Initial Campus Build',
        monthsUntilDeadline: 180,
        monthsRemaining:     180,
        requirements: {
          tiles:     { count: 5,  type: 'placement',          position: null },
          power:     { amount: 8, type: 'infrastructure' },
          water:     { amount: 4, type: 'infrastructure' },
          happiness: { minValue: 55, type: 'city_stat' }
        },
        rewards: { revenue: 120000, jobs: 60, prestige: 8 },
        penalties: {
          ifFailed: {
            revenue: 1320000, prestige: -15, populationLoss: -1600,
            renegotiate: true,
            message: 'We can stay at reduced capacity...'
          },
          ifDeclined: {
            revenue: 2640000, prestige: -25, populationLoss: -3200,
            contractBlacklist: 1825,
            message: "They've relocated to New Harbor City."
          }
        }
      },
      {
        id:   'stage_2_expansion',
        name: 'Capacity Expansion',
        monthsUntilDeadline: 540,
        monthsRemaining:     540,
        requirements: {
          tiles: { count: 5,   type: 'placement',         position: 'adjacent_to_stage_1' },
          power: { amount: 8,  type: 'infrastructure' },
          road:  { quality: 'high', type: 'connectivity' },
          labor: { skilled: 150, type: 'workforce_available' }
        },
        rewards: { revenue: 100000, jobs: 200, prestige: 12 },
        penalties: {
          ifFailed: {
            revenue: 550000, prestige: -10, populationLoss: -800,
            renegotiate: false, contractEnds: true
          },
          ifDeclined: {
            revenue: 1100000, prestige: -20, populationLoss: -1600,
            contractBlacklist: 1825,
            message: 'Expansion cancelled. They downgrade and eventually leave.'
          }
        }
      },
      {
        id:   'stage_3_consolidation',
        name: 'Mega-Campus Consolidation',
        monthsUntilDeadline: 900,
        monthsRemaining:     900,
        requirements: {
          tiles:     { count: 10,  type: 'placement',        position: 'merge_both_campuses' },
          power:     { amount: 16, type: 'infrastructure' },
          water:     { amount: 8,  type: 'infrastructure' },
          road:      { quality: 'highway', type: 'connectivity' },
          happiness: { minValue: 65, type: 'city_stat' }
        },
        rewards: { revenue: 180000, jobs: 100, prestige: 20 },
        penalties: {
          ifFailed: {
            revenue: 810000, prestige: -20, populationLoss: -1600,
            renegotiate: false, contractEnds: true,
            message: 'Contract ends. They relocate entirely.'
          },
          ifDeclined: {
            revenue: 1620000, prestige: -30, populationLoss: -3200,
            contractBlacklist: 1825,
            message: 'Mega-campus dream abandoned. Contract ended.'
          }
        }
      }
    ]
  },

  // ── Stubs — stages to be filled in later; blacklist keys must exist ──

  SHIPPING_CENTRE: {
    type: 'SHIPPING_CENTRE',
    stages: [
      {
        id:   'stage_1_port',
        name: 'Regional Hub Establishment',
        monthsUntilDeadline: 180,
        monthsRemaining:     180,
        requirements: {
          tiles: { count: 5, type: 'placement', position: 'waterfront' },
          power: { amount: 2, type: 'infrastructure' },
          road:  { quality: 'high', type: 'connectivity' }
        },
        rewards: { revenue: 45000, jobs: 180, prestige: 5 },
        penalties: {
          ifFailed: {
            revenue: 200000, prestige: -8, populationLoss: -400,
            renegotiate: true, message: 'Scaled back to local distribution only.'
          },
          ifDeclined: {
            revenue: 400000, prestige: -15, populationLoss: -800,
            contractBlacklist: 1825,
            message: 'They set up in a rival port city.'
          }
        }
      }
    ]
  },

  WILDLIFE_RESERVE: {
    type: 'WILDLIFE_RESERVE',
    stages: [
      {
        id:   'stage_1_protected',
        name: 'Protected Area Designation',
        monthsUntilDeadline: 120,
        monthsRemaining:     120,
        requirements: {
          tiles:     { count: 5, type: 'placement', position: null },
          happiness: { minValue: 50, type: 'city_stat' }
        },
        rewards: { revenue: 25000, jobs: 40, prestige: 5 },
        penalties: {
          ifFailed: {
            revenue: 100000, prestige: -5, populationLoss: -200,
            renegotiate: false, contractEnds: true, message: ''
          },
          ifDeclined: {
            revenue: 200000, prestige: -10, populationLoss: -400,
            contractBlacklist: 1825,
            message: 'Conservation deal abandoned.'
          }
        }
      }
    ]
  }
};
