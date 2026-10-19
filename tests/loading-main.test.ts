import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createCaptainSystems } from '../src/sim/captain-systems'
import { ControllerRuntime } from '../src/input/controller-runtime'
import { C172S } from '../src/sim/aircraft/c172s'
import { applyLoading, loadingFromSnapshot } from '../src/sim/loading'
import { makeFuelState, stepFuel } from '../src/sim/systems/fuel'
import { stepEngineStart } from '../src/sim/systems/engine-start'

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const functionText = (name: string) => ast.statements
  .filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  .map(n => n.getText(ast)).join('\n')

describe('main loading lifecycle', () => {
  it('recreates fuel metadata on reset so an old L selector cannot stop the engine', () => {
    const fuelState = makeFuelState(30, 30)
    stepFuel(fuelState, 1 / 60, { selector: 'L', boostPumpOn: false, demandKgS: 0 })
    const aircraft = { payloadKg: 0, fuelKg: 60, spoilerCmd: 0, spoilerArmed: false, reverseCmd: false }
    const ctx = {
      createCaptainSystems, controllerRuntime: new ControllerRuntime(),
      fuelState, makeFuelState, selectedLoading: { payloadKg: 80, leftKg: 30, rightKg: 30 },
      aircraft, FLEET_ACTIVE: { params: C172S }, applyLoading,
      electricalState: {}, makeElectricalState: () => ({}), engineStartState: {}, ENGINE_START_BOOT_RUNNING: { status: 'running', rpm: 700, crankTimeS: 0 },
      engineTemps: {}, makeEngineTemps: () => ({}), systemsControls: {}, SYSTEMS_CONTROLS_DEFAULT: { fuelSelector: 'BOTH', boostPumpOn: false },
      failures: {}, disconnectAutopilot: () => {}, apState: {}, carbIceState: {}, makeCarbIceState: () => ({}),
      aircraftLights: { landingOn: false },
    }
    const declarations = 'let carbHeatOn=false,baroSetInHg=0,ctlOverride={},holdWingsLevel=true,captainSystems={},captainCommands={},keyboardReverse=false,hardwareReverseOwned=false,autothrottle={},atArmSwitch=false,makeAutothrottle=()=>({});'
    const code = ts.transpileModule(`${declarations}${functionText('resetSystemsState')};resetSystemsState();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    new Function(...Object.keys(ctx), code)(...Object.values(ctx))
    expect(fuelState._lastSelector).toBeNull()
    expect(fuelState.fuelFlowing).toBe(false)
    expect(fuelState.boostPumpOn).toBe(false)

    stepFuel(fuelState, 1 / 60, { selector: 'BOTH', boostPumpOn: false, demandKgS: 0.01 })
    const engine = { status: 'running' as const, rpm: 700, crankTimeS: 0 }
    stepEngineStart(engine, 1 / 60, { masterBattery: true, starterEngaged: false, magneto: 'both', mixtureRich: true, throttleFrac: 0, fuelAvailable: fuelState.fuelFlowing, hotEngine: false, floodedEngine: false, primed: false })
    expect(engine.status).toBe('running')
  })

  it('applies complete snapshot loading before airborne trim', () => {
    let trimMass = -1
    const aircraft = {
      P: C172S, payloadKg: 250, fuelKg: 60, controls: {} as Record<string, number>, posNed: { x: 0, y: 0 }, crashed: false,
      get massKg() { return C172S.emptyMassKg + this.payloadKg + this.fuelKg },
      flapsDeg: 0, resetFlaps(index=0) { this.controls.flapsIndex=index; this.flapsDeg=C172S.flapDetentsDeg[index]??0 },
      applyTrimState: () => {},
    }
    const fuelState = makeFuelState(30, 30)
    const snapshot = { v: 1, onGround: false, lat: 1, lon: 1, altFt: 3000, kias: 100, flapsIndex: 0, fuelKg: 50, fuelLeftKg: 10, fuelRightKg: 40, payloadKg: 80, hdgDeg: 0, simMs: 0, spawn: 'saved' }
    const noop = () => {}
    const ctx = {
      localStorage: { getItem: () => JSON.stringify(snapshot) }, toast: noop, aircraft,
      loadingFromSnapshot, FLEET_ACTIVE: { params: C172S }, resetSystemsState: () => { aircraft.payloadKg = 250; aircraft.fuelKg = 60 }, resetFlightSafety: noop,
      frame: { anchor: {} }, tiles: { onRebase: noop, update: noop }, airports: { positionAll: noop, updateVisuals: noop, find: () => null },
      FT: .3048, KT: .514444, kcasFromKias: (n: number) => n, isa: () => ({ densityKgM3: 1.225 }),
      trim: (input: { massKg: number }) => { trimMass = input.massKg; return { alphaRad: 0, gammaRad: 0, elevatorRad: 0, throttle: 0, rpm: 0 } },
      fuelState, applyLoading, baseDate: new Date(0), loop: { simTime: 0 },
    }
    const declarations = "let parkingBrake=true,spawnDesc='',scrubSeconds=0;"
    const code = ts.transpileModule(`${declarations}${functionText('loadSnapshot')};return loadSnapshot();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    expect(new Function(...Object.keys(ctx), code)(...Object.values(ctx))).toBe(true)
    expect(trimMass).toBeCloseTo(C172S.emptyMassKg + 80 + 50)
    expect([aircraft.payloadKg, aircraft.fuelKg, fuelState.leftKg, fuelState.rightKg]).toEqual([80, 50, 10, 40])
  })

  it('constructs exactly one loading panel', () => {
    let count = 0
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'LoadingPanel') count++
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(count).toBe(1)
  })
})
