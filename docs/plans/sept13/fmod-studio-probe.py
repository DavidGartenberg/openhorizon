import argparse, ctypes as C, json, signal
from pathlib import Path
signal.alarm(20)
parser=argparse.ArgumentParser(description='Read original installed FMOD event metadata; no audio output.')
parser.add_argument('--aircraft',default='Boeing 737-800')
parser.add_argument('--event',default='{0e9a6d1d-5fab-4f71-95c8-cd8abdb8f653}')
options=parser.parse_args()
root=Path('/Users/davidgartenberg/X-Plane 12')
core=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmod.dylib'),mode=C.RTLD_GLOBAL)
studio=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmodstudio.dylib'))
P=C.c_void_p; I=C.c_int; U=C.c_uint
class Guid(C.Structure):
 _fields_=[('data1',U),('data2',C.c_ushort),('data3',C.c_ushort),('data4',C.c_ubyte*8)]
class ParamId(C.Structure):
 _fields_=[('data1',U),('data2',U)]
class Param(C.Structure):
 _fields_=[('name',C.c_char_p),('id',ParamId),('minimum',C.c_float),('maximum',C.c_float),('defaultvalue',C.c_float),('type',I),('flags',U),('guid',Guid)]
specs={'System_Create':[C.POINTER(P),U], 'System_GetCoreSystem':[P,C.POINTER(P)],'System_Initialize':[P,I,U,U,P], 'System_LoadBankFile':[P,C.c_char_p,U,C.POINTER(P)],'System_GetEvent':[P,C.c_char_p,C.POINTER(P)],'EventDescription_GetParameterDescriptionCount':[P,C.POINTER(I)],'EventDescription_GetParameterDescriptionByIndex':[P,I,C.POINTER(Param)],'Bank_GetEventCount':[P,C.POINTER(I)],'System_Release':[P]}
for name,args in specs.items():
 fn=getattr(studio,'FMOD_Studio_'+name);fn.argtypes=args;fn.restype=I
core.FMOD_System_SetOutput.argtypes=[P,I];core.FMOD_System_SetOutput.restype=I

def call(name,*args):
 r=getattr(studio,'FMOD_Studio_'+name)(*args)
 if r: raise RuntimeError(f'{name}: {r}')
s=P();c=P();b=P();report={}
call('System_Create',C.byref(s),0x20200)
try:
 call('System_GetCoreSystem',s,C.byref(c))
 assert core.FMOD_System_SetOutput(c,2)==0
 call('System_Initialize',s,64,0,0,None)
 bank=root/'Aircraft/Laminar Research'/options.aircraft/'fmod/Master Bank.bank'
 call('System_LoadBankFile',s,str(bank).encode(),0,C.byref(b))
 count=I();call('Bank_GetEventCount',b,C.byref(count));report['events']=count.value
 event=P();call('System_GetEvent',s,options.event.encode(),C.byref(event))
 call('EventDescription_GetParameterDescriptionCount',event,C.byref(count));report['parameterCount']=count.value;report['aircraft']=options.aircraft;report['event']=options.event
 report['parameters']=[]
 for i in range(count.value):
  d=Param();call('EventDescription_GetParameterDescriptionByIndex',event,i,C.byref(d))
  report['parameters'].append({'name':d.name.decode(),'min':d.minimum,'max':d.maximum,'default':d.defaultvalue,'type':d.type,'flags':d.flags})
 report['result']='metadata loaded; no event playback attempted'
except Exception as e:
 report['error']=str(e)
finally:
 if s.value: call('System_Release',s)
print(json.dumps(report))
