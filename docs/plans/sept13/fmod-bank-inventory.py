import ctypes as C,json,signal,hashlib
from pathlib import Path
signal.alarm(30)
root=Path('/Users/davidgartenberg/X-Plane 12'); P=C.c_void_p; I=C.c_int; U=C.c_uint
core=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmod.dylib'),mode=C.RTLD_GLOBAL)
lib=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmodstudio.dylib'))
for name,args in {'System_Create':[C.POINTER(P),U],'System_GetCoreSystem':[P,C.POINTER(P)],'System_Initialize':[P,I,U,U,P],'System_LoadBankFile':[P,C.c_char_p,U,C.POINTER(P)],'Bank_GetEventCount':[P,C.POINTER(I)],'System_Release':[P]}.items():
 fn=getattr(lib,'FMOD_Studio_'+name);fn.argtypes=args;fn.restype=I
core.FMOD_System_SetOutput.argtypes=[P,I];core.FMOD_System_SetOutput.restype=I

def call(name,*args):
 result=getattr(lib,'FMOD_Studio_'+name)(*args)
 if result: raise RuntimeError(f'{name}: {result}')
rows=[]
for bank in sorted((root/'Aircraft/Laminar Research').glob('*/fmod/Master Bank.bank')):
 row={'aircraft':bank.parent.parent.name,'source':str(bank),'sha256':hashlib.sha256(bank.read_bytes()).hexdigest()};s=P();c=P();b=P()
 try:
  call('System_Create',C.byref(s),0x20200);call('System_GetCoreSystem',s,C.byref(c));assert core.FMOD_System_SetOutput(c,2)==0
  call('System_Initialize',s,64,0,0,None);call('System_LoadBankFile',s,str(bank).encode(),0,C.byref(b))
  count=I();call('Bank_GetEventCount',b,C.byref(count));row['events']=count.value
  row['result']='metadata loaded; samples/events not played'
 except Exception as error: row['error']=str(error)
 finally:
  if s.value:call('System_Release',s)
 rows.append(row)
path=Path('server/cache/speech/xplane-probe/bank-studio-inventory.json');path.write_text(json.dumps(rows,indent=2))
print(json.dumps({'banks':len(rows),'loaded':sum('events' in r for r in rows),'failed':[r for r in rows if 'error' in r],'counts':{r['aircraft']:r.get('events') for r in rows},'path':str(path)}))
