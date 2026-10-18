import {SafetySpeechController, type SpeechMessage} from '../../src/audio/safety-speech'
import {BrowserSpeechDriver} from '../../src/audio/browser-speech'
import {TcasComputer, type TcasOutput} from '../../src/sim/tcas'
import {TawsComputer, type TawsInput, type TawsOutput} from '../../src/sim/taws'
import {LocalVoiceClient} from '../../src/voice/client'

const state = document.querySelector<HTMLPreElement>('#state')!
const events = document.querySelector<HTMLOListElement>('#events')!
const audio = document.querySelector<HTMLInputElement>('#audio')!
const diagnostics=document.createElement('pre');diagnostics.setAttribute('aria-label','Speech engine state');audio.parentElement!.after(diagnostics)
let timers: ReturnType<typeof setTimeout>[] = []
let gpws: SpeechMessage | undefined, traffic: SpeechMessage | undefined
let oneShot: string | undefined
let generation = 0
const log = (text: string) => { const item=document.createElement('li');item.textContent=text;events.prepend(item);while(events.children.length>30)events.lastElementChild?.remove() }
const voiceClient = new LocalVoiceClient()
const browserSpeech = new BrowserSpeechDriver({
  resolveDynamic: (message, signal) => voiceClient.resolveSpeech(message, signal),
  onStart: message => log(`Started: ${message.text}`),
  onFailure: (message,reason) => log(`Audio failed: ${message.text} / ${reason}`),
})
const speech = new SafetySpeechController({
  cancel: () => { browserSpeech.cancel(); log('Cancel current speech') },
  speak: (message, done) => {
    log(`Speak: ${message.text} [priority ${message.priority}]`)
    if (!audio.checked) { done(); return }
    browserSpeech.speak(message,()=>{log(`Finished/released: ${message.text}`);done()})
  },
})
const tcas=new TcasComputer({taOnly:false}),taws=new TawsComputer()
const base: TawsInput={onGround:false,aglFt:800,altFt:5000,vsFpm:0,gsKt:150,headingDeg:0,rollDeg:0,flapsDeg:30,sinceTakeoffS:Infinity,terrainAheadFt:()=>0,nearRunwayFinal:true,gsDeviation:null,jetProfile:true,gearDown:true}
function later(ms: number, fn:()=>void):void {const token=generation;timers.push(setTimeout(()=>{if(token===generation)fn()},ms))}
function reset():void {generation++;timers.forEach(clearTimeout);timers=[];gpws=traffic=undefined;oneShot=undefined;speech.reset();speech.setRadioSuspended(false);tcas.reset();taws.reset()}
function present(label:string,tc?:TcasOutput,tw?:TawsOutput):void {
  gpws=tw?.level!=='NONE'&&tw?.aural?{text:tw.aural,priority:tw.level==='WARNING'?4:2}:undefined
  traffic=tc?.aural&&!tc.clearedRa?{text:tc.aural,priority:tc.level==='RA'?3:2}:undefined
  oneShot=tw?.callout&&tw.newAural?tw.aural:tc?.clearedRa?tc.aural:undefined
  state.textContent=label+'\n'+JSON.stringify({tcas:tc,gpws:tw},null,2)
  speech.update(performance.now(),gpws,traffic,oneShot);oneShot=undefined
}
const heartbeat=setInterval(()=>{
  speech.update(performance.now(),gpws,traffic)
  const synth=window.speechSynthesis
  diagnostics.textContent=JSON.stringify({visibility:document.visibilityState,paused:synth?.paused,pending:synth?.pending,speaking:synth?.speaking,voiceCount:synth?.getVoices().length,staticClips:'production manifest'},null,2)
},100)
document.querySelector('#stop')!.addEventListener('click',()=>{reset();state.textContent='Stopped. No pending scenario or speech.'})
for(const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-scenario]')))button.addEventListener('click',()=>{
  reset();events.replaceChildren()
  const own={onGround:false,altFt:5000,aglFt:5000,vsFpm:0}
  const track={id:'TEST',relNorthM:1000,relEastM:0,relVnMs:-100,relVeMs:0,altFt:5100,vsFpm:0}
  switch(button.dataset.scenario){
    case 'parked':present('Parked: no GPWS warning expected',undefined,taws.step(.5,{...base,onGround:true,aglFt:7,altFt:10,gsKt:0,nearRunwayFinal:false}));break
    case 'conflict':present('Closing conflict, followed by clearance',tcas.step(.5,own,[track]));later(4000,()=>present('Traffic has passed',tcas.step(.5,own,[])));break
    case 'low':present('Traffic remains visible; low-altitude aural is inhibited',tcas.step(.5,{...own,aglFt:450},[track]));break
    case 'landing':{
      const heights=[55,49,39,29,19,9]
      heights.forEach((agl,i)=>later(i*2200,()=>present(`Descending through ${agl} feet`,undefined,taws.step(.5,{...base,aglFt:agl,altFt:agl+100,vsFpm:-400}))))
      break
    }
    case 'priority':
    case 'ptt':{
      speech.radio('November one two three Alpha Bravo, taxi via Alpha and hold short runway two seven.',performance.now(),'tower')
      const ptt=button.dataset.scenario==='ptt';if(ptt)speech.setRadioSuspended(true)
      later(650,()=>present(ptt?'PTT listening: radio suppressed, terrain warning audible':'Terrain warning takes priority over radio',tcas.step(.5,own,[track]),taws.step(.5,{...base,nearRunwayFinal:false,terrainAheadFt:()=>4950})))
      later(8500,()=>present('Hazards resolved'))
      break
    }
  }
})
window.addEventListener('pagehide',()=>{clearInterval(heartbeat);reset()})

const pcmButton=document.createElement('button');pcmButton.textContent='Play PCM audio fixture';diagnostics.after(pcmButton)
let pcm:HTMLAudioElement|undefined
pcmButton.onclick=()=>{pcm?.pause();pcm=new Audio('/tests/browser/fixtures/atc-phrase.wav');pcm.onplaying=()=>log('PCM playing');pcm.onended=()=>log('PCM finished');pcm.onerror=()=>log(`PCM error ${pcm?.error?.message}`);void pcm.play().catch(e=>log(`PCM rejected ${String(e)}`))}
window.addEventListener('pagehide',()=>pcm?.pause())

const radioButton=document.createElement('button');radioButton.textContent='Test local ATC speech';pcmButton.after(radioButton)
radioButton.onclick=async()=>{
  reset();audio.checked=true
  try {
    const ready=await voiceClient.refresh()
    log(`Local voice: transcription ${ready.transcription}, synthesis ${ready.synthesis}`)
    speech.radio('November one two three Alpha Bravo, runway two seven, cleared for takeoff.',performance.now(),'tower')
  } catch(error) { log(`Local voice failed: ${String(error)}`) }
}
