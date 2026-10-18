type RecognitionConstructor = { prototype: object; available?: (options:{langs:string[];processLocally:boolean})=>Promise<string>;install?:(options:{langs:string[]})=>Promise<boolean> }
const environment = window as typeof window & {SpeechRecognition?: RecognitionConstructor;webkitSpeechRecognition?: RecognitionConstructor}
const recognition = environment.SpeechRecognition ?? environment.webkitSpeechRecognition
const capabilities: Record<string,string> = {
  'Secure context': String(window.isSecureContext),
  'Speech recognition': recognition ? (environment.SpeechRecognition ? 'SpeechRecognition' : 'webkitSpeechRecognition') : 'Unavailable in this browser',
  'On-device recognition API': recognition && 'processLocally' in recognition.prototype ? 'Exposed (language availability still needs checking)' : 'Not exposed',
  'Microphone capture API': typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'Available' : 'Unavailable',
  'Speech synthesis': 'speechSynthesis' in window ? 'Available' : 'Unavailable',
  'Gamepad API': typeof navigator.getGamepads === 'function' ? 'Available' : 'Unavailable',
  'Browser': navigator.userAgent,
}
const list = document.getElementById('capabilities')!
for (const [label,value] of Object.entries(capabilities)) {
  const term = document.createElement('dt'),description = document.createElement('dd')
  term.textContent=label;description.textContent=value;list.append(term,description)
}
if (recognition?.available) {
 const term=document.createElement('dt'),description=document.createElement('dd')
 term.textContent='Local English recognition';description.textContent='Checking language availability…';list.append(term,description)
 void recognition.available({langs:['en-US'],processLocally:true}).then(value=>{
  description.textContent=value
  if(value==='downloadable' && recognition.install){
   const download=document.createElement('button');download.textContent='Download local English speech';description.append(document.createElement('br'),download)
   download.onclick=()=>{
    download.disabled=true;download.textContent='Downloading browser language pack…'
    void recognition.install!({langs:['en-US']}).then(ok=>{
     description.textContent=ok?'Local English speech installed. Ready for push-to-talk.':'Language download failed. Reload to retry.'
    },error=>{description.textContent=`Language download failed: ${String(error)}`})
   }
  }
 },error=>{description.textContent=`Unavailable: ${String(error)}`})
}
const output=document.getElementById('devices')!
function update() {
 const pads=Array.from(navigator.getGamepads?.()??[]).filter((p):p is Gamepad=>p!==null)
 output.textContent=pads.length?pads.map(p=>`Device ${p.index}: ${p.id}\nAxes: ${p.axes.map((v,i)=>`${i}: ${v.toFixed(3)}`).join('  ')}\nPressed buttons: ${p.buttons.flatMap((b,i)=>b.pressed?[i]:[]).join(', ')||'none'}`).join('\n\n'):'No controller exposed to this page yet.'
}
update();setInterval(update,250)
