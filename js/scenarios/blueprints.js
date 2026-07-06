/* ================================================================
   blueprints.js — Config-driven scenario definitions.
   Each entry in SCENARIOS is a template; ScenarioManager deep-clones
   it on spawn so in-flight mutations never corrupt the source.

   tiles.size defines the NxN stamp dimension (3=3×3=9, 4=4×4=16, 5=5×5=25).
   tiles.count = size*size (used by the requirement checker).
   Population loss values are negative (applied to state.pop directly).
   ================================================================ */

export const SCENARIOS = {

  AI_DATA_CENTRE: {
    type: 'AI_DATA_CENTRE',
    stages: [
      {
        id: 'stage_1_setup',
        name: 'Initial Campus Build',
        monthsUntilDeadline: 18,
        monthsRemaining: 18,
        requirements: {
          tiles: { count: 9, size: 3, type: 'placement', position: null },
          power_access: { type: 'infrastructure' },
          power: { amount: 300, type: 'infrastructure' },
          water: { type: 'infrastructure' },
          happiness: { minValue: 55, type: 'city_stat' }
        },
        rewards: { revenue: 120000, jobs: 60, prestige: 8, demandBoost: 0.12 },
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
        id: 'stage_2_expansion',
        name: 'Capacity Expansion',
        monthsUntilDeadline: 54,
        monthsRemaining: 54,
        requirements: {
          tiles: { count: 16, size: 4, type: 'placement', position: 'adjacent_to_stage_1' },
          power_access: { type: 'infrastructure' },
          power: { amount: 600, type: 'infrastructure' },
          road: { quality: 'high', type: 'connectivity' },
          water: { type: 'infrastructure' },
          labor: { skilled: 250, type: 'workforce_available' }
        },
        rewards: { revenue: 10000, jobs: 100, prestige: 12, demandBoost: 0.18 },
        penalties: {
          ifFailed: {
            revenue: 55000, prestige: -10, populationLoss: -800,
            renegotiate: false, contractEnds: true
          },
          ifDeclined: {
            revenue: 110000, prestige: -20, populationLoss: -1600,
            contractBlacklist: 1825,
            message: 'Expansion cancelled. They downgrade and eventually leave.'
          }
        }
      },
      {
        id: 'stage_3_consolidation',
        name: 'Mega-Campus Consolidation',
        monthsUntilDeadline: 90,
        monthsRemaining: 90,
        requirements: {
          tiles: { count: 25, size: 5, type: 'placement', position: 'merge_both_campuses' },
          power_access: { type: 'infrastructure' },
          power: { amount: 800, type: 'infrastructure' },
          water: { type: 'infrastructure' },
          road: { quality: 'highway', type: 'connectivity' },
          happiness: { minValue: 65, type: 'city_stat' }
        },
        rewards: { revenue: 180000, jobs: 100, prestige: 20, demandBoost: 0.25 },
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

  // ── Stubs ──────────────────────────────────────────────────────────

  SHIPPING_CENTRE: {
    type: 'SHIPPING_CENTRE',
    stages: [
      {
        id: 'stage_1_port',
        name: 'Regional Hub Establishment',
        monthsUntilDeadline: 180,
        monthsRemaining: 180,
        requirements: {
          tiles: { count: 9, size: 3, type: 'placement', position: 'waterfront' },
          power_access: { type: 'infrastructure' },
          power: { amount: 30, type: 'infrastructure' },
          road: { quality: 'high', type: 'connectivity' }
        },
        rewards: { revenue: 45000, jobs: 180, prestige: 5, demandBoost: 0.15 },
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
        id: 'stage_1_protected',
        name: 'Protected Area Designation',
        monthsUntilDeadline: 120,
        monthsRemaining: 120,
        requirements: {
          tiles: { count: 9, size: 3, type: 'placement', position: null },
          happiness: { minValue: 50, type: 'city_stat' }
        },
        rewards: { revenue: 25000, jobs: 40, prestige: 5, demandBoost: 0.08 },
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
      },
      {
        id: 'stage_2_reservate',
        name: 'Protected Area Reservate',
        monthsUntilDeadline: 120,
        monthsRemaining: 120,
        requirements: {
          tiles: { count: 16, size: 4, type: 'placement', position: null },
          happiness: { minValue: 60, type: 'city_stat' }
        },
        rewards: { revenue: 25000, jobs: 40, prestige: 6, demandBoost: 0.10 },
        penalties: {
          ifFailed: {
            prestige: -5, populationLoss: -200,
            renegotiate: false, contractEnds: true, message: ''
          },
          ifDeclined: {
            prestige: -10, populationLoss: -400,
            contractBlacklist: 1825,
            message: 'Conservation deal abandoned.'
          }
        }
      }
    ]
  }
};
