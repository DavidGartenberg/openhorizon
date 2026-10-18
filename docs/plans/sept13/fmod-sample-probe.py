import ctypes as C, struct, wave, hashlib, json
from pathlib import Path
root=Path('/Users/davidgartenberg/X-Plane 12')
bank=root/'Aircraft/Laminar Research/Boeing 737-800/fmod/Master Bank.bank'
data=bank.read_bytes(); start=data.index(b'FSB5')
version,count,headers,names,size,mode=struct.unpack_from('<6I',data,start+4)
assert version==1 and count<1000 and start+60+headers+names+size<=len(data)
cache=Path('server/cache/speech/xplane-probe');cache.mkdir(parents=True,exist_ok=True)
fsb=cache/'b738.fsb';fsb.write_bytes(data[start:start+60+headers+names+size])
lib=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmod.dylib')); P=C.c_void_p; I=C.c_int; U=C.c_uint; F=C.c_float
specs={'System_Create':[C.POINTER(P),U],'System_SetOutput':[P,I],'System_Init':[P,I,U,P],'System_Release':[P],'System_CreateSound':[P,C.c_char_p,U,P,C.POINTER(P)],'Sound_GetNumSubSounds':[P,C.POINTER(I)],'Sound_GetSubSound':[P,I,C.POINTER(P)],'Sound_GetName':[P,P,I],'Sound_GetFormat':[P,C.POINTER(I),C.POINTER(I),C.POINTER(I),C.POINTER(I)],'Sound_GetDefaults':[P,C.POINTER(F),C.POINTER(I)],'Sound_GetLength':[P,C.POINTER(U),U],'Sound_SeekData':[P,U],'Sound_ReadData':[P,P,U,C.POINTER(U)],'Sound_Release':[P]}
for name,args in specs.items():
 fn=getattr(lib,'FMOD_'+name);fn.argtypes=args;fn.restype=I

def call(name,*args):
 result=getattr(lib,'FMOD_'+name)(*args)
 if result: raise RuntimeError(f'{name}: FMOD error {result}')
sys=P();parent=P();call('System_Create',C.byref(sys),0x20200)
try:
 call('System_SetOutput',sys,2);call('System_Init',sys,32,0,None)
 call('System_CreateSound',sys,str(fsb.resolve()).encode(),0x2080,None,C.byref(parent))
 n=I();call('Sound_GetNumSubSounds',parent,C.byref(n));print('Subsounds',n.value,flush=True)
 chosen=None
 for index in range(n.value):
  sub=P();call('Sound_GetSubSound',parent,index,C.byref(sub));name=C.create_string_buffer(512);call('Sound_GetName',sub,name,512)
  label=name.value.decode(errors='replace')
  if 'freq N1 75 b' in label:
   chosen=(index,sub,label);break
 if not chosen: raise RuntimeError('Target sample missing')
 index,sub,label=chosen
 kind,fmt,channels,bits=I(),I(),I(),I();rate=F();priority=I();length=U()
 call('Sound_GetFormat',sub,C.byref(kind),C.byref(fmt),C.byref(channels),C.byref(bits));call('Sound_GetDefaults',sub,C.byref(rate),C.byref(priority));call('Sound_GetLength',sub,C.byref(length),4)
 print({'index':index,'name':label,'format':fmt.value,'channels':channels.value,'bits':bits.value,'rate':rate.value,'pcmBytes':length.value},flush=True)
 assert (fmt.value,bits.value) in ((2,16),(5,32)) and channels.value in (1,2) and 0<length.value<20000000
 call('Sound_SeekData',sub,0)
 pcm=C.create_string_buffer(length.value);read=U();status=lib.FMOD_Sound_ReadData(sub,pcm,length.value,C.byref(read));print({'decodeResult':status,'bytesRead':read.value,'expected':length.value},flush=True);assert status in (0,16) and 0<read.value<=length.value
 raw=pcm.raw[:read.value]
 if fmt.value==5:
  floats=struct.unpack('<'+'f'*(read.value//4),raw)
  assert all(__import__('math').isfinite(x) for x in floats)
  raw=struct.pack('<'+'h'*len(floats),*(round(max(-1,min(1,x))*32767) for x in floats))
 out=cache/'b738-n1-75.wav'
 with wave.open(str(out),'wb') as wav:
  wav.setnchannels(channels.value);wav.setsampwidth(2);wav.setframerate(round(rate.value));wav.writeframes(raw)
 samples=struct.unpack('<'+'h'*(len(raw)//2),raw)
 result={'source':str(bank),'bankSha256':hashlib.sha256(data).hexdigest(),'index':index,'sample':label,'path':str(out.resolve()),'duration':len(raw)/(channels.value*2*rate.value),'peak':max(abs(x) for x in samples)/32768,'rms':(sum(x*x for x in samples)/len(samples))**.5/32768}
 (cache/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
finally:
 if parent.value: call('Sound_Release',parent)
 call('System_Release',sys)
